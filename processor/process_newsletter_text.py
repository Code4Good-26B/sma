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
                   PUBLICATION_MODEL_CANDIDATES in order)
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
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
from processor.gemini import PUBLICATION_MODEL_CANDIDATES, generate_newsletter_text, mock_newsletter_text

# Pass 2 has no attempt counter (see _fetch_eligible below) — its retry is
# the daily re-selection itself, unlimited. That means it has no equivalent
# of Pass 1's "exhausted all MAX_PROCESSING_ATTEMPTS" floor to force an
# alert when a permanent loss is quietly accumulating. This is that floor,
# measured in elapsed time instead of attempt count: an article that was
# actually attempted and failed in this run, and has been waiting for its
# publication text since `reviewed_at` for more than this many days, forces
# an alert.
#
# 14, the same number as LOOKBACK_DAYS (collector/config.py) and
# MAX_PROCESSING_ATTEMPTS (process_from_db.py), for the same reason: the
# system may be broken for two weeks and lose nothing. A shorter number
# would start alerting during an outage this project is explicitly built to
# absorb; a longer one would let a genuinely stuck article go unnoticed for
# longer than the rest of the system tolerates.
PASS2_FLOOR_DAYS = 14


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

    `publish_target <> 'none'`, not `IN ('newsletter', 'both')`: despite its
    name, newsletter_text_he is the publication text used for BOTH the
    newsletter and the website copy-paste block, so an article approved for
    the website alone needs it just as much as one approved for the
    newsletter. What makes generation pointless is having no destination at
    all. The dashboard's approve modal no longer allows confirming with
    publish_target = 'none' (it disables the confirm button until a
    destination is ticked), and its "החזרה לתור" action for an already-
    approved article sets review_status back to 'not_reviewed' in the same
    update that clears publish_target to 'none' — so review_status =
    'approved' AND publish_target = 'none' should no longer occur through
    normal use of the dashboard at all. A row in exactly that combination
    means it predates the approve-modal guard (this filter still excludes
    those old rows, which is why it's kept), not that the guard was bypassed.
    """
    query = """
        SELECT
            id,
            source_name,
            source_url,
            published_at,
            title_en,
            raw_text,
            reviewed_at
        FROM content_items
        WHERE review_status = 'approved'
          AND publish_target <> 'none'
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
        help="Gemini model name. Default: try PUBLICATION_MODEL_CANDIDATES in order (no fallback if given explicitly).",
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
    # Which REASON articles failed for — see processor/gemini.py's
    # FailureKind and the exit-code logic at the bottom of this file.
    transient_failures = 0
    not_transient_failures = 0
    # Pass 2's floor (see PASS2_FLOOR_DAYS above): articles that were
    # actually attempted and failed in THIS run, and have been waiting since
    # reviewed_at for longer than the floor.
    floor_exceeded = 0
    floor_exceeded_ids: list[str] = []

    try:
        with conn.cursor() as cur:
            rows = _fetch_eligible(cur, args.limit)

        if not rows:
            print("No approved articles waiting for publication text.")
            return 0

        model_desc = args.model if args.model else " -> ".join(PUBLICATION_MODEL_CANDIDATES)
        print(f"Found {len(rows)} article(s) needing publication text. Processor v{__version__} | model: {model_desc}")

        for i, row in enumerate(rows):
            article_id = str(row["id"])
            title_preview = (row["title_en"] or "")[:60]

            print(f"\n[{i + 1}/{len(rows)}] {article_id}")
            print(f"  Title: {title_preview}")

            if not (row["raw_text"] or "").strip():
                # SKIPPED, not failed — and that distinction is load-bearing,
                # not cosmetic. An article with empty raw_text will NEVER get
                # a publication text (a known limitation, see
                # docs/project_notes.md): there is nothing to send to Gemini,
                # ever, on any future run either. If this counted toward the
                # PASS2_FLOOR_DAYS floor below, it would eventually cross the
                # threshold and this script would email about it every
                # single day forever — recreating, exactly, the alert-
                # fatigue failure mode this whole task exists to cure. It is
                # therefore excluded from failed/transient/not_transient and
                # from the floor entirely, by simply `continue`-ing before
                # any of that bookkeeping runs.
                print("  Skipped: raw_text is empty — nothing to send to Gemini.")
                skipped_empty += 1
                continue

            newsletter_text_he = ""
            status_ok = False
            error_message: str | None = None
            model_used: str | None = None
            # Conservative default — see process_from_db.py's identical
            # comment. Only overridden below when Gemini positively
            # classifies its own failure as transient.
            failure_kind = "not_transient"

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
                        failure_kind = result.failure_kind or "not_transient"
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
                # Same reasoning as process_from_db.py: a DB write failure
                # does not fix itself on a later Gemini call.
                failure_kind = "not_transient"

            if status_ok:
                succeeded += 1
            else:
                failed += 1
                if failure_kind == "transient":
                    transient_failures += 1
                else:
                    not_transient_failures += 1

                # The floor (see PASS2_FLOOR_DAYS above): only articles that
                # were actually attempted and failed reach this line at all
                # (skipped ones `continue`d above, before any of this). A
                # NULL reviewed_at means the floor cannot be measured for
                # this article — nothing to count the 14 days from — so it
                # is deliberately excluded rather than guessed at.
                reviewed_at = row.get("reviewed_at")
                if reviewed_at is not None:
                    age = datetime.now(timezone.utc) - reviewed_at
                    if age > timedelta(days=PASS2_FLOOR_DAYS):
                        floor_exceeded += 1
                        floor_exceeded_ids.append(article_id)

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
    print(f"  transient     : {transient_failures}")
    print(f"  not transient : {not_transient_failures}")
    print(f"Skipped (empty): {skipped_empty}")
    print(
        f"Waiting >{PASS2_FLOOR_DAYS}d, attempted+failed: {floor_exceeded}"
        + (f" ({', '.join(floor_exceeded_ids)})" if floor_exceeded_ids else "")
    )

    # Exit code is the only signal this project has when it runs unattended, so it
    # must mean "a human needs to look at this", not "one article had a bad day".
    # It is decided by WHY articles failed, not how many succeeded — a success
    # count is a bad proxy for "systemic" at this project's volume (roughly 7
    # approved articles a month): one bad five-second window at Google can
    # fail every article in a run and looks identical to a dead API key.
    #
    #   every failure transient (network error, 429, or 5xx) -> exit 0. Another
    #     attempt, later — the daily run, or the frequent publication-text
    #     workflow — can succeed without anyone doing anything, since the
    #     selection query (newsletter_text_he IS NULL) is itself the retry.
    #   any failure NOT transient (401/403, other 4xx, an unusable response, an
    #     unexpected exception, or a DB write failure) -> exit 1.
    #
    # Unlike Pass 1, there is no attempt COUNTER here by design (see
    # _fetch_eligible) — the retry is unlimited. But unlimited retries with no
    # floor at all would mean a permanently-stuck article (e.g. every model
    # consistently rejecting one specific article's content) could fail
    # silently forever as long as each individual failure looked transient.
    # PASS2_FLOOR_DAYS is that floor, measured in elapsed time since
    # reviewed_at instead of an attempt count, checked FIRST (same position
    # as Pass 1's `exhausted` check) so it forces exit 1 even when every
    # individual failure this run was itself transient.
    if floor_exceeded > 0:
        print(
            f"ALERT: {floor_exceeded} article(s) have been waiting more than "
            f"{PASS2_FLOOR_DAYS} days since approval for a publication text, and "
            f"failed again this run: {', '.join(floor_exceeded_ids)}"
        )
        return 1

    if not_transient_failures > 0:
        print(
            f"ALERT: {not_transient_failures} article(s) failed for a reason that will "
            f"not fix itself (see the Gemini/DB errors above) — exiting 1."
        )
        return 1

    if failed > 0:
        print(
            f"NOTE: {failed} article(s) failed, all for transient reasons (network "
            f"error, rate limit, or a temporary Gemini outage) — they will be retried "
            f"by a later run. Exiting 0, no alert."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
