# Project notes — SMA Israel news automation

**Last updated:** 2026-09-29

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

The dashboard is live in production at
**https://sma-dashboard-blush.vercel.app**, gated by Supabase Auth (email +
password, exactly one user account — public sign-ups and anonymous sign-ins
are both disabled in the Supabase project). Michal's whole workflow exists in
it: a review queue (edit, approve or reject each article, and choose its
destination — newsletter, website, or both), a publication-texts screen,
newsletter generation (copy to clipboard, download as HTML, and a separate
deliberate "mark as sent"), and copy-to-WordPress (with its own separate
"mark as published"). See `docs/db_contract.md` for the field-level contract
behind all of this.

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

Michal, at her own pace, in the dashboard:
  ~weekly     reviews new items, marks interesting/not + target (newsletter/website/both)
  ~monthly    reviews newsletter texts, edits, clicks "צור ניוזלטר", copies or
              downloads it, then a separate "mark as sent" click
  as needed   clicks "copy" on a website item, pastes into WordPress by hand,
              then a separate "mark as published" click
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

Restructured so a reader can tell in ten seconds what is still owed, rather
than scanning a flat numbered list to work out which items are already done.

### Done

**Supabase moved to an association-owned account.** The project was
transferred into an organisation ("SMA Israel") owned by the project email
account. The project reference, URL and API keys were unchanged by the
transfer, so — contrary to what an earlier version of this checklist warned
— no secret or environment variable needed updating. Verified by a green
Daily pipeline run afterwards.

**Vercel account opened in the association's name.** Created fresh on the
project email account, Hobby plan, deployed from the CLI (`vercel --prod`,
run from `dashboard/`) — never the volunteer's own account. Deliberately
not connected to Git; see "Decisions that look wrong but are not" below for
why.

**Supabase Auth and real row-level security.** The dashboard now requires a
real signed-in session before it renders anything (email + password, exactly
one user; see `dashboard/src/AuthGate.jsx`). The RLS policies in
`db/schema.sql` were narrowed from `anon, authenticated` to `authenticated`
only, and `reviewed_by` now records the signed-in user's real email instead
of the literal string `'michal'`. Vercel's Deployment Protection — which had
been the only thing standing in front of the live site until this landed —
was then switched off; see "Decisions that look wrong but are not" for why
that is correct now rather than a regression.

### Decided against

**Moving the repository to a GitHub account registered to the project's
email, or otherwise moving it out of the `Code4Good-26B` organisation.**
This was on an earlier version of this checklist as blocking. It was
decided against deliberately, under time pressure — see "Decisions that
look wrong but are not" below (the very first entry) for the full reasoning
and its real, plainly-stated cost. This is not the same thing as the
decision having no cost; read that entry before assuming it is safe to leave
alone forever.

### Still open — blocking

**A working Gemini API key on an association-owned Google account.** This
is now the **last** item blocking a real handover. The key currently in the
`GEMINI_API_KEY` GitHub secret still belongs to the volunteer's **personal**
Google account. The project Gmail (`smaisrael2@gmail.com`) is **blocked by
Google at the account level** — `403 PERMISSION_DENIED`, "Your project has
been denied access". This was verified in September 2026 on two separate
Cloud projects under that account, including a brand-new one, which rules
out a per-project cause. What's been learned since: this is a widely
reported 2026 problem, and Google staff on their own forums attribute it to
a flag on the **account**, not the project — so creating yet another project
under the same account cannot help. A **brand-new** Google account carries a
real risk of tripping the same flag; an **old, established** account (the
association's, with real history, not one created for this purpose) is
materially safer. And regardless of which account this lands on, the
existing rule stands: **a key that exists is not a key that works** —
whatever key ends up here must be tested with a real API call before
handover, not merely created.

### Still open — smaller

**Remove `SUPABASE_SERVICE_ROLE_KEY` from the local `.env`.** It bypasses
every row-level security policy in the database, and nothing in this project
reads it — the pipeline talks to Postgres directly through `DATABASE_URL`,
and the dashboard uses only the anon key (`dashboard/.env`,
`VITE_SUPABASE_ANON_KEY`). It was already removed from the root
`.env.example` for the same reason. A credential nobody uses is a credential
that gets copied somewhere careless at handover; if it's ever needed again it
can be regenerated from Supabase → Settings → API in one click.

**Remove the volunteer's personal Supabase account from the "SMA Israel"
organisation, once the work is finished.** Until that happens, the
association's database is still reachable by a private individual outside
the association. This genuinely cannot be done any earlier: that membership
is exactly what made the project transfer possible in the first place, and
removing it mid-work would lock the volunteer out before the handover is
done.

**A recovery email address and a recovery phone number in Michal's name, for
every account.** These exist independently of two-factor authentication —
see "No two-factor authentication on any account, deliberately" below for
why there are deliberately no backup codes to hand over alongside them.

**Do the credential handover live with Michal, not in advance.** Change
phone number, password and recovery address together with her; sign out all
devices.

**Write Michal a short, non-technical handover document.** In progress
separately, in Hebrew — not part of this repository. It must cover: which
accounts exist and their credentials; that the running cost should be zero;
what the dashboard's warning banner means; **the GitHub 60-day rule** (see
`heartbeat.yml`); the Gemini quota point below; and the one-line fix if a
model 404s (see `.github/README.md`).

