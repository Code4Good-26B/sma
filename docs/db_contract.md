# DB Contract

## Main table

`content_items`

## Purpose

The database is the shared contract between all system components.

Each component works with the database according to item statuses. Components do not need to call each other directly in order to pass work forward.

The general flow is:

`Collector -> DB -> Processor (Pass 1: triage) -> DB -> Dashboard (Michal reviews) -> DB -> Processor (Pass 2: publication text) -> DB -> Dashboard (generates newsletter / copy-paste block)`

There is no separate Publisher service. Both outputs — a newsletter file and a
website copy-paste block — are produced by the Dashboard running in Michal's
browser; there is no automated posting and no stored site credentials anywhere in
this project. See the "Dashboard (as Publisher)" section below.

---

## Component ownership

### Collector

Runs as a single command, `python collector/main.py`, intended to run unattended
(e.g. a daily GitHub Actions job). It scrapes each configured source, checks the
database for source URLs it already has, downloads full content only for new
articles, and writes new rows directly to `content_items` — there is no
intermediate file; the database is the only durable state between runs.

Writes new rows.

Responsible fields:

- `source_name`
- `source_type`
- `source_url`
- `external_id`
- `published_at`
- `title_en`
- `raw_text`
- `image_url`

Initial statuses:

- `processing_status = 'pending'`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`

The Collector should avoid inserting duplicate items by checking `source_url`. The database also enforces uniqueness on `(source_name, external_id)`, since `source_url` alone is not a stable identity for every source (e.g. an edited title can change a Cure SMA article's URL while its WordPress post ID in `external_id` stays the same).

---

### Processor

Runs in two independent passes over the same table, at two different points in an
article's lifecycle. There is no separate table or queue for this — which pass an
article needs is always derivable from its current status and columns.

#### Pass 1 — triage

Runs on every newly collected article. Produces a Hebrew title and a short (2-3
sentence) summary so Michal can decide "interesting or not" in the Dashboard.
Nothing else — the full accessible publication text is deliberately deferred to
Pass 2, so it is only generated for articles Michal actually approves (roughly half
of what's collected).

Reads:

- `content_items` where `processing_status = 'pending' OR (processing_status = 'failed' AND processing_attempts < 14)`

Updates:

- `title_he`
- `summary_he`
- `processing_status`
- `processing_attempts`
- `error_message`

Allowed `processing_status` values:

- `pending`
- `processing` — reserved but currently unused by Pass 1 (see below)
- `done`
- `failed`

Pass 1 does **not** set `processing_status = 'processing'` while it works — it goes
straight from `pending` (or a retryable `failed`) to `done` or `failed`. A
mid-article status would only matter for preventing two concurrent workers from
claiming the same row, but there is exactly one Processor worker and the Collector
side's GitHub Actions `concurrency` group already rules out overlapping runs. Setting
it would instead create a real failure mode: if the process dies mid-article (a CI
timeout, the runner being killed, a dropped connection), that article would be stuck
at `processing` forever — not `pending`, not `failed` — and no future run would ever
select it again. Going straight to `done`/`failed` means the worst case if the
process dies mid-write is exactly what happens today: the row is retried next run,
same as any other `pending`/retryable `failed` article.

When triage succeeds, Pass 1 should update:

- `title_he`
- `summary_he`
- `processing_status = 'done'`
- `processing_attempts` incremented

When triage fails, Pass 1 should update:

- `processing_status = 'failed'`
- `error_message`
- `processing_attempts` incremented

A `'failed'` article is retried by Pass 1 on a later run as long as
`processing_attempts < 14`. This bounds retries so a genuinely malformed article
cannot be retried forever, while a transient failure (network error, API quota
blip) no longer silently loses an article on the first bad attempt. 14, not a
smaller number, because Gemini's free tier does not guarantee capacity and live
runs have shown multi-day 503 streaks across every fallback model at once — the
budget is deliberately matched to the Collector's own `LOOKBACK_DAYS = 14`, so
the Processor can survive exactly as long an outage as the Collector can.

#### Pass 2 — publication text

Runs only on articles Michal has already approved in the Dashboard. Produces the
accessible Hebrew text that gets published — used for both the newsletter and the
website copy-paste block (there is one publication text, not two).

Reads:

- `content_items` where `review_status = 'approved' AND publish_target <> 'none' AND newsletter_text_he IS NULL`

`publish_target <> 'none'`, not `IN ('newsletter', 'both')`: despite its name,
`newsletter_text_he` is the publication text used for BOTH the newsletter and the
website copy-paste block, so an article approved for the website alone needs it
just as much as one approved for the newsletter. What makes generation pointless
is having no destination at all, not having a destination other than the
newsletter.

Updates:

- `newsletter_text_he`
- `error_message`

There is no separate status column for Pass 2: "needs generating" is exactly
`review_status = 'approved' AND publish_target <> 'none' AND newsletter_text_he IS NULL`; once
`newsletter_text_he` is set, the article no longer matches that query. Michal can
edit `newsletter_text_he` directly in the Dashboard afterwards — there is
deliberately no separate `reviewed_` counterpart for it, unlike the triage title
and summary: the edited text simply IS the text.

Unlike Pass 1, there is no `processing_attempts`-style retry counter for Pass 2:
the selection query is itself the retry — an article whose Gemini call fails
simply still matches the query on the next run. At this project's volume (roughly
7 approved articles a month), a permanently-failing article costs one wasted API
call per daily run, visible in the log, which is cheap enough not to warrant a
dedicated column.

---

### Dashboard

Reads:

- `content_items` where `processing_status = 'done'`

Updates:

- `review_status`
- `publish_target`
- `reviewed_title_he`
- `reviewed_summary_he`
- `reviewed_by`
- `reviewed_at`

Allowed `review_status` values:

- `not_reviewed`
- `approved`
- `irrelevant`
- `needs_edit`

Allowed `publish_target` values:

- `none`
- `website`
- `newsletter`
- `both`

The Dashboard is responsible for saving Michal's review decisions and edited Hebrew content.

---

### Dashboard (as Publisher)

There is no separate Publisher service and never will be — this was a deliberate
design choice, not a phase that just hasn't been built yet. Both publication outputs are produced by
the Dashboard running in Michal's browser:

- She presses a button and gets a newsletter file to send herself.
- She copies a ready-made block of text to paste into the association's WordPress
  site by hand.

There is no automated posting, no WordPress API integration, and no stored site
credentials anywhere in this project. A live integration into a third-party website
would be a permanent failure mode with no maintainer around to fix it, so
"publishing" here means handing Michal something to send or paste herself, and then
recording that she did.

Reads:

- `content_items` where `review_status = 'approved'`
- `publish_target != 'none'`
- `publish_status = 'not_published'`
- `newsletter_text_he IS NOT NULL` (Pass 2 must have produced the publication text)

Updates:

- `newsletter_batch_id` — written today, by the newsletter flow described below
- `published_to_newsletter_at` — written today, by the newsletter flow described below
- `publish_status` — reserved for the website flow below; not written by anything yet
- `published_to_website_at` — reserved for the website flow below; not written by anything yet
- `error_message` — reserved for completeness; not written by anything yet

Allowed `publish_status` values:

- `not_published`
- `queued`
- `published`
- `failed`

**Only the newsletter half of this is built.** Clicking "צור ניוזלטר" in the
Dashboard renders a preview in Michal's browser and writes nothing — the two
columns above are written only when she separately clicks "סמן כנשלח" after
generating that preview, and only for the articles that were in it:

- `newsletter_batch_id` is set to the moment the preview was generated (not
  the moment "סמן כנשלח" is clicked), formatted `YYYY-MM-DDTHH:mm` (e.g.
  `2026-09-23T14:05`) — readable directly in a SQL query later, and unique in
  practice at this project's newsletter frequency (at most a few times a
  month).
- `published_to_newsletter_at` is set to the moment "סמן כנשלח" is clicked.

The per-item website copy button (the אתר tab's equivalent action) does not
exist yet. When it is built, it should follow the same rule for the same
reason: the system has no way to know whether Michal actually sent the mail
or pasted the text, so only an explicit confirmation click may write — never
the act of building a preview or a copy-paste block. Marking on generation
would let a caught typo silently drop an article forever (it would never be
offered again); marking only on explicit confirmation risks nothing worse
than a duplicate if she forgets, and a duplicate is recoverable.

---

## Health monitoring

`collector_runs`

The Collector writes to this table. The Dashboard reads from it to show whether the system is alive. No other component touches it.

There is one row per Collector execution (not per source). Per-source detail is recorded in the `sources` jsonb column.

The Collector should:

- Insert a row with `status = 'running'` when a run starts.
- Update that row when the run ends, setting `finished_at`, `items_seen`, `items_inserted`, and the final `status`.

Allowed `status` values:

- `running` — the run is in progress. A row that stays `running` (never gets `finished_at` set) means the process died mid-run. That is itself a useful signal that something is wrong.
- `success` — no source errored and every insert that was attempted succeeded. A run that finds zero new articles is still a success — quiet weeks are normal for a low-volume news source and must not be reported as a failure.
- `partial` — at least one source could not be reached (e.g. blocked with a 403, DNS failure, timeout), but at least one other source still worked. This is recorded so the dashboard can show, honestly, "nothing from SMA News Today since the 20th" — but it does **not** by itself fail the run's exit code or send a failure email, because a single source being unreachable is a self-correcting condition (the site may unblock tomorrow) rather than something broken in this project. `partial` is also used when every source reachable but at least one article failed to *insert* — see below.
- `failed` — **every** configured source failed to be reached, or at least one article that was successfully downloaded could not be inserted into the database. The former usually means something environmental (network access, DNS); the latter points at the schema or the database itself, not at a flaky website, and does not fix itself by waiting. Either case exits non-zero and sends the failure email.

**Status and exit code are two different decisions**, deliberately: `status` is what a human sees later when they go looking (the dashboard, the run history); the exit code is whether GitHub emails someone tonight. A source being unreachable is worth recording but not worth an email every morning for however long that site blocks the Collector — the same partial-vs-systemic split the two Processor passes use for their own exit codes. An insert failure is different (see above) and always triggers the email, even if it happened alongside sources that otherwise worked fine (i.e. even in a run recorded as `partial`).

The Dashboard's health check is: the most recent row where `status in ('success', 'partial')`, and how long ago it finished. This is enough to tell a non-technical user "the collector is working" or "the collector has not run successfully in N days" without needing to understand the rest of the schema.

---

## Access control

Row Level Security is enabled on `content_items` and `collector_runs`, with deliberately permissive policies (defined in `schema.sql`) for the `anon` / `authenticated` roles:

- `content_items` — SELECT and UPDATE only. There are no INSERT or DELETE policies, so the anon key cannot be used to create or destroy rows.
- `collector_runs` — SELECT only.

The Collector and Processor connect via `DATABASE_URL` as the table owner, which bypasses RLS entirely, so these policies only affect the Dashboard's anon-key access.

**This is not real authentication.** The anon key is embedded in the Dashboard's client-side JavaScript and is therefore public. Anyone who finds the Dashboard URL can currently read every article and modify Michal's review decisions. The missing INSERT/DELETE policies limit the blast radius but do not fix this. Adding proper Supabase Auth to the Dashboard is a separate, still-open task that must be completed before handover.

---

## Component workflow

The system uses a status-based workflow.

Each component finds work by querying the database for items in the status it is responsible for. Components do not call each other directly.

### Collector workflow

The Collector inserts new raw items into `content_items`.

New items should be inserted with:

- `processing_status = 'pending'`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`

