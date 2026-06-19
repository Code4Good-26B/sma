from datetime import datetime, timezone


def normalize(raw_article, source):
    """Map a raw scraped article dict to the unified format.

    Field names match the DB schema (content_items table).
    Missing or None values are replaced with safe defaults.
    """
    return {
        "source_name": raw_article.get("source_name") or source["name"],
        "source_type": raw_article.get("source_type") or source["source_type"],
        "source_url": raw_article.get("source_url", ""),
        "external_id": raw_article.get("external_id") or raw_article.get("source_url", ""),
        "published_at": raw_article.get("published_at"),
        "title_en": raw_article.get("title_en", ""),
        "snippet": raw_article.get("snippet", ""),
        "raw_text": raw_article.get("raw_text", ""),
        "raw_html": raw_article.get("raw_html", ""),
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }
