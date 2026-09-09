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
_EMPTY = {"raw_text": "", "published_at": None}

# Tags that are never part of the article body.
_NOISE_TAGS = (
    "script", "style", "nav", "header", "footer", "aside",
    "form", "noscript", "iframe", "figcaption",
)

# Substrings matched case-insensitively against an element's class/id.
# Kept generic on purpose: no per-site selectors, since this pipeline runs
# unattended and site-specific rules are the first thing to break silently.
_NOISE_KEYWORDS = (
    "share", "social", "related", "newsletter", "subscribe",
    "comment", "sidebar", "advert", "promo", "breadcrumb", "cookie",
)

# Structural containers are never eligible for keyword-based removal, even if
# a keyword happens to appear in their class list (e.g. WordPress commonly
# emits <body class="... no-sidebar ...">). Only their descendants can be
# removed by keyword. Removing a container that holds the article body is
# always a bug, never a cleanup.
_STRUCTURAL_TAGS = {"html", "body", "main", "article", "section"}

_MIN_LINE_LENGTH = 3

# Safety net: an absolute floor, not a ratio. The selected container is not
# always the article itself (e.g. a site with no <article>/<main> tag falls
# back to the whole page), so stripping can legitimately remove most of it —
# a short link-out blurb can be a few hundred characters once the nav menu
# around it is gone, and that is correct, not a failure. What must never
# happen is the container being emptied outright by an over-matched keyword.
# A near-empty result is never correct; a heavily-reduced one often is.
_MIN_STRIPPED_CHARS = 300


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


def _strip_noise(soup):
    """Remove elements that are never part of the article body, in place.

    Drops known non-content tags outright, plus any element whose class or id
    contains a known noise keyword (nav/share/related/etc.), matched
    case-insensitively. Generic on purpose: no per-site CSS selectors.
    """
    for tag in soup.find_all(_NOISE_TAGS):
        tag.decompose()

    for el in soup.find_all(True):
        # Skip elements already removed above (e.g. a <form> nested in a
        # <div class="share-box">, or vice versa).
        if getattr(el, "decomposed", False):
            continue
        # Never keyword-match structural containers themselves — only their
        # descendants. A container's own class list is not a reliable signal
        # (e.g. "no-sidebar" on <body> matches "sidebar").
        if el.name in _STRUCTURAL_TAGS:
            continue
        classes = el.get("class") or []
        el_id = el.get("id") or ""
        combined = " ".join(classes + [el_id]).lower()
        if any(keyword in combined for keyword in _NOISE_KEYWORDS):
            el.decompose()


def _clean_text(text):
    """Collapse the raw extracted text into readable lines.

    Drops short leftover lines (stray separators like "|" or a single word
    from a nav/share block) and collapses blank-line runs, since dropping
    short lines already removes blank ones.
    """
    lines = (line.strip() for line in text.splitlines())
    return "\n".join(line for line in lines if len(line) >= _MIN_LINE_LENGTH)


def _select_element(soup):
    """Pick the best content container from a parsed page, unstripped.

    Tries semantic tags first (<article>, <main>), then falls back to
    the largest <div> block containing text. Selection always happens on
    the unstripped page, so stripping can never remove the very container
    being selected.
    """
    for tag in ("article", "main"):
        el = soup.find(tag)
        if el:
            return el

    # fallback: largest div by text length
    divs = soup.find_all("div")
    if not divs:
        return soup

    return max(divs, key=lambda d: len(d.get_text()))


def _extract_main_text(soup):
    """Extract the main article text from a parsed HTML page.

    The content container is selected first, from the unstripped page.
    Noise-stripping then runs only on that container's descendants — never
    on the whole document — so it can never delete the container it is
    supposed to be cleaning. As a further safety net against a keyword
    happening to collide with an ordinary wrapper div inside the container,
    the unstripped text of the same container is also kept; if stripping
    removed too much, the unstripped text is used instead. This project
    runs unattended with no maintainer, so it must degrade to
    "noisy but complete" rather than "clean but empty".
    """
    el = _select_element(soup)
    unstripped_text = el.get_text(separator="\n", strip=True)

    _strip_noise(el)
    stripped_text = el.get_text(separator="\n", strip=True)

    stripped_len = len(stripped_text)
    unstripped_len = len(unstripped_text)

    stripped_too_much = (
        stripped_len < _MIN_STRIPPED_CHARS and unstripped_len > stripped_len
    )
    if stripped_too_much:
        print(
            f"    [fetch] noise stripping removed too much "
            f"({stripped_len} of {unstripped_len} chars) — using raw text"
        )
        return _clean_text(unstripped_text)

    return _clean_text(stripped_text)


def fetch_article_content(url):
    """Fetch the full text and publication date of an article page.

    Returns {"raw_text": str, "published_at": str | None}.
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

    soup = BeautifulSoup(response.text, "lxml")

    return {
        "raw_text": _extract_main_text(soup),
        "published_at": extract_published_date(soup),
    }
