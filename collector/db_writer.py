"""DB Writer — Phase 2.

Reads collected articles from the JSON file and inserts them into
the content_items table in Supabase.

Run from the project root:
    python collector/db_writer.py

Safe to run multiple times — uses ON CONFLICT (source_url) DO NOTHING,
so articles already in the DB are silently skipped.
"""

import json
import os
import sys

# Allow importing from shared/python without installing as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared", "python"))

from db_client import get_db_connection

JSON_PATH = "data/normalized/collected_items.json"

INSERT_SQL = """
    INSERT INTO content_items (
        source_name,
        source_type,
        source_url,
        external_id,
        published_at,
        title_en,
        raw_text,
        raw_html,
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
        %(raw_html)s,
        'pending',
        'not_reviewed',
        'none',
        'not_published'
    )
    ON CONFLICT (source_url) DO NOTHING
"""


def load_articles(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def is_new_format(article):
    """Return True if the article is in the new format (has source_url field)."""
    return "source_url" in article and bool(article["source_url"])


def write_to_db(articles):
    inserted = 0
    skipped = 0
    errors = 0

    conn = get_db_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                for article in articles:
                    if not is_new_format(article):
                        skipped += 1
                        continue

                    try:
                        cur.execute(INSERT_SQL, {
                            "source_name": article.get("source_name", ""),
                            "source_type": article.get("source_type", "website"),
                            "source_url":  article.get("source_url", ""),
                            "external_id": article.get("external_id"),
                            "published_at": article.get("published_at"),
                            "title_en":    article.get("title_en", ""),
                            "raw_text":    article.get("raw_text", ""),
                            "raw_html":    article.get("raw_html", ""),
                        })
                        if cur.rowcount == 1:
                            inserted += 1
                        else:
                            skipped += 1
                    except Exception as e:
                        print(f"  [db] Error inserting {article.get('source_url', '?')}: {e}")
                        errors += 1

    finally:
        conn.close()

    return inserted, skipped, errors


def main():
    print("=== SMA DB Writer ===")

    articles = load_articles(JSON_PATH)
    new_fmt = [a for a in articles if is_new_format(a)]
    old_fmt = len(articles) - len(new_fmt)

    print(f"Articles in JSON     : {len(articles)}")
    if old_fmt:
        print(f"Skipping old-format  : {old_fmt} (no source_url field)")
    print(f"Attempting to insert : {len(new_fmt)}")
    print()

    inserted, skipped, errors = write_to_db(new_fmt)

    print("=== Done ===")
    print(f"Inserted  : {inserted}")
    print(f"Skipped   : {skipped}  (already in DB)")
    print(f"Errors    : {errors}")


if __name__ == "__main__":
    main()