**Look up the Gemini free-tier quota in AI Studio, for whichever project
ends up owning the final key.** Google no longer publishes these numbers in
its documentation — the rate-limits page now says limits are per **project**
and are shown inside AI Studio itself once signed into that project. The
"~20 requests/day per model" figure this document used to carry is this
project's own **old observation**, not documentation, and it may not hold
for whichever project the final key belongs to. The quota is shared between
Pass 1 and Pass 2 — both draw on the same project's allowance.

**Paste one article into the association's real WordPress as a DRAFT,
preview it, and delete the draft.** This is the only check that would
confirm the deliberate decision to emit no inline styles in the
website-copy HTML (`dashboard/src/lib/buildWebsiteHtml.js`) was right — that
the association's own theme styles plain `<p>` tags acceptably. It was
consciously deferred to Michal, who has the real site to test against; this
project has none.

### Recommended, not blocking

**Give SMA News Today a second path.** Its `rss_url` is `None`, so HTML
scraping is its **only** route — and it is the more prolific of the two
active sources. A comment in `collector/sources.py` records that its RSS
feed returns 200. On 2026-09-20 the site 403'd the HTML listing for several
hours and the source produced nothing; the 14-day lookback window absorbed
it completely and no article was lost, but a source with a single path is a
single point of failure in a system meant to run unattended for years.

**The paid Gemini tier is a real option.** 503 "high demand" errors on the
free tier are widespread and documented — Google's own rate-limit page says
"Specified rate limits are not guaranteed and actual capacity may vary", and
their forum carries long threads about it, **including from paying
customers**. At this project's volume (1-2 articles/day) the paid tier would
cost on the order of **cents per month**. It was not enabled because "zero
cost" was promised to the association and because paying does not eliminate
503s — but if availability ever proves insufficient, this is the lever, and
it is cheap.

**Two GitHub deprecations to be aware of.** `actions/checkout@v4` and
`actions/setup-python@v5` target Node.js 20, which GitHub has deprecated and
is currently force-running on Node 24. Separately, `ubuntu-latest` migrates
to Ubuntu 26 on 2026-10-19. Both will most likely pass without incident —
but if the pipeline one day fails for no visible reason, **check these
first.**

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

**The repository stays in the `Code4Good-26B` GitHub organisation — a
considered decision made under time pressure, not neglect.** The cost is
real and is written down here plainly: GitHub's documented behaviour is
that when the last user to commit to a workflow's cron schedule is removed
from an organisation, that scheduled workflow is disabled. The working
assumption is that past cohort members are not actively removed from
`Code4Good-26B` — but that is an assumption, not a confirmation. If it turns
out wrong, the pipeline stops silently, and nobody can re-enable it except
someone with access to that repository — which Michal does not have. What
DOES catch it regardless: the dashboard's health banner, which reports "the
system has not collected news since X" after two days without a successful
run — on the screen Michal opens weekly anyway. The chain, spelled out: a
membership change could silently disable the scheduled workflow → nobody
would notice from the GitHub side, since there is nobody watching it → but
the pipeline going quiet shows up in `collector_runs` within a day → the
dashboard's health banner turns amber within two → Michal sees it on her
next weekly visit regardless. It is a slower catch than a real alert, but it
is not silence.

**Failure emails go to the GitHub account that last edited the cron — the
volunteer's personal account — and after handover there is no recipient
list to change that to.** Michal will not receive them. The dashboard's
health banner is therefore her **real** safety net after handover, not the
inbox — see the entry above for the same reasoning applied to the
organisation question.

