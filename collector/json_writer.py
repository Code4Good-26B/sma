import json
import os

_DEFAULT_PATH = "data/normalized/collected_items.json"


def load_existing(path=_DEFAULT_PATH):
    """Load existing articles from the JSON file.

    Returns an empty list if the file does not exist or is empty.
    """
    if not os.path.exists(path):
        return []

    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


def _get_url(article):
    """Return the URL from an article, handling both old and new field names."""
    return article.get("source_url") or article.get("url", "")


def deduplicate(new_articles, existing):
    """Return only articles whose source_url is not already in existing.

    Handles both the old format (field: "url") and the new format (field: "source_url").
    """
    existing_urls = {_get_url(article) for article in existing}
    return [a for a in new_articles if a.get("source_url", "") not in existing_urls]


def save(articles, path=_DEFAULT_PATH):
    """Write the full article list to the JSON file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(articles, f, indent=2, ensure_ascii=False)
