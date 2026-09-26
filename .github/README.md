# Automation

This project runs unattended. There is no maintainer watching it day to day, so this
folder exists to make the system keep itself alive and to give a non-technical person
a way to check whether it's actually working.

Three GitHub Actions workflows live in `.github/workflows/`.

---

## `daily.yml` — runs the whole daily chain

- **Schedule:** requested for 05:17 UTC daily (08:17 Israel time). GitHub does not
  guarantee scheduled-run start times — measured start times have been 4-5 hours
  later than requested on separate days. Nothing in this project is time-sensitive,
  so this doesn't matter in practice; don't rely on it starting near the requested
  time. Check `collector_runs` or the Actions run history for when a run actually
  happened.
- **Manual run:** open the **Actions** tab → **Daily pipeline** → **Run workflow**.
  Use this any time you want to check "is this still working?" without waiting for
  the next scheduled run.
- **What it does:** installs the Python dependencies from `requirements.txt`, then
  runs three steps in order, every day:
  1. **Collect new articles** (`python collector/main.py`) — scrapes each configured
     news source, checks the database for articles already collected, downloads only
     the new ones, and inserts them.
  2. **Summarize new articles (Pass 1)** (`python processor/process_from_db.py
     --limit 10`) — generates a Hebrew title and short summary for newly collected
     articles, so Michal can decide "interesting or not" in the dashboard.
  3. **Write newsletter texts (Pass 2)** (`python processor/process_newsletter_text.py
     --limit 10`) — generates the full Hebrew publication text for articles Michal has
     already approved.
- **Steps 2 and 3 run even if an earlier step failed.** Pass 1 processes whatever is
  already waiting in the database — including articles from previous days — and
  Pass 2 processes whatever Michal has already approved, independent of whether
  today's collection succeeded. A failure in step 1 still fails the overall job (and
  still sends the email), it just doesn't block the other two from doing their part.
- **The `--limit 10` on steps 2 and 3 is deliberate, not a typo.** The Gemini free
  tier allows roughly 20 requests/day *per model*. Normal load is 1-2 articles a day,
  so this limit is invisible in practice. But if the pipeline has been broken for a
  while, the Collector's 14-day lookback can hand Pass 1 (or an approval backlog can
  hand Pass 2) far more than 10 articles in one run. Without a limit, that single run
  would exhaust the day's quota and fail loudly; with it, 10 get processed, the run
  exits cleanly, and the rest are simply still eligible tomorrow — the backlog drains
  over a few days instead of failing in one.

### The two required secrets

The pipeline needs two secrets:

- **`DATABASE_URL`** — the Postgres connection string for the Supabase database
  (same value as in a local `.env` file). Required by all three steps.
- **`GEMINI_API_KEY`** — the Gemini API key used by both processor passes.

To set either: **Settings → Secrets and variables → Actions → New repository
secret**.

**What breaks if one is missing:**

- Without `DATABASE_URL`, every step fails immediately (the Collector and both
  processor passes all need the database).
- Without `GEMINI_API_KEY`, **both processor steps fail immediately with a clear
  "GEMINI_API_KEY is not set" error, while the Collector step still succeeds** —
  collection doesn't need Gemini at all, only summarizing and writing publication
  text do.

---

## `publication-text.yml` — extra Pass 2 attempts, every 6 hours

- **What it does:** runs ONLY `python processor/process_newsletter_text.py --limit 5` —
  the exact same Pass 2 script `daily.yml` runs, nothing else. It never runs the
  Collector and never runs Pass 1 (`process_from_db.py`) — see the three constraints
  below.
- **Schedule:** every 6 hours, at 02:23 / 08:23 / 14:23 / 20:23 UTC
  (`cron: "23 2,8,14,20 * * *"`). Off the top of the hour for the same load-concentration
  reason as `daily.yml`'s own minute offset.
- **Manual run:** Actions tab → **Publication text (frequent)** → **Run workflow**.
- **Why it exists:** Gemini availability is time-of-day dependent, and this project has
  observed multi-day streaks of 503s. Pass 2 otherwise gets exactly one attempt per day;
  a 503 at that one moment costs Michal a full day, and several such days in a row is
  what she experiences as "the text never arrives". Sampling Gemini a few more times a
  day, hours apart (not minutes — that samples almost the same conditions), meaningfully
  shortens that wait without changing anything else about how Pass 2 works.
- **It can never fail the workflow run, by design.** The Pass 2 step uses
  `continue-on-error: true` — its true outcome (success/failure) and its full log are
  still visible in the Actions UI exactly as normal, but the JOB's overall conclusion is
  decoupled from it, which is what actually controls whether GitHub sends a failure
  email. **This is not swallowing a real failure**: `daily.yml` runs the identical script
  against the identical selection query once a day and DOES report failures normally, so
  a real, non-transient problem still fails the daily pipeline and still sends the one
  failure email this project has. This workflow is additional attempts, never the only
  path to anything.
