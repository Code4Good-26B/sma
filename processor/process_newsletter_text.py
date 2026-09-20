"""
Processor Pass 2 (publication text): generate newsletter_text_he for approved
content_items.

Reads articles Michal has already approved in the dashboard and that don't yet
have publication text, runs them through Gemini, and writes newsletter_text_he
back to the DB. This is the single Hebrew text used for both the newsletter and
the website copy-paste block — there is one publication text, not two.

This is a separate entry point from Pass 1 (process_from_db.py) on purpose: the
two passes have different selection queries, different failure semantics, and
different lifecycles. Two simple scripts are easier to follow than one script
with modes, especially for someone inheriting this project with no handover.

Run from the sma/ project root:
    python processor/process_newsletter_text.py

Credentials are loaded from the .env file (see .env.example).

Optional flags:
    --mock-llm     Skip Gemini and use mock outputs (for local testing)
    --delay N      Seconds to wait between Gemini calls (default 1.0)
    --limit N      Max number of articles to process (default: all eligible)
    --model NAME   Use exactly this Gemini model, no fallback (default: try
                   MODEL_CANDIDATES in order)
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
from processor.gemini import MODEL_CANDIDATES, generate_newsletter_text, mock_newsletter_text


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
    """Fetch approved articles that still need publication text.

    No retry counter here, unlike Pass 1. The selection query is itself the
    retry: an article whose Gemini call fails simply still matches this
    query tomorrow (newsletter_text_he is still NULL). At this project's
    volume (roughly 7 approved articles a month), a permanently-failing
    article costs one wasted API call per daily run, and is visible in the
    log — cheap enough that a dedicated counter isn't worth the extra
    column and code. If that ever changes, add one then.
    """
    query = """
        SELECT
            id,
            source_name,
            source_url,
            published_at,
            title_en,
            raw_text
        FROM content_items
        WHERE review_status = 'approved'
          AND newsletter_text_he IS NULL
        ORDER BY published_at DESC
    """
    if limit:
        query += " LIMIT %s"
        cur.execute(query, [int(limit)])
    else:
        cur.execute(query)
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


def _update_row(cur, row_id: str, *, newsletter_text_he: str,
                error_message: str | None) -> None:
    """Write this attempt's result.

    Deliberately touches only newsletter_text_he and error_message — never
    processing_status, processing_attempts, review_status, title_he,
    summary_he, or any publish field. Those belong to other components
    (Pass 1, the Dashboard, and the Dashboard-as-Publisher respectively).
    """
    cur.execute(
        """
        UPDATE content_items
        SET
            newsletter_text_he = %s,
            error_message       = %s,
            updated_at          = NOW()
        WHERE id = %s
        """,
        (newsletter_text_he or None, error_message, row_id),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Processor Pass 2 (publication text) over approved DB articles"
    )
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

    # Each article is committed independently below — a single article's DB
    # write failing must never roll back, or block, any other article's
    # already-saved result.
    conn.autocommit = False

    succeeded = 0
    failed = 0
    skipped_empty = 0

    try:
        with conn.cursor() as cur:
            rows = _fetch_eligible(cur, args.limit)

        if not rows:
            print("No approved articles waiting for publication text.")
            return 0

        model_desc = args.model if args.model else " -> ".join(MODEL_CANDIDATES)
        print(f"Found {len(rows)} article(s) needing publication text. Processor v{__version__} | model: {model_desc}")

        for i, row in enumerate(rows):
            article_id = str(row["id"])
            title_preview = (row["title_en"] or "")[:60]

            print(f"\n[{i + 1}/{len(rows)}] {article_id}")
            print(f"  Title: {title_preview}")

            if not (row["raw_text"] or "").strip():
                print("  Skipped: raw_text is empty — nothing to send to Gemini.")
                skipped_empty += 1
                continue

            newsletter_text_he = ""
            status_ok = False
            error_message: str | None = None
            model_used: str | None = None

            # The Gemini call either produced usable output or it did not —
            # nothing after that point (logging, formatting, terminal
            # behaviour) should be able to change that verdict. So this
            # block only decides the verdict; printing the result happens
            # afterwards, outside the try, and the except below can only
            # downgrade to failure when we did not already succeed.
            try:
                article = _row_to_gemini_input(row)
                if args.mock_llm:
                    outputs = mock_newsletter_text(article)
                    newsletter_text_he = outputs.get("newsletter_text_he", "")
                    status_ok = True
                    model_used = "mock"
                else:
                    result = generate_newsletter_text(article, api_key=gemini_key, model=args.model)
                    if result.error:
                        error_message = result.error
                    else:
                        newsletter_text_he = result.outputs.get("newsletter_text_he", "")
                        status_ok = True
                        model_used = result.model
            except Exception as e:
                if status_ok:
                    print(f"  WARNING: non-fatal error after successful generation: {e}", file=sys.stderr)
                else:
                    error_message = f"Unexpected error: {e}"
                    print(f"  ERROR: {error_message}", file=sys.stderr)

            if status_ok:
                word_count = len(newsletter_text_he.split())
                print(f"  Model: {model_used}")
                print(f"  newsletter_text_he ({word_count} words):")
                print(f"  {newsletter_text_he}")
            else:
                print(f"  Gemini error: {error_message}")

            try:
                with conn.cursor() as cur:
                    _update_row(cur, article_id, newsletter_text_he=newsletter_text_he,
                                error_message=error_message)
                conn.commit()
                print(f"  Saved to DB — {'done' if status_ok else 'failed'}")
            except Exception as e:
                conn.rollback()
                print(f"  ERROR: Failed to save to DB: {e}", file=sys.stderr)
                status_ok = False

            if status_ok:
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
    print(f"Processed      : {succeeded + failed}")
    print(f"Succeeded      : {succeeded}")
    print(f"Failed         : {failed}")
    print(f"Skipped (empty): {skipped_empty}")

    # Exit code is the only signal this project has when it runs unattended, so it
    # must mean "a human needs to look at this", not "one article had a bad day".
    #
    #   failed > 0 while succeeded > 0  -> partial. The failed articles are picked
    #     up by the next daily run (the DB query is itself the retry), so this is
    #     a normal, self-correcting outcome and exits 0.
    #   failed > 0 and succeeded == 0   -> nothing worked at all. Almost always a
    #     systemic cause (bad key, API down, DB unreachable), so exit 1.
    #
    # Unlike Pass 1, there is no attempt counter here by design (see
    # _fetch_eligible) — the retry is unlimited, so there is no permanent-loss
    # case to force exit 1 the way an exhausted Pass 1 article does.
    if failed > 0 and succeeded == 0:
        return 1

    if failed > 0:
        print(
            f"NOTE: {failed} article(s) failed but {succeeded} succeeded — exiting 0. "
            f"Failed articles are retried by the next run."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
