-- DORMANT. Nothing schedules this file, nothing in the codebase references
-- it, and nobody runs it. It is kept here as a written-down idea, not as
-- something meant to execute — do not wire this into a workflow without
-- first fixing the flaw recorded below.
--
-- Why it isn't needed: at this project's real volume — roughly 280 articles
-- a year, adding roughly 1.4 MB of raw_text a year — the database would
-- take centuries to approach Supabase's 500 MB free-tier limit. There is no
-- storage problem here for this query to solve.
--
-- The flaw, if anyone is ever tempted to run it anyway: the WHERE clause
-- below does not exclude an approved article that is still waiting for its
-- publication text (newsletter_text_he IS NULL). Running this would null
-- out that article's raw_text and turn a recoverable, merely-not-yet-
-- processed article into one Pass 2 skips forever — the same empty-raw_text
-- trap documented as a known limitation in docs/project_notes.md — a silent,
-- permanent loss of exactly the kind this project is built to avoid
-- everywhere else.
--
-- Also note: `publish_status in ('published', 'not_published')` below is
-- always true and filters nothing. `publish_status` is a dead column (see
-- docs/db_contract.md, "Unused columns") — nothing in this project ever
-- writes anything to it besides its own default ('not_published'), so no
-- row has ever been 'queued' or 'failed', and every row alive today matches
-- this condition trivially.
--
-- This query is NOT being fixed here. Fixing it would imply it is meant to
-- be run, and it isn't — there is no problem it needs to solve.

-- raw_html is no longer stored at all (column removed), so there is nothing
-- to clear here — only raw_text needs to be nulled out.
update content_items
set
    raw_text = null,
    archived_at = now()
where created_at < now() - interval '90 days'
  and archived_at is null
  and processing_status = 'done'
  and review_status in ('approved', 'irrelevant')
  and publish_status in ('published', 'not_published');