- **It shares `daily.yml`'s exact concurrency group (`daily-pipeline`).** This guarantees
  a frequent run can never overlap the daily run, or another frequent run. Two concurrent
  Pass 2 runs would select the same rows (`newsletter_text_he IS NULL`) and spend Gemini
  quota twice for one result.
- **`--limit 5`, not `daily.yml`'s 10.** The Gemini quota is per **project**, shared with
  Pass 1. This workflow can run up to 4 extra times a day on top of the daily run, so a
  larger limit here risks a backlog of stuck publication texts burning quota overnight —
  leaving Pass 1 with nothing left the next morning, so newly collected articles would
  never even get triaged, let alone reach Michal. A queue stuck at the publishing stage
  must not be able to hide fresh news from the triage stage.

### Three constraints this workflow must never violate

1. **No Pass 1.** `MAX_PROCESSING_ATTEMPTS = 14` (in `process_from_db.py`) was chosen
   assuming one run per day — 14 attempts at once a day equals the 14-day tolerance
   window this project is built around. Running Pass 1 four times a day would burn all
   14 attempts in under three days, so a multi-day Gemini outage (already observed)
   would permanently discard articles that today are simply retried. The retry counter
   would become the destruction mechanism instead of the protection it's meant to be.
2. **No Collector.** `smanewstoday.com` is behind Cloudflare bot protection that has
   already blocked this project once (2026-09-20: a straight 403, and separately a page
   that quietly parsed to zero articles). Fetching it four times a day instead of once
   multiplies the chance of turning a temporary block into a permanent one, for no
   benefit — the 14-day lookback already means once-daily collection loses nothing.
3. **`--limit 5`, not 10.** See above.

---

## `heartbeat.yml` — keeps the schedule itself alive

**Read this even if you skip everything else on this page.**

GitHub automatically **disables a scheduled workflow after 60 days with no
repository activity**. This project is handed over with no ongoing maintainer, so
nobody will be pushing commits — which means, without a countermeasure, BOTH
scheduled pipeline workflows' schedules (`daily.yml` and `publication-text.yml`)
would silently stop working around month three, and nobody would notice.

`heartbeat.yml` exists purely to prevent that. Once a month it:

1. Writes the current UTC timestamp to `.github/last-heartbeat.txt` and commits it —
   a small, harmless change whose only job is to keep the repository "active" in
   GitHub's eyes (this protects every scheduled workflow in the repository, not
   just one).
2. As a second line of defense, explicitly re-enables both `daily.yml` and
   `publication-text.yml` through the GitHub API, in case either was disabled for
   some other reason.

**It is not a health check.** It does not verify the pipeline is working — only that
the schedule mechanism stays turned on. Do not delete this file thinking it's
pointless busywork; deleting it will cause both pipeline workflows to stop running
roughly two months later, silently.

### If a pipeline workflow is ever found disabled anyway

Go to the **Actions** tab → the workflow's name in the left sidebar (**Daily
pipeline** or **Publication text (frequent)**) → there will be a banner saying the
workflow is disabled → click **Enable workflow**. That's the entire fix — one click,
for whichever of the two it was.

---

## What a failure email means (and doesn't mean)

Every step's exit code is written to mean "a human needs to look at this" — not "one
article had a bad day". As of 2026-09-26 this is decided by **why** an article failed,
not by how many succeeded: a success count is a bad proxy for "systemic" at this
project's volume (1-3 articles per run). One bad five-second window at Google can fail
every article in a run and looks identical to a dead API key — this happened for real
on 2026-09-24 (three articles, all HTTP 503) and would have emailed Michal every
morning through a multi-day outage under the old rule.

- **Every Gemini failure is classified as `transient` or `not_transient`**
  (`processor/gemini.py`, the `FailureKind` type), computed directly from the HTTP
  status Gemini actually returned — never by parsing an error message string, so a
  message-format change can't silently break this:
  - **Transient** — a network error/timeout, HTTP 429 (rate limit), or any HTTP 5xx.
    Another attempt, later, can succeed without anyone doing anything.
  - **Not transient** — HTTP 401/403, any other 4xx, or a response that came back but
    was unusable (bad JSON, a missing/empty field). The system will not recover by
    itself.
- **A run where every failure was transient is NOT an email**, no matter how many
  articles failed. The log shows a `NOTE:` line saying how many will be retried and
  why no alert was raised, but the job exits 0.
