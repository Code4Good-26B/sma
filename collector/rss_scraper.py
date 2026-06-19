import html
import re
import time
from datetime import datetime

import feedparser
import requests

from config import MAX_PAGES, REQUEST_DELAY_SECONDS


def _parse_date(entry):
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        return datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
    return None


_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Some RSS feeds contain invalid XML entities (e.g. &nbsp; &mdash;).
# We strip them before passing to feedparser so it can still parse entries.
_INVALID_ENTITY_RE = re.compile(r"&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);)")


def _fetch_raw_feed(url):
    """Fetch the raw RSS feed content, cleaning up invalid XML entities."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=15)
        resp.raise_for_status()
        cleaned = _INVALID_ENTITY_RE.sub("&amp;", resp.text)
        return cleaned.encode("utf-8")
    except Exception as e:
        print(f"  [rss] HTTP error fetching {url}: {e}")
        return None


def fetch_from_rss(source, since_date):
    """Fetch articles from an RSS feed published on or after since_date.

    Paginates through ?paged=N, stopping when the oldest article on a page
    is older than since_date, or when MAX_PAGES is reached.

    Returns [] on failure so the caller can try an HTML fallback.
    """
    rss_url = source.get("rss_url")
    if not rss_url:
        return []

    since_str = str(since_date)
    all_articles = []

    for page in range(1, MAX_PAGES + 1):
        page_url = rss_url if page == 1 else f"{rss_url}?paged={page}"

        raw = _fetch_raw_feed(page_url)
        if raw is None:
            break

        try:
            feed = feedparser.parse(raw)
        except Exception as e:
            print(f"  [rss] Error parsing feed page {page} for {source['name']}: {e}")
            break

        if feed.bozo and not feed.entries:
            print(f"  [rss] Feed parse error on page {page}: {feed.bozo_exception}")
            break

        if not feed.entries:
            print(f"  [rss] Page {page}: no entries, stopping")
            break

        dates_on_page = [_parse_date(e) for e in feed.entries]
        dates_on_page = [d for d in dates_on_page if d]

        in_window = [e for e in feed.entries if (_parse_date(e) or "") >= since_str]
        print(
            f"  [rss] {source['name']} page {page}: "
            f"{len(feed.entries)} entries, {len(in_window)} within window"
        )

        for entry in in_window:
            all_articles.append({
                "source_name": source["name"],
                "source_type": source["source_type"],
                "source_url": entry.get("link", ""),
                "external_id": entry.get("id") or entry.get("link", ""),
                "published_at": _parse_date(entry),
                "title_en": entry.get("title", ""),
                "snippet": html.unescape(entry.get("summary", "")),
                "raw_text": "",
                "raw_html": "",
            })

        # Stop if the oldest article on this page is already past the cutoff
        if dates_on_page and min(dates_on_page) < since_str:
            print(f"  [rss] Oldest article on page {page} is before {since_date}, stopping")
            break

        if page < MAX_PAGES:
            time.sleep(REQUEST_DELAY_SECONDS)

    return all_articles
