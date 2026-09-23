# SMA Newsletter — Publisher

**This package is reference, not production.** The live newsletter is generated
inside the Dashboard (`dashboard/src/lib/buildNewsletterHtml.js`), a JavaScript
port of the Jinja template in this folder — the Dashboard is a static React app
on Vercel with no backend, so it cannot run this Python at runtime, and there is
no separate Publisher service (see `docs/db_contract.md`, "Dashboard (as
Publisher)"). `publisher.py` here still runs, but only against the sample
fixtures in `sample_articles/` — it has no connection to the real database and
will happily produce a newsletter that goes nowhere. `send_brevo.py` is unused
by the running system and was never tested end to end against a real mailing
list. If you have opened this folder expecting to find how newsletters actually
get sent today: they don't get sent automatically at all — Michal generates and
downloads/copies the newsletter from the Dashboard and sends it herself. Running
`publisher.py` will produce a newsletter file, but believing that is the system
in action is the mistake this paragraph exists to prevent.

Renders the monthly Hebrew/English newsletter for **Israel SMA Families Association**
(עמותת משפחות SMA ישראל) and optionally sends it through Brevo.

## Where this sits in the project

The project automates SMA news: collect English articles → summarize and translate
to Hebrew with an LLM → the association's program manager (Michal) curates them →
publish.

```
[Sources] → Collector → Processor → Dashboard → Publisher → [WordPress site + Newsletter]
             (Ben)       (Iris)       (Mai)      (this)
```

| Component | Owner | Does |
|-----------|-------|------|
| Collector | Ben  | Fetches + dedupes articles from SMA Europe, Cure SMA, SMA News Today |
| Processor | Iris | LLM → Hebrew title, short summary, publication paragraph |
| Dashboard | Mai  | React UI where Michal reviews, edits, and routes each item |
| Publisher | this | Turns approved items into the newsletter |

Components talk through a shared Supabase/Postgres database, not directly —
see `docs/db-contract.md`.

**Scope of this package: the newsletter only.** The wider Publisher role also
covers pushing items to the WordPress site; that is not built here.

## What it produces

One run writes four files to `output/`:

- `newsletter_he.html` / `newsletter_he.pdf` — Hebrew, RTL
- `newsletter_en.html` / `newsletter_en.pdf` — English, LTR

The HTML is email-client-safe (table layout, inline styles), so the raw source can
be pasted straight into a Gmail/Outlook compose window or into Mailchimp/Brevo's
code editor. Pre-rendered copies are in `examples/` if you just want to look.

Every run overwrites `output/` in place — no versioning.

## Layout

```
src/publisher.py              entry point: load JSON → render HTML → render PDF
src/send_brevo.py             optional: push the rendered HTML to Brevo
src/templates/                the single Jinja template, language-aware
sample_articles/*.json        4 example articles (hand-made, not real pipeline output)
examples/                     pre-rendered newsletters, he + en
assets/logo.png               logo fallback for browser/PDF (see note below)
docs/db-contract.md           the shared DB field contract — the integration point
docs/newsletter-design-spec.md  approved design spec for the template
docs/project-docs/            association brief, per-component sprint plans (Hebrew)
```

## Running it

```bash
pip3 install -r requirements.txt     # jinja2, weasyprint
python3 src/publisher.py             # both languages, HTML + PDF
```

Flags: `--language he|en|both`, `--skip-pdf` (HTML only, no WeasyPrint needed),
`--input-dir`, `--output-dir`, `--logo-url`, `--donation-url`.

On macOS WeasyPrint needs Pango: `brew install pango`. `_prime_macos_library_path()`
in `src/publisher.py` already works around ctypes not finding
`/opt/homebrew/lib/libgobject-2.0.dylib`; if you hit a "cannot load library
libgobject" error, that function is where to look.

## Article JSON

One file per article in `sample_articles/`; `publisher.py` reads every `*.json`
in the directory. Each file simulates one article *after* the Processor has run.
Field selection is `FIELD_MAP` at the top of `src/publisher.py`:

- English reads `title`, then `content` or `snippet`
- Hebrew reads `title_he` → `title`, and `summary_he` → `publication_text_he` →
  `content` → `snippet`

Also used: `source`, `url`, `published_at`.

**These samples are fixtures, not real data** — the Hebrew is a rough hand
translation. In production the fields come from the database.

## Sending through Brevo

`publisher.py` only writes files. `send_brevo.py` pushes them to Brevo (stdlib
only). It reads `BREVO_API_KEY` from a `.env` at this folder's root — copy
`.env.example` and fill it in. With no action flag it does a dry run.

```bash
python3 src/send_brevo.py --language he                    # dry run
python3 src/send_brevo.py --language he --to "a@x.com"     # transactional send
python3 src/send_brevo.py --language he --create           # draft campaign in Brevo
python3 src/send_brevo.py --language he --send             # real send to the list
```

Current Brevo account: verified sender `ran.mahalal@gmail.com` (sender id 1),
list id 2 "SMA Newsletter" (empty). `--test` only reaches addresses already in
the account; use `--to` for arbitrary ones.

**No API key ships with this package.** Get one from the Brevo account, or create
your own — the code needs nothing else.

## Two things that are easy to get wrong

- **The logo must be a hosted URL for email.** Gmail and most clients block
  embedded `data:` images. `LOGO_URL` in `src/publisher.py` defaults to the
  association's own hosted logo. `assets/logo.png` is only the offline fallback
  used when `--logo-url ""` is passed; it will not render in email.
- **WeasyPrint ignores `dir`/`direction` for table cell order.** The masthead logo
  is pinned with explicit cell widths and `text-align` instead — don't "fix" that
  by switching to `dir`.

See `NOTES.md` for design decisions and what's still open.