### Processor workflow — Pass 1 (triage)

Pass 1 reads items where:

- `processing_status = 'pending' OR (processing_status = 'failed' AND processing_attempts < 14)`

It does not set `processing_status = 'processing'` — see the note in "Component
ownership > Processor > Pass 1" above for why that status is reserved but
deliberately unused.

When triage succeeds, it updates:

- `title_he`
- `summary_he`
- `processing_status = 'done'`
- `processing_attempts` incremented

When triage fails, it updates:

- `processing_status = 'failed'`
- `error_message`
- `processing_attempts` incremented

### Dashboard workflow (review)

The Dashboard displays items where:

- `processing_status = 'done'`

The Dashboard updates:

- `review_status`
- `publish_target`
- `reviewed_title_he`
- `reviewed_summary_he`
- `reviewed_by`
- `reviewed_at`

### Processor workflow — Pass 2 (publication text)

Pass 2 reads items where:

- `review_status = 'approved' AND publish_target <> 'none' AND newsletter_text_he IS NULL`

When it succeeds, it updates:

- `newsletter_text_he`

When it fails, it updates:

- `error_message`

### Dashboard workflow (publish)

The Dashboard offers items for newsletter generation or website copy-paste where:

- `review_status = 'approved'`
- `publish_target != 'none'`
- `publish_status = 'not_published'`
- `newsletter_text_he IS NOT NULL`

