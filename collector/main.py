"""Collector entry point — the entire pipeline in one script.

Run from the project root:
    python collector/main.py

For each configured source: fetch the listing, ask the database which of
those source_urls are already stored, download full article content ONLY
for the new ones, and insert them. Every run is recorded in collector_runs
(see docs/db_contract.md) so the Dashboard can show whether the Collector
is alive, even though nobody is watching this process directly.

The database is the only durable state — there is no JSON file between
runs. On a fresh checkout (e.g. a GitHub Actions container) the DB check
is what stops the collector from re-downloading and re-fetching everything
it already has, every single day.

To adjust the lookback window or pagination limits, edit collector/config.py.
"""

import json
import os
import sys
import time
import traceback
from datetime import date, timedelta

# Allow importing from shared/python without installing as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared", "python"))

from article_fetcher import fetch_article_content
from config import LOOKBACK_DAYS, REQUEST_DELAY_SECONDS
from db_client import get_db_connection
from html_scraper import fetch_from_html
from normalizer import normalize
from rss_scraper import fetch_from_rss
from sources import SOURCES

INSERT_SQL = """
    INSERT INTO content_items (
        source_name,
        source_type,
        source_url,
        external_id,
        published_at,
        title_en,
        raw_text,
        processing_status,
        review_status,
        publish_target,
        publish_status
    )
    VALUES (
        %(source_name)s,
        %(source_type)s,
        %(source_url)s,
        %(external_id)s,
        %(published_at)s,
        %(title_en)s,
        %(raw_text)s,
        'pending',
        'not_reviewed',
        'none',
        'not_published'
    )
    ON CONFLICT (source_url) DO NOTHING
"""


def _existing_urls(conn, urls):
    """Return the subset of urls already present in content_items.

    A single batched query (WHERE source_url = ANY(...)) rather than one
    query per article.
    """
    urls = [u for u in urls if u]
    if not urls:
        return set()

    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_url FROM content_items WHERE source_url = ANY(%s)",
            (urls,),
        )
        return {row["source_url"] for row in cur.fetchall()}


def _insert_articles(conn, articles):
    """Insert normalized articles, one transaction per article.

    In Postgres, once a statement inside a transaction fails, the whole
    transaction is aborted: every later statement in it fails too, and even
    the successful ones before it get rolled back on commit. A single bad
    article (a NUL byte in raw_text, an over-length value, a check-constraint
    violation — any of these can come from a live site) must not be able to
    take the rest of the batch down with it. So each article gets its own
    transaction: a failure costs exactly that one article, and every other
    article commits independently. This project inserts on the order of 15
    articles a month, so the extra round-trips are free — isolation matters
    far more here than batching.

    Returns (inserted_count, failed_count). inserted_count only counts rows
    that were actually committed.
    """
    inserted = 0
    failed = 0
    with conn.cursor() as cur:
        for article in articles:
            try:
                cur.execute(INSERT_SQL, article)
                conn.commit()
                if cur.rowcount == 1:
                    inserted += 1
            except Exception as e:
                # Roll back just this article's transaction so the
                # connection is usable again for the next one.
                conn.rollback()
                failed += 1
                print(f"  [db] Error inserting {article.get('source_url', '?')}: {e}")
    return inserted, failed


def collect_source(conn, source, since_date):
    """Collect one source end to end: listing -> DB check -> download new -> insert.

    Never raises — a failing source is recorded in the returned detail dict
    and does not stop the other sources from running.
    """
    name = source["name"]
    print(f"\n[{name}]")

    detail = {
        "name": name,
        "listed": 0,
        "downloaded": 0,
        "inserted": 0,
        "insert_failed": 0,
        "status": "ok",
        "error": None,
    }

    try:
        since_str = str(since_date)

        try:
            articles = fetch_from_rss(source, since_date)
        except Exception as e:
            # An RSS failure is only recoverable if this source also has an
            # HTML path to fall back to. Without this guard, a source with
            # html_fallback=True would never get its second chance the
            # moment fetch_from_rss started raising instead of swallowing
            # errors — a regression, not an improvement.
            if not source.get("html_fallback"):
                raise
            print(f"  RSS failed ({e}) — trying HTML fallback...")
            articles = []

        if not articles and source.get("html_fallback"):
            print("  RSS returned nothing — trying HTML fallback...")
            articles = fetch_from_html(source, since_date)

        detail["listed"] = len(articles)

        if not articles:
            print("  No articles collected.")
            return detail

        # Check the DB BEFORE downloading full content. At this project's
        # volume, most of what a listing returns on any given day is
        # already stored — skipping those downloads is what keeps a daily
        # run from re-hitting the source site for content it already has.
        known_urls = _existing_urls(conn, [a.get("source_url", "") for a in articles])
        new_articles = [a for a in articles if a.get("source_url", "") not in known_urls]

        skipped = len(articles) - len(new_articles)
        if skipped:
            print(f"  Already in DB: {skipped} (skipping their download)")

        if not new_articles:
            print("  Nothing new to download.")
            return detail

        print(f"  Fetching full content for {len(new_articles)} new articles...")
        fetched = []
        for i, article in enumerate(new_articles, 1):
            url = article.get("source_url", "")
            print(f"    ({i}/{len(new_articles)}) {url[:80]}")
            content = fetch_article_content(url)
            article["raw_text"] = content["raw_text"]
            # Article-page date is more reliable than listing date; override if available
            if content.get("published_at"):
                article["published_at"] = content["published_at"]

            fetched.append(article)
            detail["downloaded"] += 1

            # Early stop for date-unknown sources (e.g. SMA News Today):
            # articles are ordered newest→oldest, so once we see an article
            # that is older than our window, everything after it will be too.
            if article.get("published_at") and article["published_at"] < since_str:
                print(
                    f"  Early stop at article {i}: "
                    f"date {article['published_at']} is before {since_date}"
                )
                break

            time.sleep(REQUEST_DELAY_SECONDS)

        # Final filter — discards articles outside the window.
        # Catches any stragglers from sources where listing dates aren't available.
        before = len(fetched)
        fetched = [a for a in fetched if (a.get("published_at") or "") >= since_str]
        filtered = before - len(fetched)
        if filtered:
            print(f"  Filtered out {filtered} articles older than {since_date}")

        normalized = [normalize(a, source) for a in fetched]
        detail["inserted"], detail["insert_failed"] = _insert_articles(conn, normalized)

        print(
            f"  Inserted: {detail['inserted']} / Downloaded: {detail['downloaded']}"
            + (f" / Failed to insert: {detail['insert_failed']}" if detail["insert_failed"] else "")
        )
        return detail

    except Exception as e:
        print(f"  [collector] ERROR in source {name}: {e}")
        detail["status"] = "error"
        detail["error"] = str(e)
        return detail


