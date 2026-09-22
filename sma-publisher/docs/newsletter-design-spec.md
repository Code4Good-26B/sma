# Publisher Template Redesign — Design

**Date:** 2026-06-16
**Owner:** Ran (Publisher — newsletter only)
**Status:** Approved for planning

## Goal

Make the Publisher's newsletter output match the visual style of
`site templates/template.html` (a polished Hebrew-first, RTL community
newsletter for עמותת SMA ישראל), with a defined set of changes — while
keeping the output **email-client-safe** so the raw HTML source can be pasted
directly into Gmail/Outlook compose and still render correctly.

The Publisher remains a pure file-in/file-out renderer. No summarization, no DB,
no network dependency at runtime (beyond optional web-font loading).

## Source of truth

The target design lives inside `site templates/template.html` as a
self-unpacking "bundler" document: the real markup is a JSON-encoded HTML
string in `<script type="__bundler/template">` (decoded length ~62 KB). The
React "tweaks panel", the bundler runtime, watermark/heart assets, and the
auto-`window.print()` script are **design-tool scaffolding** and are NOT part of
the Publisher output.

Design tokens extracted from the template:

- **Palette:** coral `#F28080` (brand fill), coral-ink `#ED686B` (accent text),
  teal `#68B4B4` (wordmark), teal-deep `#3F8C8C` (footer band), sage `#98C9C6`,
  coral-soft `#FBE2E2` (opener band), cloud `#F4F5F5` (publications bg / page),
  ink `#2D2D32` (headings), ink-soft `#4A4A52` (body), slate `#6B6B73` (meta),
  white `#FFFFFF`, hairline `#E4E4E7`.
- **Type:** Rubik / Heebo, system fallback. Headings 800–900 weight.
- **Shape:** rounded cards (~22px in the template), soft shadows.

## Final layout (after the requested changes)

Top → bottom, single 600px-wide centered container:

1. **Masthead** — logo (start side) + **date only** (issue number removed),
   title **עלון הקהילה** (accent-colored "הקהילה"), tagline
   "ידע הוא כוח, הבנה היא תקווה". Otherwise unchanged.
2. **Opener band** (coral-tinted, centered) — one intro paragraph. Editable
   string in `STRINGS`. Heart watermark dropped.
3. **Publications** (cloud bg) — kicker "מהמחקר העולמי" + section heading
   "פרסומים אחרונים בתחום ה‑SMA", then stacked **text-only** cards. Each card:
   - **title** (`h3`-equivalent)
   - **summary** paragraph
   - "להמשך קריאה ›" link → the article's real `url`
   - **No image. No source/category pill.**
   Followed by the medical disclaimer line (editable string).
4. **Donation band** (coral) — heading + button. Button is a real anchor linking
   to `https://www.sma.org.il/product/donation/` (configurable). Kept in place
   above the footer.
5. **Footer** (teal band) — logo, slogan "קהילה אחת, חלומות משותפים", contact
   block (phone / email / site / Facebook). Copyright line with the **issue
   number removed** ("עלון הקהילה, גיליון 12" → "עלון הקהילה"). **Unsubscribe
   link removed.** Other footer elements unchanged.

### Requested changes — explicit mapping

| # | Change | Implementation |
|---|--------|----------------|
| 1 | Remove newsletter numbering top-left; keep date | Drop `.mast-meta strong` ("גיליון N"); render date only |
| 2 | Keep other header elements | Logo, title, tagline unchanged |
| 3 | Remove images from articles | Drop `<image-slot>`; cards become single-column text |
| 4 | Remove category/tag labels above articles | Drop the `.src` pill entirely (source not shown) |
| 5 | Keep article text content | Title + summary unchanged |
| 6 | "Further reading" → proper external links | "read more" `href` = article `url` |
| 7 | Real donation link in footer area | Donation band button → configurable URL (above) |
| 8 | Remove newsletter numbering top-right | Same as #1 — only one issue number exists; removed |
| 9 | Remove unsubscribe text/link bottom-left | Drop the unsubscribe `<span>` in footer legal |
| — | Remove issue number from footer copyright too | Per approval: remove from masthead **and** footer |

## Languages

One template serves both. Driven by `STRINGS[language]`:

