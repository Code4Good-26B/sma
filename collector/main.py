"""Collector entry point.

Run from the project root:
    python collector/main.py

Scans all configured sources, fetches full article content,
deduplicates against the existing JSON file, and saves the result.

To adjust the lookback window or pagination limits, edit collector/config.py.
"""

import time
from datetime import date, timedelta

from article_fetcher import fetch_article_content
from config import LOOKBACK_DAYS, REQUEST_DELAY_SECONDS
from html_scraper import fetch_from_html
from json_writer import deduplicate, load_existing, save
from normalizer import normalize
from rss_scraper import fetch_from_rss
from sources import SOURCES

JSON_PATH = "data/normalized/collected_items.json"


def collect_all(since_date):
    since_str = str(since_date)
    all_new = []

    for source in SOURCES:
        print(f"\n[{source['name']}]")

        articles = fetch_from_rss(source, since_date)

        if not articles and source.get("html_fallback"):
            print(f"  RSS returned nothing — trying HTML fallback...")
            articles = fetch_from_html(source, since_date)

        if not articles:
            print(f"  No articles collected.")
            continue

        print(f"  Fetching full content for {len(articles)} articles...")
        fetched = []
        for i, article in enumerate(articles, 1):
            url = article.get("source_url", "")
            print(f"    ({i}/{len(articles)}) {url[:80]}")
            content = fetch_article_content(url)
            article["raw_text"] = content["raw_text"]
            article["raw_html"] = content["raw_html"]
            # Article-page date is more reliable than listing date; override if available
            if content.get("published_at"):
                article["published_at"] = content["published_at"]

            fetched.append(article)

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

        articles = fetched

        # Final filter — discards articles outside the window.
        # Catches any stragglers from sources where listing dates aren't available.
        before = len(articles)
        articles = [a for a in articles if (a.get("published_at") or "") >= since_str]
        filtered = before - len(articles)
        if filtered:
            print(f"  Filtered out {filtered} articles older than {since_date}")

        normalized = [normalize(a, source) for a in articles]
        all_new.extend(normalized)

    return all_new


def main():
    since_date = date.today() - timedelta(days=LOOKBACK_DAYS)

    print("=== SMA Collector ===")
    print(f"Collecting articles from {since_date} onwards (last {LOOKBACK_DAYS} days)")

    existing = load_existing(JSON_PATH)
    print(f"\nExisting articles in JSON: {len(existing)}")

    all_new = collect_all(since_date)

    new_only = deduplicate(all_new, existing)

    save(existing + new_only, JSON_PATH)

    print(f"\n=== Done ===")
    print(f"New articles added : {len(new_only)}")
    print(f"Already existed    : {len(all_new) - len(new_only)}")
    print(f"Total in JSON      : {len(existing) + len(new_only)}")


if __name__ == "__main__":
    main()