**Vercel is not connected to Git, on purpose.** Deploying is `vercel --prod`
from the `dashboard/` directory, by hand. A Git connection would need the
course organisation's approval (the repository still lives there) and would
couple the association's own Vercel account to that organisation for no
real benefit — the dashboard changes rarely enough that a manual deploy is
not a burden.

**No two-factor authentication on any account, deliberately.** The
consequence is stated bluntly on purpose: one email address and one password
are the **entire** handover — for the accounts that inbox actually controls.
The project inbox is a single point of failure for **Supabase and
Vercel**: lose access to it, and both are unreachable with it. 2FA was left
off specifically so that handing over "the inbox" really does hand over
everything it can, rather than leaving a second factor stranded on a device
or phone number Michal doesn't control. GitHub is not one of those accounts
and is not covered by this at all — see the `Code4Good-26B` entry above for
why the repository stays out of Michal's reach regardless. The cost of that,
stated plainly: both `DATABASE_URL` and `GEMINI_API_KEY` exist only as
GitHub Actions secrets in that repository (`daily.yml` lines 70, 86-87,
107-108; `publication-text.yml` lines 81-82), so Michal cannot rotate
either one herself. If the Gemini key is ever revoked, expires, or is
blocked by Google, the pipeline simply stops producing text and she has no
way to fix it — she would need whoever holds access to that repository.

**Vercel's Hobby plan, which is restricted to non-commercial use, is fine
here.** Vercel's own fair-use documentation states that asking for
donations is not commercial usage. The dashboard takes no payments and shows
no ads — it is an internal tool for one person to review and publish
articles — so this restriction does not bind.

**There is no test suite in this repository.** Every verification made
during development was written, executed against fabricated input or the
live database, and then deleted — never committed. The reasoning behind
each non-obvious piece of logic lives in code comments instead. Noted here
honestly as a real limitation for whoever inherits this code, not hidden by
its absence: there is nothing here to run, and no regression safety net
beyond `npm run build` / `npm run lint` and careful reading.

**Newsletter generation does not require every eligible article to have a
publication text before it will run.** It generates from whichever articles
already have one, lists the excluded ones **by title** on screen (not just a
count — Michal needs to know which article is missing to judge whether it's
worth waiting for), and "mark as sent" only ever touches the articles that
actually went into that generated batch
(`dashboard/src/lib/selectNewsletterBatch.js`). The alternative — blocking
the whole newsletter on the slowest article — would mean one stuck Gemini
call holds every other approved article hostage indefinitely; this way the
newsletter ships with what's ready, and nothing is ever marked sent that
wasn't actually included in it.

**A collector source counts as OK only when it reported `status: 'ok'` AND
a non-zero `listed`, not `status: 'ok'` alone.** `listed` is what a source's
listing page displayed, before the duplicate check and the early-stop — a
genuinely quiet week still lists a source's existing articles, so `listed`
stays positive even when nothing is new. `status: 'ok'` alone only means
`collect_source` (`collector/main.py`) didn't raise an exception; a blocked
or restructured source can return a page that parses to zero articles with
no HTTP error at all, which `collect_source` still happily records as
`status: 'ok'`. Without the `listed` check, that reads to Michal as an
ordinary quiet week instead of the blind spot it actually is. See
`dashboard/src/lib/computeCollectorHealth.js`.

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
floor, not a ratio.** A ratio was tried, and it rejected correct results: for
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
it exists solely to keep the schedule switched on. It now runs twice a month
(the 1st and the 15th), not once, specifically because GitHub can skip a
scheduled run outright — at once-a-month, two skipped runs in a row would be
roughly two months of silence, past the 60-day threshold.

---

## Known limitations

- **The scheduled run is not punctual.** The cron requests 05:17 UTC; measured
  starts have been 4h29m and 5h18m late. GitHub does not guarantee start times.
  Nothing here is time-sensitive, so this is documented rather than fought.
- **An approved article with empty `raw_text` is skipped by Pass 2 forever**,
  and is re-selected at no real cost every run. The dashboard now surfaces
  this rather than hiding it: the publish screen shows a neutral note for the
  first two days after approval ("the text will be generated automatically"),
  then an amber warning naming the approval date once it has been longer than
  that (`dashboard/src/components/PublishItem.jsx`). This makes the stuck
  state visible to Michal; it does not fix it — an empty `raw_text` will never
  produce a publication text on any future run, and nothing here can act on
  that without a human noticing.
- **`App.jsx` fetches every article with no pagination or date window.** The
  query is unbounded — it will need a `limit` or a date window once the table
  is large enough for that to matter.
