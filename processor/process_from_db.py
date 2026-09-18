"""
Processor Pass 1 (triage): process pending content_items from the Supabase DB.

Reads articles with processing_status='pending' (plus 'failed' articles that
still have retries left), runs them through Gemini, and writes title_he /
summary_he back to the DB. This is the only output of Pass 1 — it exists so
Michal can decide "interesting or not" in the dashboard. Pass 2 (the
publication text for approved articles) is a separate, later step.

Run from the sma/ project root:
    python processor/process_from_db.py

Credentials are loaded from the .env file (see .env.example).

Optional flags:
    --mock-llm     Skip Gemini and use mock outputs (for local testing)
    --delay N      Seconds to wait between Gemini calls (default 1.0)
    --limit N      Max number of articles to process (default: all eligible)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
import time

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

# The output here is Hebrew. A console using a legacy code page (e.g. the
# default Windows terminal) cannot encode it and would raise on print() —
# which, if that happened inside the same try block as the Gemini call,
# would wrongly mark an already-successful result as failed. GitHub
# Actions' Linux runners default to UTF-8 already; this just makes that
# true everywhere else too.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Load .env from the project root (sma/)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Allow package imports when running as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from processor import __version__
from processor.gemini import MODEL_CANDIDATES, generate_hebrew_outputs, mock_hebrew_outputs

# Pass 1 retries a 'failed' article this many times (across runs) before
# giving up on it. Bounded so a genuinely malformed article cannot be
# retried forever, while a transient failure (network error, API quota
# blip) no longer silently loses an article on the first bad attempt.
MAX_PROCESSING_ATTEMPTS = 3


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_connection() -> psycopg2.extensions.connection:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not configured. Please create a .env file based on .env.example."
        )
    return psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor)


def _fetch_eligible(cur, limit: int | None) -> list[dict]:
    """Fetch articles Pass 1 should (re)triage.

    Deliberately does NOT set processing_status='processing' anywhere in this
    module. There is exactly one Processor worker, so a mid-article status
    would only guard against concurrent workers, which cannot happen — while
    it would risk an article getting stuck in 'processing' forever if a run
    dies mid-write (a CI timeout, the runner being killed). Going straight
    from 'pending'/retryable 'failed' to 'done'/'failed' means the worst case
    is simply that the article is retried next run, same as any other one.
    """
    query = """
        SELECT
            id,
            source_name,
            source_url,
            published_at,
            title_en,
            raw_text,
            processing_status,
            processing_attempts,
            created_at
        FROM content_items
        WHERE processing_status = 'pending'
           OR (processing_status = 'failed' AND processing_attempts < %s)
        ORDER BY published_at DESC
    """
    params: list = [MAX_PROCESSING_ATTEMPTS]
    if limit:
        query += " LIMIT %s"
        params.append(int(limit))
    cur.execute(query, params)
    return [dict(r) for r in cur.fetchall()]


def _row_to_gemini_input(row: dict) -> dict:
    """Build the plain dict the Gemini prompt builder reads from a DB row."""
    return {
        "title": row["title_en"] or "",
        "source": row["source_name"] or "",
        "published_at": row["published_at"].isoformat() if row["published_at"] else "",
        "content": row["raw_text"] or "",
        "snippet": "",
    }


def _update_row(cur, row_id: str, *, title_he: str, summary_he: str,
                status: str, error_message: str | None) -> None:
    """Write this attempt's result and increment processing_attempts.

    Incremented unconditionally — this function is called exactly once per
    article per run, on both success and failure, per the retry-attempt
    contract in docs/db_contract.md.
    """
    cur.execute(
        """
        UPDATE content_items
        SET
            title_he             = %s,
            summary_he           = %s,
            processing_status    = %s,
            processing_attempts  = processing_attempts + 1,
            error_message        = %s,
            updated_at           = NOW()
        WHERE id = %s
        """,
        (title_he or None, summary_he or None, status, error_message, row_id),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Processor Pass 1 (triage) over pending DB articles")
    parser.add_argument("--mock-llm", action="store_true", help="Skip Gemini and use mock outputs")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between Gemini calls")
    parser.add_argument("--limit", type=int, default=None, help="Max articles to process")
    parser.add_argument(
        "--model", default=None,
        help="Gemini model name. Default: try MODEL_CANDIDATES in order (no fallback if given explicitly).",
    )
    args = parser.parse_args(argv)

    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if not args.mock_llm and not gemini_key:
        print("ERROR: GEMINI_API_KEY is not set in .env (use --mock-llm to skip).", file=sys.stderr)
        return 1

    try:
        conn = _get_connection()
    except Exception as e:
        print(f"ERROR: Could not connect to DB: {e}", file=sys.stderr)
        return 1

    # Each article is committed independently below (see the loop) — a
    # single article's DB write failing must never roll back, or block,
    # any other article's already-saved result.
    conn.autocommit = False

    succeeded = 0
    failed = 0
    retries = 0

    try:
        with conn.cursor() as cur:
            rows = _fetch_eligible(cur, args.limit)

        if not rows:
            print("No articles pending triage.")
            return 0

        model_desc = args.model if args.model else " -> ".join(MODEL_CANDIDATES)
        print(f"Found {len(rows)} article(s) to triage. Processor v{__version__} | model: {model_desc}")

        for i, row in enumerate(rows):
            article_id = str(row["id"])
            title_preview = (row["title_en"] or "")[:60]
            is_retry = row["processing_status"] == "failed"
            if is_retry:
                retries += 1

            print(f"\n[{i + 1}/{len(rows)}] {article_id}" + ("  (retry)" if is_retry else ""))
            print(f"  Title: {title_preview}")

            title_he = ""
            summary_he = ""
            status = "failed"
            error_message: str | None = None
            model_used: str | None = None

            # The Gemini call either produced usable output or it did not —
            # nothing after that point (logging, formatting, terminal
            # behaviour) should be able to change that verdict. So this
            # block only decides the verdict; printing the result happens
            # afterwards, outside the try, and the except below can only
            # downgrade to 'failed' when we did not already succeed.
            try:
                article = _row_to_gemini_input(row)
                if args.mock_llm:
                    outputs = mock_hebrew_outputs(article)
                    title_he = outputs.get("title_he", "")
                    summary_he = outputs.get("summary_he", "")
                    status = "done"
                    model_used = "mock"
                else:
                    result = generate_hebrew_outputs(article, api_key=gemini_key, model=args.model)
                    if result.error:
                        error_message = result.error
                    else:
                        title_he = result.outputs.get("title_he", "")
                        summary_he = result.outputs.get("summary_he", "")
                        status = "done"
                        model_used = result.model
            except Exception as e:
                if status == "done":
                    # Something went wrong after Gemini already succeeded
                    # (should not be reachable today, but kept as a
                    # deliberate guard against future changes) — a good
                    # result must never be discarded because of this.
                    print(f"  WARNING: non-fatal error after successful generation: {e}", file=sys.stderr)
                else:
                    error_message = f"Unexpected error: {e}"
                    status = "failed"
                    print(f"  ERROR: {error_message}", file=sys.stderr)

            if status == "done":
                print(f"  Model: {model_used}")
                print(f"  title_he:   {title_he}")
                print(f"  summary_he: {summary_he}")
            else:
                print(f"  Gemini error: {error_message}")

            try:
                with conn.cursor() as cur:
                    _update_row(cur, article_id, title_he=title_he, summary_he=summary_he,
                                status=status, error_message=error_message)
                conn.commit()
                print(f"  Saved to DB — status={status}")
            except Exception as e:
                conn.rollback()
                print(f"  ERROR: Failed to save to DB: {e}", file=sys.stderr)
                status = "failed"

            if status == "done":
                succeeded += 1
            else:
                failed += 1

            if not args.mock_llm and args.delay > 0 and i < len(rows) - 1:
                time.sleep(args.delay)

    except Exception as e:
        print(f"ERROR: Unexpected failure: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    print("\n=== Done ===")
    print(f"Processed : {succeeded + failed}")
    print(f"Succeeded : {succeeded}")
    print(f"Failed    : {failed}")
    print(f"Retries   : {retries}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