def start_run(conn, lookback_days):
    """Insert the 'running' row for this execution. Returns its id.

    Written before touching any source, so a process that dies mid-run
    leaves a row stuck in 'running' — itself a useful signal.
    """
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO collector_runs (status, lookback_days)
                VALUES ('running', %s)
                RETURNING id
                """,
                (lookback_days,),
            )
            return cur.fetchone()["id"]


def finish_run(conn, run_id, status, items_seen, items_inserted, sources, error_message=None):
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE collector_runs
                SET finished_at = now(),
                    status = %s,
                    items_seen = %s,
                    items_inserted = %s,
                    sources = %s,
                    error_message = %s
                WHERE id = %s
                """,
                (status, items_seen, items_inserted, json.dumps(sources), error_message, run_id),
            )


def main():
    since_date = date.today() - timedelta(days=LOOKBACK_DAYS)

    print("=== SMA Collector ===")
    print(f"Collecting articles from {since_date} onwards (last {LOOKBACK_DAYS} days)")

    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"[collector] FATAL: could not connect to the database: {e}")
        return 1

    try:
        run_id = start_run(conn, LOOKBACK_DAYS)
    except Exception as e:
        print(f"[collector] FATAL: could not start collector_runs row: {e}")
        conn.close()
        return 1

    details = []
    try:
        for source in SOURCES:
            details.append(collect_source(conn, source, since_date))

        items_seen = sum(d["listed"] for d in details)
        items_inserted = sum(d["inserted"] for d in details)
        insert_failures = sum(d["insert_failed"] for d in details)
        source_errors = [d for d in details if d["status"] == "error"]

        # A run that finds zero new articles is still a success — quiet
        # weeks are normal for a low-volume news source and must not be
        # reported as a failure. But a run that lost articles must never
        # look green: a whole source erroring out, or even a single article
        # failing to insert (bad data from a live site), both count as a
        # problem — the difference from a clean run is not "did every
        # source finish" but "did everything that was found make it in".
        has_problems = bool(source_errors) or insert_failures > 0

        # Two separate questions, deliberately:
        #   status     -> what goes into collector_runs, i.e. what the dashboard and
        #                 the run history will show a human who goes looking.
        #   exit code  -> whether GitHub emails somebody tonight.
        #
        # They are not the same. One source being unreachable while another works is
        # worth RECORDING (the dashboard must be able to show "nothing from SMA News
        # Today since the 20th") but is NOT worth an email every morning for however
        # long that site blocks us — the same partial-vs-systemic rule the processor
        # passes use. An insert failure is different: it means data that was
        # successfully downloaded could not be stored, which points at the schema or
        # the database rather than at a flaky website, and does not fix itself.
        all_sources_failed = bool(details) and len(source_errors) == len(details)

        if not has_problems:
            status = "success"
        elif all_sources_failed:
            status = "failed"
        else:
            status = "partial"

        error_parts = [f"{d['name']}: {d['error']}" for d in source_errors]
        if insert_failures:
            error_parts.append(
                f"{insert_failures} article(s) failed to insert (see per-source detail)"
            )
        error_message = "; ".join(error_parts) or None

        finish_run(conn, run_id, status, items_seen, items_inserted, details, error_message)

        print("\n=== Done ===")
        print(f"Status         : {status}")
        print(f"Items seen     : {items_seen}")
        print(f"Items inserted : {items_inserted}")
        for d in details:
            print(
                f"  {d['name']}: listed={d['listed']} downloaded={d['downloaded']} "
                f"inserted={d['inserted']} insert_failed={d['insert_failed']} status={d['status']}"
            )

        return 1 if (all_sources_failed or insert_failures > 0) else 0

    except Exception as e:
        # Something broke outside any single source's own error handling
        # (e.g. the DB connection dropped mid-run). Mark the run failed
        # rather than leaving it stuck at 'running' forever.
        error_message = f"{e}\n{traceback.format_exc()}"
        print(f"\n=== FAILED ===\n{e}")
        try:
            items_seen = sum(d["listed"] for d in details)
            items_inserted = sum(d["inserted"] for d in details)
            finish_run(conn, run_id, "failed", items_seen, items_inserted, details, error_message)
        except Exception as finish_error:
            print(f"[collector] Could not record failure to collector_runs: {finish_error}")
        return 1

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
