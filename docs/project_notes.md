# Project notes — SMA Israel news automation

**Last updated:** 2026-09-26

This file holds the context that lives nowhere else in the repository: why things
are the way they are, and what must happen before this project changes hands.
`docs/db_contract.md`, `db/schema.sql` and `.github/README.md` describe how the
system works. This file describes *why*, and *what is still owed*.

---

## What this is

A news automation tool built by a CODE4GOOD volunteer for **Michal**, director of
the Israeli non-profit **SMA ISRAEL** (עמותת משפחות SMA ישראל).

SMA is a rare disease. Nearly all research and news about it is published in
English, and most of the community this association serves cannot read it. The
Hebrew text this system produces is therefore **not a teaser for an English
article — it is the article**, for its readers.

The daily chain:

```
08:00 (automatic)   collect SMA articles
                    -> Pass 1: Hebrew title + short triage summary
                    -> Pass 2: Hebrew publication text, for approved articles only

Every 6 hours (automatic, additional):
                    -> Pass 2 only, up to 5 articles — extra attempts at
                       whatever still has no publication text, so a
                       transient Gemini outage costs hours, not a full day.
                       Never the Collector, never Pass 1, never able to fail
                       the run or send an email (see .github/README.md and
                       "Decisions that look wrong but are not" below).

Michal, at her own pace:
  ~weekly     reviews new items, marks interesting/not + target (newsletter/website/both)
  ~monthly    reviews newsletter texts, edits, clicks "צור ניוזלטר", gets a file to send
  as needed   clicks "copy" on a website item, pastes into WordPress by hand
```

---

## The one constraint that explains every decision here

**This project will be launched and left. There will be no maintainer.**

Every trade-off in this repository was resolved in favour of "keeps working by
itself for years" over "elegant", and in favour of "working" over "perfect".
If you are reading this and something looks unnecessarily defensive or crude,
that is probably why. Before changing it, read the relevant "decisions" entry
below.

Two consequences worth internalising:

- **The failure email is the only automatic signal this project has.** An alert
  that fires on a self-correcting condition gets muted by its recipient within a
  month, and then the real alert is invisible too. This is why partial failures
  are recorded but do not email.
- **A dead system must not look like a quiet news week.** SMA is a low-volume
  topic; some weeks genuinely have no news. Any mechanism that reports "nothing
  new" must be able to distinguish "nothing happened" from "we are broken".

---

## HANDOVER CHECKLIST

### Blocking — the product does not survive handover without these

**1. A working Gemini API key on an association-owned Google account.**
The key currently in the `GEMINI_API_KEY` GitHub secret belongs to the
volunteer's **personal** Google account. The project Gmail
(`smaisrael2@gmail.com`) is **blocked by Google at the account level** —
`403 PERMISSION_DENIED`, "Your project has been denied access". This was
verified in September 2026 on two separate Cloud projects, including a
brand-new one, which rules out a per-project cause.
**A key that exists is not a key that works.** Whatever key ends up here must be
tested with a real API call before handover, not merely created.

**2. A GitHub account registered with the project's email address, owning this
repository.**
GitHub sends failure notifications to the **account**, not to the repository.
There is no recipient list to add an address to. Notifications go to whoever
triggered a run, and for scheduled runs to whoever last edited the cron
expression. Until the repository is owned and the cron last touched by an
account registered to the project's inbox, **every failure email will keep going
to the volunteer, forever, after he has gone.**
After transferring, repeat the failure-email test (see "How to test the alert"
below) from the new account.

**3. Find out what happens to the `Code4Good-26B` GitHub organisation.**
This repository currently lives inside the course's organisation, not the
association's. Nobody has confirmed what becomes of it when the cohort ends. If
access is revoked or the organisation is archived, **the scheduled workflow
simply stops running and the product dies silently** — and the failure email
cannot warn anyone, because it depends on the same repository. Ask the course
staff, and move the repository if the answer is not reassuring.

**4. Supabase moved to an association-owned account.**
Update the `DATABASE_URL` GitHub secret **in the same sitting**. A moved
database with a stale secret is a pipeline that fails every morning.