- **Hebrew:** `dir="rtl"`. All chrome strings taken verbatim from the template.
- **English:** `dir="ltr"` mirror. Same layout/branding flipped. Chrome strings
  translated to English by the implementer and **flagged for Ran's review**
  (CLAUDE.md: do not silently change Ran's wording).

Article fields use the existing `FIELD_MAP` (unchanged):
- en: `title`; summary from `summary`→`content`→`snippet`
- he: `title_he`→`title`; summary from `summary_he`→`publication_text_he`→…

## Date (dual, Hebrew-calendar)

Derived from the **run date** (`datetime.now()`), month+year granularity
(monthly newsletter — no specific day shown):

- **Hebrew:** `יוני 2026 · סיוון תשפ״ו` — Gregorian Hebrew month name + year,
  then Hebrew-calendar month + year via the **`pyluach`** library (pure-Python,
  added to `requirements.txt`). Note: a Gregorian month can straddle two Hebrew
  months; we take the Hebrew month of the run date itself. Acceptable for a
  monthly issue.
- **English:** `June 2026` — Gregorian English month + year only (the
  Hebrew-calendar half is Hebrew-only).

## Email-client-safe rendering (hard requirement)

The output must render when its **raw HTML source is pasted directly** into a
Gmail/Outlook compose window. This replaces the template's modern CSS with the
email-safe toolkit:

- **Table-based layout** — nested `<table>`, not `div` + flexbox/grid.
- **Inline styles on every element** — no `<style>`-block layout rules, no CSS
  variables, no `clamp()`. The palette and type scale are defined **once** as
  constants (Python constants passed to the template, or Jinja `{% set %}` vars
  at the top) and interpolated into inline `style="..."` attributes, so colors
  stay DRY.
- **Fixed widths** — centered **600px** container.
- **Colored bands** — `bgcolor` attribute + inline `background` on the opener,
  donation, and footer cells.
- **RTL** — `dir="rtl"` on tables + `align` attributes; `dir="ltr"` for English.
- **Fonts** — a Google Fonts `<link>` in `<head>` for clients that honor it
  (e.g. Apple Mail); every `font-family` ends in `Arial, sans-serif` (renders
  Hebrew) so Gmail/Outlook degrade cleanly.
- **Donation button** — bulletproof anchor-button (inline padding + `bgcolor` +
  `border-radius` + real `href`).

### Rendering matrix

| Target | Result |
|--------|--------|
| Raw HTML source pasted as email body | ✅ renders |
| Copy rendered page → paste into Gmail | ✅ renders |
| Paste HTML source into Mailchimp/Brevo | ✅ renders |
| WeasyPrint PDF | ✅ full design |
| Browser view | ✅ full design |
| **Outlook desktop** | ⚠️ square corners, no shadows (ignores `border-radius`/`box-shadow`); all content/colors/layout intact — accepted tradeoff |

## Assets & defaults

- **Logo:** keep the existing embedded data-URI approach
  (`load_logo_data_uri`, `bbd2d4…png`) for masthead + footer.
- **Watermarks / disclaimer icon:** dropped (assets exist only inside the
  bundle manifest).
- **Opener paragraph & disclaimer:** editable `STRINGS` entries; Hebrew verbatim
  from template, English translated and flagged for review.

## Files touched

- `publisher/templates/newsletter.html.j2` — full rewrite (table/inline, both langs).
- `publisher/publisher.py` — `STRINGS` additions (masthead title, tagline,
  kicker, section heading, opener, disclaimer, donation heading/button text,
  footer slogan/contact/legal); palette/type constants for the template;
  `DONATION_URL` constant (+ optional `--donation-url` CLI flag); Hebrew-calendar
  date helper using `pyluach`; remove issue-number rendering.
- `publisher/requirements.txt` — add `pyluach`.

## Out of scope (unchanged from CLAUDE.md)

- In-article images (explicitly removed here).
- DB / real Processor integration.
- Real ESP wiring.
- WordPress publishing.

## Open items / risks

- **English chrome translations** need Ran's review before they're considered
  final.
- **`pyluach` Hebrew output format** must be verified to produce
  "סיוון תשפ״ו"-style strings (month + year, gershayim) — validate during
  implementation and post-process if needed.
- **Hebrew/Gregorian month straddle** — minor; documented above.
- Root directory is **not a git repo** (only `sma/` is), so this design doc is
  written but not committed.