**Only the newsletter half of this is built.** Clicking "צור ניוזלטר" in the
Dashboard renders a preview in Michal's browser and writes nothing — the two
columns above are written only when she separately clicks "סמן כנשלח" after
generating that preview, and only for the articles that were in it:

- `newsletter_batch_id` is set to the moment the preview was generated (not
  the moment "סמן כנשלח" is clicked), formatted `YYYY-MM-DDTHH:mm` (e.g.
  `2026-09-23T14:05`) — readable directly in a SQL query later, and unique in
  practice at this project's newsletter frequency (at most a few times a
  month).
- `published_to_newsletter_at` is set to the moment "סמן כנשלח" is clicked.

The per-item website copy button (the אתר tab's equivalent action) does not
exist yet. When it is built, it should follow the same rule for the same
reason: the system has no way to know whether Michal actually sent the mail
or pasted the text, so only an explicit confirmation click may write — never
the act of building a preview or a copy-paste block. Marking on generation
would let a caught typo silently drop an article forever (it would never be
offered again); marking only on explicit confirmation risks nothing worse
than a duplicate if she forgets, and a duplicate is recoverable.

---

## Example item lifecycle

### 1. Collected item

A new item was collected and is waiting for Pass 1 (triage).

- `processing_status = 'pending'`
- `processing_attempts = 0`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`
- `newsletter_text_he = NULL`

### 2. Triaged item

Pass 1 produced a Hebrew title and short summary for Michal to review. The full
publication text has not been generated yet — that only happens after approval.

- `processing_status = 'done'`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`
- `newsletter_text_he = NULL`

### 3. Reviewed item

Michal reviewed the item and approved it for publishing. This is what makes it
eligible for Pass 2.

- `processing_status = 'done'`
- `review_status = 'approved'`
- `publish_target = 'website'`, `newsletter`, or `both`
- `publish_status = 'not_published'`
- `newsletter_text_he = NULL`

### 4. Publication text generated

Pass 2 produced the accessible Hebrew publication text. The item is now ready for
Michal to generate a newsletter or copy it to the website from the Dashboard.

- `processing_status = 'done'`
- `review_status = 'approved'`
- `publish_target = 'website'`, `newsletter`, or `both`
- `publish_status = 'not_published'`
- `newsletter_text_he` is set

### 5. Sent in a newsletter

Michal generated a newsletter that included this article and clicked "סמן
כנשלח" (see "Dashboard (as Publisher)" above — only the newsletter half of
publishing is built today, so this is the only way `content_items` reaches a
"sent" state right now).

- `processing_status = 'done'`
- `review_status = 'approved'`
- `publish_target = 'newsletter'` or `both`
- `publish_status = 'not_published'` (not written by anything yet)
- `newsletter_text_he` is set
- `newsletter_batch_id` is set, to the newsletter's generation timestamp
- `published_to_newsletter_at` is set

An article approved for the website only, or approved for both but not yet
included in a sent newsletter, stays at `newsletter_batch_id = NULL` and is
still offered on the /publish screen's ניוזלטר tab (if applicable) or אתר
tab.

---

## Notes

- Components should only update the fields they own.
- Components should not overwrite fields owned by other components.
- The database schema is the source of truth for field names and allowed values.
- The dashboard should display the reviewed Hebrew title and summary when available.
- If reviewed Hebrew fields are empty, the dashboard may fall back to the triaged (Pass 1) Hebrew title and summary.
- There is no separate Publisher service — "publishing" is the Dashboard, running in Michal's browser, generating a newsletter file or a website copy-paste block from `newsletter_text_he`.