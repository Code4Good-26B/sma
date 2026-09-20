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

- `content_items` where `processing_status = 'pending' OR (processing_status = 'failed' AND processing_attempts < 3)`

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
`processing_attempts < 3`. This bounds retries so a genuinely malformed article
cannot be retried forever, while a transient failure (network error, API quota
blip) no longer silently loses an article on the first bad attempt.

#### Pass 2 — publication text

Runs only on articles Michal has already approved in the Dashboard. Produces the
accessible Hebrew text that gets published — used for both the newsletter and the
website copy-paste block (there is one publication text, not two).

Reads:

- `content_items` where `review_status = 'approved'` AND `newsletter_text_he IS NULL`

Updates:

- `newsletter_text_he`
- `error_message`

There is no separate status column for Pass 2: "needs generating" is exactly
`review_status = 'approved'` AND `newsletter_text_he IS NULL`; once
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

- `publish_status`
- `newsletter_batch_id`
- `published_to_website_at`
- `published_to_newsletter_at`
- `error_message`

Allowed `publish_status` values:

- `not_published`
- `queued`
- `published`
- `failed`

When Michal generates a newsletter or copies an article to the website, the
Dashboard should update:

- `publish_status = 'published'`
- `newsletter_batch_id`, if included in a newsletter batch
- `published_to_website_at`, if copied to the website
- `published_to_newsletter_at`, if included in a newsletter

This is purely bookkeeping so the same article is not offered to Michal again next
time — there is no external system whose response could fail, so `publish_status =
'failed'` / `error_message` exist for completeness but are not expected to be used
in practice under the copy-paste model.

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
- `success` — every source completed without error. A run that finds zero new articles is still a success — quiet weeks are normal for a low-volume news source and must not be reported as a failure.
- `partial` — at least one source failed and at least one source succeeded.
- `failed` — the run could not complete.

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

- `processing_status = 'pending' OR (processing_status = 'failed' AND processing_attempts < 3)`

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

- `review_status = 'approved'`
- `newsletter_text_he IS NULL`

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

When Michal generates a newsletter or copies an article to the website, it updates:

- `publish_status = 'published'`
- `newsletter_batch_id`
- `published_to_website_at`
- `published_to_newsletter_at`

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

### 5. Published item

Michal generated the newsletter and/or copied the article to the website.

- `processing_status = 'done'`
- `review_status = 'approved'`
- `publish_target = 'website'`, `newsletter`, or `both`
- `publish_status = 'published'`
- `newsletter_text_he` is set

---

## Notes

- Components should only update the fields they own.
- Components should not overwrite fields owned by other components.
- The database schema is the source of truth for field names and allowed values.
- The dashboard should display the reviewed Hebrew title and summary when available.
- If reviewed Hebrew fields are empty, the dashboard may fall back to the triaged (Pass 1) Hebrew title and summary.
- There is no separate Publisher service — "publishing" is the Dashboard, running in Michal's browser, generating a newsletter file or a website copy-paste block from `newsletter_text_he`.