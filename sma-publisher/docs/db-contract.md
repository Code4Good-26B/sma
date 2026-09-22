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

Writes new rows.

Responsible fields:

- `source_name`
- `source_type`
- `source_url`
- `external_id`
- `published_at`
- `title_en`
- `raw_text`
- `raw_html`

Initial statuses:

- `processing_status = 'pending'`
- `review_status = 'not_reviewed'`
- `publish_target = 'none'`
- `publish_status = 'not_published'`

The Collector should avoid inserting duplicate items by checking `source_url`.

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