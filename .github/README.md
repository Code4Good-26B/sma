# Automation

This project runs unattended. There is no maintainer watching it day to day, so this
folder exists to make the system keep itself alive and to give a non-technical person
a way to check whether it's actually working.

Two GitHub Actions workflows live in `.github/workflows/`.

---

## `collector.yml` — runs the Collector daily

- **Schedule:** every day at 05:00 UTC (08:00 Israel time).
- **Manual run:** open the **Actions** tab → **Collector** → **Run workflow**. Use this
  any time you want to check "is this still working?" without waiting for the next
  scheduled run.
- **What it does:** installs the Python dependencies from `requirements.txt` and runs
  `python collector/main.py` — the entire Collector pipeline in one command. It
  scrapes each configured news source, checks the database for articles already
  collected, downloads only the new ones, and inserts them.
- **If it fails:** the job exits non-zero and GitHub automatically emails the
  repository's admins. That email is the only automatic failure signal this project
  has — please don't ignore it.

### The one required secret

The Collector needs exactly one secret: **`DATABASE_URL`**, the Postgres connection
string for the Supabase database (same value as the `DATABASE_URL` in a local `.env`
file).

To set it: **Settings → Secrets and variables → Actions → New repository secret**,
name `DATABASE_URL`.

Without this secret, every run of `collector.yml` will fail immediately.

---

## `heartbeat.yml` — keeps the schedule itself alive

**Read this even if you skip everything else on this page.**

GitHub automatically **disables a scheduled workflow after 60 days with no
repository activity**. This project is handed over with no ongoing maintainer, so
nobody will be pushing commits — which means, without a countermeasure, the Collector
schedule would silently stop working around month three, and nobody would notice.

`heartbeat.yml` exists purely to prevent that. Once a month it:

1. Writes the current UTC timestamp to `.github/last-heartbeat.txt` and commits it —
   a small, harmless change whose only job is to keep the repository "active" in
   GitHub's eyes.
2. As a second line of defense, explicitly re-enables the Collector workflow through
   the GitHub API, in case it was ever disabled for some other reason.

**It is not a health check.** It does not verify the Collector is working — only that
the schedule mechanism stays turned on. Do not delete this file thinking it's
pointless busywork; deleting it will cause the Collector to stop running roughly two
months later, silently.

### If the Collector workflow is ever found disabled anyway

Go to the **Actions** tab → **Collector** (in the left sidebar) → there will be a
banner saying the workflow is disabled → click **Enable workflow**. That's the entire
fix — one click.

---

## How to check whether the Collector is actually working

Two ways, and you don't need to be technical for the first one:

1. **Actions tab → Collector → run history.** Green checkmark = that run succeeded.
   Red X = it failed (and an email should already have gone out).
2. **The `collector_runs` database table.** Every run — scheduled or manual — writes
   a row here with its status, how many articles it found, and how many it inserted.
   Run the health query at the top of [`db/check.sql`](../db/check.sql) to see the
   most recent run at a glance, or see the "Health monitoring" section of
   [`docs/db_contract.md`](../docs/db_contract.md) for what the different statuses
   mean. A run that finds zero new articles and reports `success` is normal — quiet
   weeks happen.

---

## Summary of what NOT to delete

| File | Why it matters |
|---|---|
| `workflows/collector.yml` | The actual daily job. |
| `workflows/heartbeat.yml` | Keeps `collector.yml`'s schedule from being auto-disabled after 60 days. |
| `last-heartbeat.txt` | Written by `heartbeat.yml`; harmless, but don't remove the workflow that maintains it. |