**5. Vercel account opened in the association's name from the start** — never
the volunteer's, for the dashboard deployment.

### Required before handing the keys over

**6. Supabase Auth and real row-level security.**
The RLS policies currently in `db/schema.sql` are permissive by design and are
**not authentication**. They exist so that a leaked anon key cannot destroy data
(there are deliberately no INSERT or DELETE policies), not to control who may
read or edit. Real auth is required before Michal uses this unsupervised.
When it lands, `reviewed_by` in `dashboard/src/components/NewsCards.jsx` must be
changed to read the signed-in user instead of the hardcoded string `'michal'` —
otherwise every edit made by anyone, forever, is attributed to her regardless of
who actually made it.

**7. Remove `SUPABASE_SERVICE_ROLE_KEY` from the local `.env`.** It bypasses
every row-level security policy in the database, and nothing in this project
reads it — the pipeline talks to Postgres directly through `DATABASE_URL`, and
the dashboard uses only the anon key (`dashboard/.env`,
`VITE_SUPABASE_ANON_KEY`). It was already removed from the root
`.env.example` for the same reason. A credential nobody uses is a credential
that gets copied somewhere careless at handover; if it's ever needed again it
can be regenerated from Supabase → Settings → API in one click.

**8. Backup codes and a recovery email in Michal's name, for every account.**

**9. Do the credential handover live with Michal, not in advance.**
Change phone number, password and recovery address together with her; sign out
all devices; regenerate backup codes (which invalidates the old ones).

**10. Write Michal a short, non-technical handover document.** It must cover:
which accounts exist and their credentials; that the running cost should be
zero; what the dashboard's warning banner means; **the GitHub 60-day rule**
(see `heartbeat.yml`); the Gemini free-tier limit (~20 requests/day per model —
normal use is 1-2/day, and a 429 is temporary and self-heals); and the one-line
fix if a model 404s (see `.github/README.md`).

**11. The "~20 requests/day per model" figure above is this project's own old
observation, not a number Google currently publishes — look up the real limit
in AI Studio before trusting it.** Google's rate-limits documentation no
longer lists a fixed per-day number at all; it now says limits are per
**project** and shown inside AI Studio itself once you're signed into that
project. Whoever ends up owning the final `GEMINI_API_KEY` should check that
project's actual dashboard in AI Studio for its real rate limits, rather than
carrying this document's old figure forward as if it still applies — it may
not, for whichever project the final key belongs to.

### Recommended, not blocking

**12. Give SMA News Today a second path.** Its `rss_url` is `None`, so HTML
scraping is its **only** route — and it is the more prolific of the two active
sources. A comment in `collector/sources.py` records that its RSS feed returns
200. On 2026-09-20 the site 403'd the HTML listing for several hours and the
source produced nothing; the 14-day lookback window absorbed it completely and
no article was lost, but a source with a single path is a single point of
failure in a system meant to run unattended for years.

**13. The paid Gemini tier is a real option.** 503 "high demand" errors on the
free tier are widespread and documented — Google's own rate-limit page says
"Specified rate limits are not guaranteed and actual capacity may vary", and
their forum carries long threads about it, **including from paying customers**.
At this project's volume (1-2 articles/day) the paid tier would cost on the
order of **cents per month**. It was not enabled because "zero cost" was
promised to the association and because paying does not eliminate 503s — but if
availability ever proves insufficient, this is the lever, and it is cheap.

**14. Two GitHub deprecations to be aware of.** `actions/checkout@v4` and
`actions/setup-python@v5` target Node.js 20, which GitHub has deprecated and is
currently force-running on Node 24. Separately, `ubuntu-latest` migrates to
Ubuntu 26 on 2026-10-19. Both will most likely pass without incident — but if
the pipeline one day fails for no visible reason, **check these first.**

---

## How to test the alert (repeat this from every new account)

The alert mechanism is the only thing standing between a broken system and
silence. An untested alert is not an alert.

1. Open `.env` and have the real `DATABASE_URL` value ready to paste back.
2. GitHub → Settings → Secrets and variables → Actions → set `DATABASE_URL` to
   `postgresql://broken`.
