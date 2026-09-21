# Automation

This project runs unattended. There is no maintainer watching it day to day, so this
folder exists to make the system keep itself alive and to give a non-technical person
a way to check whether it's actually working.

Two GitHub Actions workflows live in `.github/workflows/`.

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

## `heartbeat.yml` — keeps the schedule itself alive

**Read this even if you skip everything else on this page.**

GitHub automatically **disables a scheduled workflow after 60 days with no
repository activity**. This project is handed over with no ongoing maintainer, so
nobody will be pushing commits — which means, without a countermeasure, the daily
pipeline's schedule would silently stop working around month three, and nobody would
notice.

`heartbeat.yml` exists purely to prevent that. Once a month it:

1. Writes the current UTC timestamp to `.github/last-heartbeat.txt` and commits it —
   a small, harmless change whose only job is to keep the repository "active" in
   GitHub's eyes.
2. As a second line of defense, explicitly re-enables the `daily.yml` workflow through
   the GitHub API, in case it was ever disabled for some other reason.

**It is not a health check.** It does not verify the pipeline is working — only that
the schedule mechanism stays turned on. Do not delete this file thinking it's
pointless busywork; deleting it will cause the daily pipeline to stop running roughly
two months later, silently.

### If the daily pipeline workflow is ever found disabled anyway

Go to the **Actions** tab → **Daily pipeline** (in the left sidebar) → there will be
a banner saying the workflow is disabled → click **Enable workflow**. That's the
entire fix — one click.

---

## What a failure email means (and doesn't mean)

Every step's exit code is written to mean "a human needs to look at this" — not "one
article had a bad day". Concretely:

- **A partial run is NOT an email.** If some articles succeed and others fail in the
  same run, that's treated as normal and self-correcting: a failed Pass 1 article is
  automatically retried on a later run (up to 14 attempts total — chosen to match the
  Collector's own 14-day lookback, since Gemini's free tier does not guarantee
  capacity and live runs have shown multi-day outages across every fallback model at
  once), and a failed Pass 2 article is retried indefinitely (it simply still has no
  publication text, so it's picked up again tomorrow). The log will show a `NOTE:`
  line explaining this, but the job exits 0 and no email is sent.
- **An email means one of two things:**
  1. **Nothing succeeded at all** in a step that had work to do — almost always a
     systemic cause: a revoked or missing API key, Gemini being down, the database
     being unreachable. Something is actually broken, not just one bad article.
  2. **An article exhausted all 14 Pass 1 attempts.** Unlike an ordinary failure, this
     is permanent — that article will never be picked up again, and Michal will never
     see it — so it forces the email even if every other article in that run
     succeeded. (Pass 2 has no such case: its retry is unlimited, so nothing is ever
     permanently lost there.)

The reasoning behind this: the failure email is the *only* automatic signal this
project has once handed over. If it fired on conditions that fix themselves tomorrow,
whoever inherits this project would learn to ignore it within a month — and then the
alert that actually matters would be invisible too.

---

## If Gemini starts returning 404 for a model ("model X is no longer available")

Both processor passes call Gemini through a short list of fallback model names in
`processor/gemini.py` (`MODEL_CANDIDATES`). Google periodically retires specific
model versions, which turns up in the log as an HTTP 404 for that name. **The fix
is one line, not a redesign:**

1. The 404 error message from Google usually names the current replacement model
   directly — use that name.
2. If it doesn't, confirm the current model names by calling
   `https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY`
   yourself (see `processor/gemini.py`'s top comment for what's currently verified;
   documentation pages go stale, this API call is always current) and look for a
   `flash` model with `generateContent` in `supportedGenerationMethods`.
3. Add that name to `MODEL_CANDIDATES` in the matching tier (full-flash names near
   the top, flash-lite names near the bottom) — nothing else needs to change. The
   fallback logic, retry counts, and prompts are unaffected by which model names are
   in the list.

As of the check that added this note, both `gemini-flash-latest` (full model) and
`gemini-flash-lite-latest` (lite model) exist as Google-maintained aliases that
never 404 on retirement — that's why they anchor the two halves of the list. Verify
this is still true with the API call above before assuming it.

---

## How to check whether the pipeline is actually working

Two ways, and you don't need to be technical for the first one:

1. **Actions tab → Daily pipeline → run history.** Green checkmark = that run
   succeeded (or had only self-healing partial failures). Red X = something needs
   attention (and an email should already have gone out).
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
| `workflows/heartbeat.yml` | Keeps `daily.yml`'s schedule from being auto-disabled after 60 days. |
| `last-heartbeat.txt` | Written by `heartbeat.yml`; harmless, but don't remove the workflow that maintains it. |
