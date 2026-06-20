"""
Process pending content_items from the Supabase DB.

Reads articles with processing_status='pending', runs them through the
Gemini processor, and writes title_he / summary_he back to the DB.

After processing, writes a human-readable review file to out/review_<timestamp>.md
so outputs can be manually checked before publishing.

Run from the sma/ project root:
    python processor/process_from_db.py

Credentials are loaded from the .env file (see .env.example).

Optional flags:
    --mock-llm     Skip Gemini and use mock outputs (for local testing)
    --delay N      Seconds to wait between Gemini calls (default 1.0)
    --limit N      Max number of articles to process (default: all pending)
    --review-only  Skip processing; generate review file from done articles
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import time

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

# Load .env from the project root (sma/)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Allow package imports when running as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from processor import __version__
from processor.contracts import normalize_article_input
from processor.gemini import DEFAULT_MODEL, generate_hebrew_outputs, mock_hebrew_outputs


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


def _fetch_pending(cur, limit: int | None) -> list[dict]:
    query = """
        SELECT
            id,
            source_name,
            source_url,
            published_at,
            title_en,
            raw_text,
            created_at
        FROM content_items
        WHERE processing_status = 'pending'
        ORDER BY published_at DESC
    """
    if limit:
        query += f" LIMIT {int(limit)}"
    cur.execute(query)
    return [dict(r) for r in cur.fetchall()]


def _fetch_done(cur) -> list[dict]:
    cur.execute("""
        SELECT
            id,
            source_name,
            source_url,
            published_at,
            title_en,
            raw_text,
            title_he,
            summary_he
        FROM content_items
        WHERE processing_status = 'done'
        ORDER BY published_at DESC
    """)
    return [dict(r) for r in cur.fetchall()]


def _row_to_article_input(row: dict) -> dict:
    """Map a content_items DB row to the processor input contract shape."""
    return {
        "id": str(row["id"]),
        "title": row["title_en"] or "",
        "source": row["source_name"] or "",
        "url": row["source_url"] or "",
        "published_at": row["published_at"].isoformat() if row["published_at"] else "",
        "language": "en",
        "content": row["raw_text"] or "",
        "snippet": "",
        "collected_at": row["created_at"].isoformat() if row["created_at"] else "",
        "metadata": {"author": "", "tags": []},
    }


def _update_row(cur, row_id: str, *, title_he: str, summary_he: str,
                # publication_text_he: str,  # TODO: uncomment once DB column is added
                status: str, error_message: str | None) -> None:
    cur.execute(
        """
        UPDATE content_items
        SET
            title_he          = %s,
            summary_he        = %s,
            processing_status = %s,
            error_message     = %s,
            updated_at        = NOW()
        WHERE id = %s
        """,
        # TODO: add publication_text_he as a 3rd param once the DB column is added:
        #   (title_he or None, summary_he or None, publication_text_he or None, status, error_message, row_id)
        (title_he or None, summary_he or None, status, error_message, row_id),
    )


# ---------------------------------------------------------------------------
# Review file
# ---------------------------------------------------------------------------

def _write_review_file(rows: list[dict], out_dir: Path) -> Path:
    """Write a markdown review file with original article + Hebrew outputs."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"review_{ts}.md"
    out_dir.mkdir(parents=True, exist_ok=True)

    lines = [
        "# SMA Hebrew Output Review",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"Articles: {len(rows)}",
        "",
    ]

    for i, row in enumerate(rows, 1):
        pub = row["published_at"].strftime("%Y-%m-%d") if row["published_at"] else "unknown date"
        raw = (row["raw_text"] or "").strip()
        content_preview = raw[:600] + ("..." if len(raw) > 600 else "")

        lines += [
            "---",
            f"## {i}. {row['title_en'] or '(no title)'}",
            f"**Source:** {row['source_name']} | **Published:** {pub}",
            f"**URL:** {row['source_url'] or ''}",
            "",
            "### Original content (excerpt)",
            "```",
            content_preview,
            "```",
            "",
            "### Hebrew title (`title_he`)",
            row["title_he"] or "_(empty)_",
            "",
            "### Hebrew summary (`summary_he`)",
            row["summary_he"] or "_(empty)_",
            "",
            # "### Hebrew publication text (`publication_text_he`)",
            # row.get("publication_text_he") or "_(empty)_",  # TODO: uncomment once DB column added
            # "",
        ]

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Process pending DB articles with Gemini")
    parser.add_argument("--mock-llm", action="store_true", help="Skip Gemini and use mock outputs")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between Gemini calls")
    parser.add_argument("--limit", type=int, default=None, help="Max articles to process")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Gemini model name")
    parser.add_argument("--review-only", action="store_true",
                        help="Skip processing; write review file from done articles")
    args = parser.parse_args(argv)

    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if not args.mock_llm and not args.review_only and not gemini_key:
        print("ERROR: GEMINI_API_KEY is not set in .env (use --mock-llm to skip).", file=sys.stderr)
        return 1

    out_dir = Path(__file__).resolve().parents[1] / "out"

    try:
        conn = _get_connection()
    except Exception as e:
        print(f"ERROR: Could not connect to DB: {e}", file=sys.stderr)
        return 1

    conn.autocommit = False
    overall_ok = True

    try:
        # --review-only: generate review file from already-done rows
        if args.review_only:
            with conn.cursor() as cur:
                done_rows = _fetch_done(cur)
            if not done_rows:
                print("No done articles found to review.")
                return 0
            review_path = _write_review_file(done_rows, out_dir)
            print(f"Review file written: {review_path}")
            return 0

        # Normal processing
        with conn.cursor() as cur:
            rows = _fetch_pending(cur, args.limit)

        if not rows:
            print("No pending articles found.")
            return 0

        print(f"Found {len(rows)} pending article(s). Processor v{__version__}")
        processed_rows: list[dict] = []

        for i, row in enumerate(rows):
            article_id = str(row["id"])
            title_preview = (row["title_en"] or "")[:60]
            print(f"\n[{i+1}/{len(rows)}] {article_id}")
            print(f"  Title: {title_preview}")

            title_he = ""
            summary_he = ""
            # publication_text_he = ""  # TODO: uncomment once DB column is added
            status = "failed"
            error_message: str | None = None

            try:
                article_input = _row_to_article_input(row)
                normalized, validation_errors = normalize_article_input(article_input)

                if validation_errors:
                    error_message = "; ".join(f"{e.field}: {e.message}" for e in validation_errors)
                    print(f"  Validation errors: {error_message}")
                else:
                    if args.mock_llm:
                        outputs = mock_hebrew_outputs(normalized)
                        title_he = outputs.get("title_he", "")
                        summary_he = outputs.get("summary_he", "")
                        # publication_text_he = outputs.get("publication_text_he", "")  # TODO: uncomment
                        status = "done"
                        print("  [mock] Generated Hebrew outputs.")
                    else:
                        result = generate_hebrew_outputs(
                            normalized, api_key=gemini_key, model=args.model
                        )
                        if result.error:
                            error_message = result.error
                            print(f"  Gemini error: {error_message}")
                        else:
                            title_he = result.outputs.get("title_he", "")
                            summary_he = result.outputs.get("summary_he", "")
                            # publication_text_he = result.outputs.get("publication_text_he", "")  # TODO: uncomment
                            status = "done"
                            print(f"  title_he:   {title_he[:80]}")
                            print(f"  summary_he: {summary_he[:120]}")

            except Exception as e:
                error_message = f"Unexpected error: {e}"
                print(f"  ERROR: {error_message}", file=sys.stderr)
                status = "failed"

            try:
                with conn.cursor() as cur:
                    _update_row(cur, article_id, title_he=title_he, summary_he=summary_he,
                                # publication_text_he=publication_text_he,  # TODO: uncomment
                                status=status, error_message=error_message)
                conn.commit()
                print(f"  Saved to DB — status={status}")
            except Exception as e:
                conn.rollback()
                print(f"  ERROR: Failed to save to DB: {e}", file=sys.stderr)
                overall_ok = False
                continue

            if status == "done":
                processed_rows.append({**row, "title_he": title_he, "summary_he": summary_he})
            else:
                overall_ok = False

            if not args.mock_llm and args.delay > 0 and i < len(rows) - 1:
                time.sleep(args.delay)

        if processed_rows:
            review_path = _write_review_file(processed_rows, out_dir)
            print(f"\nReview file: {review_path}")
        else:
            print("\nNo articles processed successfully — no review file written.")

    except Exception as e:
        print(f"ERROR: Unexpected failure: {e}", file=sys.stderr)
        overall_ok = False
    finally:
        conn.close()

    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