- **An email means one of:**
  1. **Any failure was not transient** — almost always a real, systemic cause: a
     revoked or missing API key, or some other request-level problem that will not fix
     itself by waiting.
  2. **An article exhausted all 14 Pass 1 attempts** (`process_from_db.py`,
     `MAX_PROCESSING_ATTEMPTS`). Permanent — that article will never be picked up
     again, and Michal will never see it — so it forces the email even if every other
     article in that run succeeded, and even if every individual failure was itself
     transient (14 straight transient failures is still a permanent loss on the 14th).
  3. **A Pass 2 article that was actually attempted and failed in this run has been
     waiting since `reviewed_at` for more than 14 days**
     (`process_newsletter_text.py`, `PASS2_FLOOR_DAYS`). Pass 2 has no attempt
     counter — its retry is the daily re-selection itself, unlimited — so without
     this floor a genuinely stuck article could fail silently forever as long as each
     day's failure happened to look transient. **Articles skipped for empty
     `raw_text` never count toward this floor**: such an article will never get a
     publication text on any future run either, so counting it would mean emailing
     about it every single day, forever.

The reasoning behind this: the failure email is the *only* automatic signal this
project has once handed over. If it fired on conditions that fix themselves tomorrow,
whoever inherits this project would learn to ignore it within a month — and then the
alert that actually matters would be invisible too.

---

## If Gemini starts returning 404 for a model ("model X is no longer available")

Both processor passes call Gemini through a short list of fallback model names in
`processor/gemini.py` — but it's **two separate lists**, not one, because the two
passes tolerate a weak result differently (see that file's top comment for the full
reasoning):

- `TRIAGE_MODEL_CANDIDATES` (Pass 1) — full-flash models, then flash-lite models.
  Pass 1 only needs to survive; a rougher summary still lets Michal decide
  "interesting or not", so the lite tier is included as a last resort.
- `PUBLICATION_MODEL_CANDIDATES` (Pass 2) — full-flash models only, no lite tier.
  This text is what families actually read in the newsletter, and lite models were
  observed producing real errors (a garbled word, a stray Cyrillic character) that
  full-flash output didn't. Pass 2 has no attempt limit, so it can simply wait for a
  good model rather than settle for a worse one.

Google periodically retires specific model versions, which turns up in the log as an
HTTP 404 for that name. **The fix is one line, not a redesign:**

1. The 404 error message from Google usually names the current replacement model
   directly — use that name.
2. If it doesn't, confirm the current model names by calling
   `https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY`
   yourself (see `processor/gemini.py`'s top comment for what's currently verified;
   documentation pages go stale, this API call is always current) and look for a
   `flash` model with `generateContent` in `supportedGenerationMethods`.
3. Add that name to whichever list (and tier within it) matches: `TRIAGE_MODEL_CANDIDATES`
   if it's a Pass 1 404, `PUBLICATION_MODEL_CANDIDATES` if it's a Pass 2 404 — full-flash
   names near the top of either list, flash-lite names near the bottom of
   `TRIAGE_MODEL_CANDIDATES` only. Nothing else needs to change: the fallback logic,
   retry counts, and prompts are unaffected by which model names are in either list.

As of the check that added this note, both `gemini-flash-latest` (full model) and
`gemini-flash-lite-latest` (lite model) exist as Google-maintained aliases that never
404 on retirement — that's why each leads its respective list. Verify this is still
true with the API call above before assuming it.

---

## How to check whether the pipeline is actually working

Two ways, and you don't need to be technical for the first one:

1. **Actions tab → Daily pipeline → run history.** Green checkmark = that run
   succeeded (or had only self-healing partial failures). Red X = something needs
   attention (and an email should already have gone out). **This does not apply to
   Publication text (frequent)'s run history** — by design (see above), that
   workflow's job always shows green even when its Pass 2 attempt failed, so its
   run history tells you nothing; Daily pipeline's own run history and email are
   still the real signal.
2. **The `collector_runs` database table** (Collector only — the two processor passes
   don't have an equivalent table yet). Every Collector run — scheduled or manual —
   writes a row here with its status, how many articles it found, and how many it
   inserted. Run the health query at the top of [`db/check.sql`](../db/check.sql) to
   see the most recent run at a glance, or see the "Health monitoring" section of
   [`docs/db_contract.md`](../docs/db_contract.md) for what the different statuses
   mean. A run that finds zero new articles and reports `success` is normal — quiet
   weeks happen.

---

## Summary of what NOT to delete

| File | Why it matters |
|---|---|
| `workflows/daily.yml` | The actual daily job: Collector, then Pass 1, then Pass 2. |
| `workflows/publication-text.yml` | Extra Pass-2-only attempts every 6 hours. Safe to delete without losing correctness — `daily.yml` still does the same work and still alerts on real failures — but removing it lengthens Michal's wait during a Gemini outage. |
| `workflows/heartbeat.yml` | Keeps `daily.yml`'s (and `publication-text.yml`'s) schedules from being auto-disabled after 60 days. |
| `last-heartbeat.txt` | Written by `heartbeat.yml`; harmless, but don't remove the workflow that maintains it. |
