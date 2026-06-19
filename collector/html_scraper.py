import time
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from config import MAX_PAGES, MAX_PAGES_NO_DATE, REQUEST_DELAY_SECONDS

_SUPPORTED_SOURCES = {"SMA Europe", "SMA News Today"}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _parse_sma_europe_date(date_text):
    try:
        return datetime.strptime(date_text.strip(), "%b %d, %Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _fetch_page(url):
    try:
        response = requests.get(url, headers=_HEADERS, timeout=10)
        response.raise_for_status()
        return BeautifulSoup(response.text, "lxml")
    except Exception as e:
        print(f"  [html] Error fetching {url}: {e}")
        return None


def _scrape_sma_europe(source, since_date):
    """Paginate SMA Europe /news pages, stopping when articles go older than since_date."""
    base_url = "https://www.sma-europe.eu"
    since_str = str(since_date)
    all_articles = []

    for page in range(1, MAX_PAGES + 1):
        url = f"{base_url}/news" if page == 1 else f"{base_url}/news/page/{page}"
        soup = _fetch_page(url)
        if soup is None:
            break

        page_articles = []
        for link in soup.find_all("a"):
            text = link.get_text(strip=True)
            href = link.get("href", "")

            if text.lower() != "read" or not href.startswith("/news/"):
                continue

            article_block = link.find_parent()
            for _ in range(2):
                if article_block:
                    article_block = article_block.find_parent()
            if not article_block:
                continue

            block_text = article_block.get_text(" ", strip=True)
            parts = block_text.split(" ", 3)

            published_at_raw = " ".join(parts[:3]) if len(parts) >= 3 else ""
            published_at = _parse_sma_europe_date(published_at_raw)

            title_tag = article_block.find(["h2", "h3"])
            title = title_tag.get_text(" ", strip=True) if title_tag else ""

            title_and_snippet = parts[3] if len(parts) > 3 else ""
            snippet = title_and_snippet.replace(title, "", 1).strip()
            snippet = snippet.replace("Full publication", "").strip()
            if snippet.endswith(" read"):
                snippet = snippet[:-5].strip()

            full_url = urljoin(base_url, href.split("?")[0])

            page_articles.append({
                "source_name": source["name"],
                "source_type": source["source_type"],
                "source_url": full_url,
                "external_id": full_url,
                "published_at": published_at,
                "title_en": title,
                "snippet": snippet,
                "raw_text": "",
                "raw_html": "",
            })

        if not page_articles:
            print(f"  [html] SMA Europe page {page}: no articles, stopping")
            break

        in_window = [a for a in page_articles if (a["published_at"] or "") >= since_str]
        dates_on_page = [a["published_at"] for a in page_articles if a["published_at"]]

        print(
            f"  [html] SMA Europe page {page}: "
            f"{len(page_articles)} articles, {len(in_window)} within window"
        )
        all_articles.extend(in_window)

        # Stop if the oldest article on this page is before our cutoff
        if dates_on_page and min(dates_on_page) < since_str:
            print(f"  [html] Oldest article on page {page} is before {since_date}, stopping")
            break

        if page < MAX_PAGES:
            time.sleep(REQUEST_DELAY_SECONDS)

    return all_articles


def _scrape_sma_news_today(source):
    """Paginate SMA News Today /category/news/ pages up to MAX_PAGES.

    Dates are not available on listing cards — date filtering happens in main.py
    after full article content is fetched.
    """
    all_articles = []

    for page in range(1, MAX_PAGES_NO_DATE + 1):
        url = (
            "https://smanewstoday.com/category/news/"
            if page == 1
            else f"https://smanewstoday.com/category/news/page/{page}/"
        )
        soup = _fetch_page(url)
        if soup is None:
            break

        page_articles = []
        for card in soup.find_all("article"):
            link = card.find("a", href=True)
            if not link:
                continue

            href = link["href"]
            if "/news/" not in href:
                continue

            title_tag = card.find(["h2", "h3", "h1"])
            title = title_tag.get_text(strip=True) if title_tag else ""

            card_text = card.get_text(" ", strip=True)
            snippet = card_text.replace(title, "", 1).strip()
            for noise in ("Discussion", "News", "Read more", "Full publication"):
                snippet = snippet.replace(noise, "").strip()

            page_articles.append({
                "source_name": source["name"],
                "source_type": source["source_type"],
                "source_url": href,
                "external_id": href,
                "published_at": None,  # extracted later from article page
                "title_en": title,
                "snippet": snippet,
                "raw_text": "",
                "raw_html": "",
            })

        if not page_articles:
            print(f"  [html] SMA News Today page {page}: no articles, stopping")
            break

        print(f"  [html] SMA News Today page {page}: {len(page_articles)} articles")
        all_articles.extend(page_articles)

        if page < MAX_PAGES:
            time.sleep(REQUEST_DELAY_SECONDS)

    return all_articles


def fetch_from_html(source, since_date):
    """Fetch articles by HTML scraping.

    Only supports sources listed in _SUPPORTED_SOURCES.
    Returns [] for unsupported sources.
    """
    if source["name"] not in _SUPPORTED_SOURCES:
        print(f"  [html] No HTML scraper available for {source['name']}")
        return []

    if source["name"] == "SMA Europe":
        return _scrape_sma_europe(source, since_date)

    if source["name"] == "SMA News Today":
        return _scrape_sma_news_today(source)

    return []
