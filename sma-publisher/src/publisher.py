"""Generate the SMA newsletter (HTML + PDF) in English and Hebrew."""

import argparse
import base64
import json
import sys
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

# Field lookups per language. The Processor will produce Hebrew variants
# (`title_he`, `summary_he`, `publication_text_he`) — until then, Hebrew falls
# back to the English fields so the layout is still testable.
FIELD_MAP = {
    "en": {
        "title": ("title",),
        "summary": ("summary", "content", "snippet"),
    },
    "he": {
        "title": ("title_he", "title"),
        "summary": ("summary_he", "publication_text_he", "summary", "content", "snippet"),
    },
}

# Donation page on the association's WordPress site. Override with --donation-url.
DONATION_URL = "https://www.sma.org.il/product/donation/"

# Public URL for the masthead/footer logo. REQUIRED for email — Gmail and most
# clients block embedded base64 `data:` images, so the logo must be linked.
# When empty, falls back to the embedded data-URI (fine for the browser/PDF).
# Override with --logo-url.
LOGO_URL = "https://www.sma.org.il/wp-content/uploads/2024/05/Group-152.png"

# Brand palette + font stack, lifted from `site templates/template.html`. Kept here
# (not in the template) so colors are defined once and interpolated into the
# email-safe inline styles. See the redesign spec in docs/superpowers/specs/.
THEME = {
    "coral": "#F28080",       # brand fill / donation band
    "coral_ink": "#ED686B",   # accent text / links
    "coral_deep": "#D9534F",  # button text on white
    "coral_soft": "#FBE2E2",  # opener band wash
    "teal": "#68B4B4",        # wordmark accent
    "teal_deep": "#3F8C8C",   # footer band
    "ink": "#2D2D32",         # headings
    "ink_soft": "#4A4A52",    # body
    "slate": "#6B6B73",       # meta / summaries
    "mute": "#9A9AA2",        # disclaimer
    "cloud": "#F4F5F5",       # publications band background
    "page": "#FFFFFF",        # white backdrop — sheet is full-width, so any client margin stays invisible
    "white": "#FFFFFF",
    "line": "#E4E4E7",        # hairline borders
    # Web fonts (Google Fonts link in <head>) with Hebrew-capable system fallback.
    "font": "'Rubik','Heebo',Arial,Helvetica,sans-serif",
}

# Gregorian month names in Hebrew, for the Hebrew masthead date.
HE_GREG_MONTHS = [
    "", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
]

# Chrome strings, per language. Hebrew is taken verbatim from the association's
# template; English mirrors it in LTR and is PENDING RAN'S REVIEW (translations,
# not final wording). Per-article body text comes from the input JSON, not here.
STRINGS = {
    "en": {
        "dir": "ltr",
        "lang_attr": "en",
        "title_a": "Community",       # masthead title, leading word
        "title_b": "Newsletter",      # masthead title, accent-colored word
        "tagline": "Knowledge is power, understanding is hope",
        "kicker": "FROM GLOBAL RESEARCH",
        "section_heading": "Recent publications on SMA",
        "opener": (
            "SMA research is advancing at a pace we've never seen — and every "
            "breakthrough comes down to one question for us: what does it mean for "
            "our children and adults, here and now."
        ),
        "read_more": "Read more ›",
        "disclaimer": (
            "This information is provided for general knowledge and to make current "
            "research accessible; it is not medical advice or a recommendation. For "
            "any treatment decision, consult your medical team."
        ),
        "donation_heading": "Every donation becomes care and a supportive community.",
        "donation_button": "Donate to the association ›",
        "footer_slogan": "One community, shared dreams",
        "phone_prefix": "Tel. ",
        "contact_phone": "052-4581058",
        "contact_email": "sma.org.il@gmail.com",
        "site_label": "www.sma.org.il",
        "site_url": "https://www.sma.org.il",
        "facebook_label": "Facebook · SMA Israel Community",
        "copyright": "© 2026 SMA Israel Association · Community Newsletter",
        "logo_alt": "SMA Israel Association",
    },
    "he": {
        "dir": "rtl",
        "lang_attr": "he",
        "title_a": "עלון",
        "title_b": "הקהילה",
        "tagline": "ידע הוא כוח, הבנה היא תקווה",
        "kicker": "מהמחקר העולמי",
        "section_heading": "פרסומים אחרונים בתחום ה‑SMA",
        "opener": (
            "המחקר על SMA מתקדם בקצב שלא הכרנו — וכל פריצת דרך מתורגמת אצלנו לשאלה "
            "אחת: מה זה אומר עבור הילדים והמבוגרים שלנו, כאן ועכשיו."
        ),
        "read_more": "להמשך קריאה ›",
        "disclaimer": (
            "המידע מובא לידע כללי ולהנגשת המחקר העדכני, ואינו מהווה ייעוץ או המלצה "
            "רפואית. לכל החלטה טיפולית התייעצו עם הצוות הרפואי המטפל."
        ),
        "donation_heading": "כל תרומה מתורגמת למעטפת טיפול ולקהילה תומכת.",
        "donation_button": "לתרומה לעמותה ›",
        "footer_slogan": "קהילה אחת, חלומות משותפים",
        "phone_prefix": "טל׳ ",
        "contact_phone": "052-4581058",
        "contact_email": "sma.org.il@gmail.com",
        "site_label": "www.sma.org.il",
        "site_url": "https://www.sma.org.il",
        "facebook_label": "פייסבוק · קהילת SMA ישראל",
        "copyright": "© 2026 עמותת SMA ישראל · עלון הקהילה",
        "logo_alt": "עמותת SMA ישראל",
    },
}