3. Actions → Daily pipeline → Run workflow.
4. All three steps should fail within ~20 seconds. Confirm Pass 1 and Pass 2
   **ran and failed** rather than being skipped — that is the `!cancelled()`
   condition doing its job.
5. Confirm the email arrives, and note **whether it landed in spam**.
6. Restore the real `DATABASE_URL`.
7. **Run the workflow again and confirm it is green.** Do not skip this: it is
   the only proof the secret was restored correctly.

---

## Decisions that look wrong but are not

**The publish screen edits `newsletter_text_he` directly — there is no
`reviewed_newsletter_text_he` column**, unlike the `reviewed_title_he` /
`reviewed_summary_he` pattern used for the triage text. Pass 2's own selection
guard is `newsletter_text_he IS NULL`
(`processor/process_newsletter_text.py`), so an edited (non-null) text is
already safe from being silently regenerated over — that property exists
without a second column. A `reviewed_` column would buy exactly one thing
(the ability to see the original AI-generated text after an edit) at the
cost of a migration, a schema change, a contract update in three documents,
and a fallback rule in every future reader. The real cost, written down
plainly: **editing is destructive** — there is no "revert to generated"
anywhere in this UI. If that ever turns out to matter, the fix is adding
`reviewed_newsletter_text_he` later; nothing built here needs to change to
allow it.

**`processing_status = 'processing'` is never written**, though the check
constraint allows it. A run killed mid-article would leave a row stuck in that
state, matching neither `pending` nor `failed`, so no future run would ever
select it again. There is exactly one worker, so the status would guard against
nothing.

**`LOOKBACK_DAYS = 14` and `MAX_PROCESSING_ATTEMPTS = 14`** are the same number
for the same reason: the system can be broken for two weeks and lose nothing.
Both look wastefully generous against a daily schedule. That is the point.

**A `partial` collector run does not send an email; a `failed` one does.** One
source being unreachable while another works is self-correcting and is recorded
in `collector_runs` for the dashboard to surface. Emailing about it every
morning for however long a site blocks us would train its recipient to ignore
the inbox. The same partial-vs-systemic rule governs both Processor passes —
see the next two entries for exactly how, as of 2026-09-26.

**Both Processor passes decide their exit code by WHY an article failed, not
by how many succeeded.** `failed > 0 and succeeded == 0` used to be the proxy
for "systemic". It is a bad proxy at this project's volume (1-3 articles per
run): one bad five-second window at Google fails every article in a small run
and looks identical to a dead API key — this happened for real on 2026-09-24,
three articles, all HTTP 503, and the run emailed Michal for nothing anyone
could act on. Every Gemini failure is now classified as `transient` (a network
error/timeout, HTTP 429, or any HTTP 5xx — another attempt, later, can succeed
without anyone doing anything) or `not_transient` (401/403, any other 4xx, or
an unusable response — the system will not recover by itself). A run exits 0
when every failure was transient, regardless of the success count, and exits 1
the moment any failure is not transient. See `processor/gemini.py`'s
`FailureKind` — the classification is computed directly from the HTTP status
Gemini actually returned, deliberately never by parsing an error message
string, because a message-format change would then silently break alerting.
Pass 1's `exhausted > 0` rule (an article that burns all
`MAX_PROCESSING_ATTEMPTS`) is checked before this and is unaffected by it —
that floor still always forces exit 1, even if every individual failure this
run was itself transient.

