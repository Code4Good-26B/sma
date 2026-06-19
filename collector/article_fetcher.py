import requests
from bs4 import BeautifulSoup

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
_TIMEOUT = 15
_EMPTY = {"raw_text": "", "raw_html": "", "published_at": None}


def extract_published_date(soup):
    """Extract the publication date from a parsed article page.

    Tries two standard patterns used by WordPress and HTML5:
    1. <meta property="article:published_time" content="2026-06-14T10:30:00+00:00">
    2. <time datetime="2026-06-14">

    Returns an ISO date string "YYYY-MM-DD" or None.
    """
    # WordPress / OpenGraph meta tag (most reliable)
    meta = soup.find("meta", property="article:published_time")
    if meta and meta.get("content"):
        try:
            return meta["content"][:10]
        except Exception:
            pass

    # HTML5 <time> tag
    time_tag = soup.find("time", attrs={"datetime": True})
    if time_tag:
        dt = time_tag.get("datetime", "")
        if len(dt) >= 10:
            return dt[:10]

    return None


def _extract_main_text(soup):
    """Extract the main article text from a parsed HTML page.

    Tries semantic tags first (<article>, <main>), then falls back to
    the largest <div> block containing text.
    """
    for tag in ("article", "main"):
        el = soup.find(tag)
        if el:
            return el.get_text(separator="\n", strip=True)

    # fallback: largest div by text length
    divs = soup.find_all("div")
    if not divs:
        return soup.get_text(separator="\n", strip=True)

    return max(divs, key=lambda d: len(d.get_text())).get_text(separator="\n", strip=True)


def fetch_article_content(url):
    """Fetch the full text, raw HTML, and publication date of an article page.

    Returns {"raw_text": str, "raw_html": str, "published_at": str | None}.
    Never raises — returns empty values on any failure so the pipeline
    continues without interruption.
    """
    if not url:
        return _EMPTY

    try:
        response = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        response.raise_for_status()
    except Exception as e:
        print(f"    [fetch] Failed to fetch {url}: {e}")
        return _EMPTY

    raw_html = response.text
    soup = BeautifulSoup(raw_html, "lxml")

    return {
        "raw_text": _extract_main_text(soup),
        "raw_html": raw_html,
        "published_at": extract_published_date(soup),
    }
