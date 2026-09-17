-- One-off migration: adds/removes the columns needed for the two-pass Processor
-- rework (triage pass + publication-text pass) and the copy-paste-only Publisher.
--
-- This is NOT the start of a migration framework: there is no runner, no version
-- table, no numbering convention. It is a single plain-SQL script, meant to be run
-- once by hand in the Supabase SQL editor against the live database, which now
-- holds real collected articles and can no longer be rebuilt from scratch
-- (see db/README.md — "reset.sql + schema.sql" would permanently lose any
-- article that has since fallen outside the Collector's 14-day window).
--
-- db/schema.sql has already been updated to match this change and remains the
-- single source of truth for a fresh database. After running this migration,
-- the live database's structure matches schema.sql.

alter table content_items
    add column if not exists newsletter_text_he text;

alter table content_items
    add column if not exists processing_attempts integer not null default 0;

alter table content_items
    drop column if exists summary_en;

alter table content_items
    drop column if exists wordpress_post_id;