**Pass 2 has its own 14-day floor (`PASS2_FLOOR_DAYS` in
`process_newsletter_text.py`), matching `LOOKBACK_DAYS` and
`MAX_PROCESSING_ATTEMPTS` for the same reason: the system can be broken for
two weeks and lose nothing.** Pass 2 has no attempt counter — its retry is the
daily re-selection itself, unlimited (see `_fetch_eligible`'s own docstring) —
so without a floor, an article that is genuinely, permanently stuck could fail
silently forever as long as each day's individual failure happened to look
transient. The floor forces exit 1 once an article that was actually attempted
and failed in a given run has been waiting since `reviewed_at` for more than
14 days. **Articles skipped for empty `raw_text` are deliberately excluded
from this floor** — such an article will never get a publication text, on any
future run either (see "Known limitations" below), so counting it toward the
floor would mean emailing about it every single day forever: exactly the
alert-fatigue failure mode this whole mechanism exists to prevent. A `NULL
reviewed_at` also excludes an article from the floor, since there is nothing
to measure the 14 days from.

**`.github/workflows/publication-text.yml` runs Pass 2 every 6 hours and its
one step is set (`continue-on-error: true`) so it can never fail the job or
send an email.** This looks like swallowing a real failure; it isn't. This
workflow runs the exact same script against the exact same selection query
(`newsletter_text_he IS NULL`) as `daily.yml`'s own Pass 2 step, a few extra
times a day — so a real, non-transient problem still fails `daily.yml` the
next morning and still sends the one failure email this project has. This
workflow is additional attempts, never the only path to anything; it exists
purely to shorten the time-of-day sampling gap for transient Gemini
unavailability, not to add a second alerting path. It deliberately does NOT
run the Collector or Pass 1 — see `.github/README.md` for why running either
one more than once a day would actively cause harm, not just add no benefit.

**The model fallback is a deny-list, not an allow-list.** Try the next candidate
on *any* failure, except the two cases where another attempt provably cannot
help (a network error or timeout, and 401/403 — the same key is used for every
candidate). An allow-list of "safe to retry" status codes was tried twice and
broke both times on a code nobody had anticipated.

**There are two model candidate lists, not one.** Pass 1 may fall back to
flash-lite models because a rough summary still lets Michal decide
"interesting or not", while a *missing* summary makes the article invisible to
her and Pass 1 has a deadline. Pass 2 may not: that text is what families read,
lite models were observed producing a garbled word and a stray Cyrillic
character inside Hebrew words, and Pass 2 has **no** attempt limit — so it can
simply wait for a good model.

**There is no WordPress API integration, by design.** A live integration would
be a permanent failure mode with no maintainer, would require storing site
credentials, and cannot be done from a static React app anyway (CORS, and
secrets in client-side JavaScript). Michal copies and pastes. **A consequence
worth knowing: her WordPress username and password are not needed anywhere in
this project.**

**`_MIN_STRIPPED_CHARS = 300` in `collector/article_fetcher.py` is an absolute
floor, not a ratio.** A ratio was tried and rejected correct results: for
curesma.org the content container *is* the whole page, so correct noise
stripping legitimately removes ~90% of it. The rejected 660-character version
was the actual article; the "safe" 6,713-character version began with the site's
navigation menu.

**MDA Quest is commented out in `collector/sources.py`.** 16 of its 19 collected
articles contained **zero** mentions of SMA anywhere in their full text.

**`heartbeat.yml` must not be deleted.** GitHub disables a scheduled workflow
after 60 days of repository inactivity. With no maintainer nobody will be
pushing commits, so without this file the daily pipeline would silently stop
around month three. It is not a health check and it does not verify anything —
it exists solely to keep the schedule switched on.

---

## Known limitations

- **The scheduled run is not punctual.** The cron requests 05:00 UTC; measured
  starts have been 4h29m and 5h18m late. GitHub does not guarantee start times.
  Nothing here is time-sensitive, so this is documented rather than fought.
- **An approved article with empty `raw_text` is skipped by Pass 2 forever**,
  silently, and is re-selected every run. It is rare, but the dashboard should
  surface "approved, no publication text" so it cannot hide. This is also
  exactly why it is excluded from Pass 2's 14-day alerting floor (see
  "Decisions that look wrong but are not" above) — it would otherwise trigger
  a failure email every day, forever, about something nobody can fix.
- **The dashboard's health check must read per-source data**, not just
  `collector_runs.status`. After the partial/systemic split, a run in which one
  source is dead still reports green. The per-source detail is in the `sources`
  jsonb column.
- **`App.jsx` fetches every article with no pagination or date window.**
  Switching `select('*')` to an explicit column list cut the payload by ~70%, but
  the query itself is still unbounded — it will need a `limit` or a date window
  once the table is large enough for that to matter.
