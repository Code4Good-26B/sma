# DB Contract

## Main table

`content_items`

## Purpose

The database is the shared contract between all system components.

Each component works with the database according to item statuses. Components do not need to call each other directly in order to pass work forward.

The general flow is:

`Collector -> DB -> Processor -> DB -> Dashboard -> DB -> Publisher -> DB`

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

Reads:

- `content_items` where `processing_status = 'pending'`

Updates:

- `summary_en`
- `title_he`
- `summary_he`
- `processing_status`
- `error_message`

Allowed `processing_status` values:

- `pending`
- `processing`
- `done`
- `failed`

When processing starts, the Processor should update:

- `processing_status = 'processing'`

When processing succeeds, the Processor should update:

- `summary_en`
- `title_he`
- `summary_he`
- `processing_status = 'done'`

When processing fails, the Processor should update:

- `processing_status = 'failed'`
- `error_message`

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

### Publisher

Reads:

- `content_items` where `review_status = 'approved'`
- `publish_target != 'none'`
- `publish_status = 'not_published'`

Updates:

- `publish_status`
- `wordpress_post_id`
- `newsletter_batch_id`
- `published_to_website_at`
- `published_to_newsletter_at`
- `error_message`

Allowed `publish_status` values:

- `not_published`
- `queued`
- `published`
- `failed`

When publishing succeeds, the Publisher should update:

- `publish_status = 'published'`
- `wordpress_post_id`, if published to WordPress
- `newsletter_batch_id`, if included in a newsletter batch
- `published_to_website_at`, if published to the website
- `published_to_newsletter_at`, if published to the newsletter

When publishing fails, the Publisher should update:

- `publish_status = 'failed'`
- `error_message`

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

### Processor workflow

The Processor reads items where:

- `processing_status = 'pending'`

When processing starts, it updates:

- `processing_status = 'processing'`

When processing succeeds, it updates:

- `summary_en`
- `title_he`
- `summary_he`
- `processing_status = 'done'`

When processing fails, it updates:

- `processing_status = 'failed'`
- `error_message`

### Dashboard workflow

The Dashboard displays items where:

- `processing_status = 'done'`

The Dashboard updates:

- `review_status`
- `publish_target`
- `reviewed_title_he`
- `reviewed_summary_he`
- `reviewed_by`
- `reviewed_at`

### Publisher workflow

The Publisher reads items where:

- `review_status = 'approved'`
- `publish_target != 'none'`
- `publish_status = 'not_published'`

When publishing succeeds, it updates:

- `publish_status = 'published'`
- `wordpress_post_id`
- `newsletter_batch_id`
- `published_to_website_at`
- `published_to_newsletter_at`

When publishing fails, it updates:

- `publish_status = 'failed'`
- `error_message`

---

## Example item lifecycle

### 1. Collected item

A new item was collected and is waiting for processing.

- `processing_status = 'pending'`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`

### 2. Processed item

The item was summarized and translated.

- `processing_status = 'done'`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`

### 3. Reviewed item

Michal reviewed the item and approved it for publishing.

- `processing_status = 'done'`
- `review_status = 'approved'`
- `publish_target = 'website'`, `newsletter`, or `both`
- `publish_status = 'not_published'`

### 4. Published item

The item was published successfully.

- `processing_status = 'done'`
- `review_status = 'approved'`
- `publish_target = 'website'`, `newsletter`, or `both`
- `publish_status = 'published'`

---

## Notes

- Components should only update the fields they own.
- Components should not overwrite fields owned by other components.
- The database schema is the source of truth for field names and allowed values.
- The dashboard should display the reviewed Hebrew title and summary when available.
- If reviewed Hebrew fields are empty, the dashboard or publisher may fall back to the processed Hebrew title and summary.