def issue_date(language: str, today=None) -> str:
    """Masthead issue date derived from the run date (Gregorian month + year).

    Hebrew uses the Hebrew month name (e.g. 'יוני 2026'); English uses the
    English month name (e.g. 'June 2026').
    """
    if today is None:
        today = datetime.now().date()
    if language == "he":
        return f"{HE_GREG_MONTHS[today.month]} {today.year}"
    return today.strftime("%B %Y")


def load_logo_data_uri(project_root: Path) -> str:
    """Base64 logo fallback, used only when no --logo-url is set.

    Fine for the browser and the PDF; email clients block data: images, which is
    why LOGO_URL is the default.
    """
    logo_path = project_root / "assets" / "logo.png"
    if not logo_path.exists():
        return ""
    encoded = base64.b64encode(logo_path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def load_articles(input_dir: Path) -> list[dict]:
    articles = []
    for path in sorted(input_dir.glob("*.json")):
        with path.open(encoding="utf-8") as f:
            articles.append(json.load(f))
    return articles


def pick_field(article: dict, candidates: tuple[str, ...]) -> str:
    for field in candidates:
        value = article.get(field)
        if value and str(value).strip():
            return str(value).strip()
    return ""


def to_section(article: dict, language: str) -> dict:
    # The redesigned card shows title, summary, and an external "read more" link
    # only — no per-article image, source pill, or date.
    fields = FIELD_MAP[language]
    return {
        "title": pick_field(article, fields["title"]) or "Untitled",
        "url": article.get("url", "#"),
        "summary": pick_field(article, fields["summary"]),
    }


def render_html(
    articles: list[dict],
    language: str,
    template_dir: Path,
    logo_data_uri: str = "",
    donation_url: str = DONATION_URL,
    logo_url: str = "",
) -> str:
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template("newsletter.html.j2")
    return template.render(
        strings=STRINGS[language],
        theme=THEME,
        issue_date=issue_date(language),
        articles=[to_section(a, language) for a in articles],
        logo_data_uri=logo_data_uri,
        donation_url=donation_url,
        logo_url=logo_url,
    )


def _prime_macos_library_path() -> None:
    import os
    import platform

    if platform.system() != "Darwin":
        return
    for prefix in ("/opt/homebrew/lib", "/usr/local/lib"):
        if Path(prefix, "libgobject-2.0.dylib").exists():
            existing = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
            if prefix not in existing.split(":"):
                os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
                    f"{prefix}:{existing}" if existing else prefix
                )
            return


def write_pdf(html: str, output_path: Path) -> None:
    _prime_macos_library_path()
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:
        raise SystemExit(
            f"Could not load WeasyPrint: {exc}\n"
            "Install deps: pip install -r requirements.txt\n"
            "On macOS you may also need: brew install pango"
        ) from exc
    HTML(string=html).write_pdf(str(output_path))


def build_for_language(
    articles: list[dict],
    language: str,
    template_dir: Path,
    output_dir: Path,
    skip_pdf: bool,
    logo_data_uri: str = "",
    donation_url: str = DONATION_URL,
    logo_url: str = "",
) -> None:
    html = render_html(articles, language, template_dir, logo_data_uri, donation_url, logo_url)
    html_path = output_dir / f"newsletter_{language}.html"
    html_path.write_text(html, encoding="utf-8")
    print(f"Wrote {html_path}")

    if not skip_pdf:
        pdf_path = output_dir / f"newsletter_{language}.pdf"
        write_pdf(html, pdf_path)
        print(f"Wrote {pdf_path}")


def main() -> int:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=here.parent / "sample_articles",
        help="Directory of article JSON files, one article per file (default: sample_articles/).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=here.parent / "output",
        help="Where to write the newsletter files.",
    )
    parser.add_argument(
        "--language",
        choices=("en", "he", "both"),
        default="both",
        help="Which version(s) to generate (default: both).",
    )
    parser.add_argument(
        "--skip-pdf",
        action="store_true",
        help="Only produce the HTML output (useful if WeasyPrint isn't installed).",
    )
    parser.add_argument(
        "--donation-url",
        default=DONATION_URL,
        help=f"Donation link for the footer/CTA button (default: {DONATION_URL}).",
    )
    parser.add_argument(
        "--logo-url",
        default=LOGO_URL,
        help="Public URL for the logo (required for email; data-URI is used if empty).",
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    articles = load_articles(args.input_dir)
    if not articles:
        print(f"No .json article files found in {args.input_dir}", file=sys.stderr)
        return 1

    logo_data_uri = load_logo_data_uri(here.parent)

    languages = ("en", "he") if args.language == "both" else (args.language,)
    print(f"Loaded {len(articles)} articles. Generating: {', '.join(languages)}")
    for language in languages:
        build_for_language(
            articles, language, here / "templates", args.output_dir,
            args.skip_pdf, logo_data_uri, args.donation_url, args.logo_url,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
