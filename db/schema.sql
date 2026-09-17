create extension if not exists "pgcrypto";

create table if not exists content_items (
    id uuid primary key default gen_random_uuid(),

    source_name text not null,
    source_type text not null check (source_type in ('website', 'newsletter')),
    source_url text not null,
    external_id text,
    published_at timestamptz,

    title_en text,
    raw_text text,
    image_url text,

    title_he text,
    summary_he text,

    -- The Pass 2 (publication text) output. Serves BOTH the newsletter and the
    -- website copy-paste block — there is one accessible Hebrew publication
    -- text, not two. Michal edits it in place in the dashboard, so there is
    -- deliberately no separate `reviewed_` counterpart: the edited text IS
    -- the text. "Needs generating" is expressed as `review_status = 'approved'`
    -- AND this column being NULL — no extra status field is needed.
    newsletter_text_he text,

    -- 'processing' is intentionally never written by the Processor (see
    -- docs/db_contract.md) — a mid-article status would only guard against
    -- concurrent workers, which cannot happen here, while risking an article
    -- getting stuck in it forever if a run dies mid-write. Kept in the check
    -- constraint only so this is not a live state a future reader should
    -- expect to see or design around.
    processing_status text not null default 'pending'
        check (processing_status in ('pending', 'processing', 'done', 'failed')),

    -- How many times Pass 1 (triage) has attempted this article. Without this,
    -- a failed Gemini call (transient network error, quota blip) sets
    -- processing_status='failed' and the article is never retried — lost
    -- permanently and silently. The Processor retries a 'failed' article up
    -- to 3 times across runs, then gives up — bounded so a genuinely
    -- malformed article cannot spin forever.
    processing_attempts integer not null default 0,

    review_status text not null default 'not_reviewed'
        check (review_status in ('not_reviewed', 'approved', 'irrelevant', 'needs_edit')),

    publish_target text not null default 'none'
        check (publish_target in ('none', 'website', 'newsletter', 'both')),

    publish_status text not null default 'not_published'
        check (publish_status in ('not_published', 'queued', 'published', 'failed')),

    reviewed_title_he text,
    reviewed_summary_he text,
    reviewed_by text,
    reviewed_at timestamptz,

    newsletter_batch_id text,
    published_to_website_at timestamptz,
    published_to_newsletter_at timestamptz,

    error_message text,
    archived_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (source_url),
    -- source_url alone is not a stable identity: some sources (e.g. Cure SMA's
    -- RSS) can change an article's URL after publication (e.g. when the title
    -- changes and the slug regenerates) while external_id (e.g. the WordPress
    -- post ID) stays the same. Both uniqueness guarantees are kept side by
    -- side so either kind of duplicate is caught. NULLs in external_id are
    -- not considered equal to one another by Postgres, so sources that don't
    -- provide an external_id are unaffected by this constraint.
    unique (source_name, external_id)
);

create index if not exists idx_content_items_processing_status
on content_items (processing_status);

create index if not exists idx_content_items_review_status
on content_items (review_status);

create index if not exists idx_content_items_publish_status
on content_items (publish_status);

create index if not exists idx_content_items_created_at
on content_items (created_at desc);

-- collector_runs records one row per Collector execution (not per source) so
-- the Dashboard's health check stays a single trivial query: the most recent
-- row with status in ('success', 'partial'). Per-source detail (which
-- sources ran, how many items each found, any per-source errors) belongs in
-- the `sources` jsonb column, not in separate rows.
create table if not exists collector_runs (
    id uuid primary key default gen_random_uuid(),

    started_at timestamptz not null default now(),
    finished_at timestamptz,

    -- 'running' — written when the run starts. A row left in this state
    --             (finished_at still null) means the process died mid-run.
    --             That is itself a useful signal, not just a missing update.
    -- 'success' — every source completed without error. A run that finds
    --             zero new articles is STILL a success: quiet weeks are
    --             normal for a low-volume news source and must not be
    --             reported as a failure.
    -- 'partial' — at least one source failed and at least one succeeded.
    -- 'failed'  — the run could not complete.
    status text not null default 'running'
        check (status in ('running', 'success', 'partial', 'failed')),

    items_seen integer not null default 0,
    items_inserted integer not null default 0,
    lookback_days integer,
    sources jsonb,
    error_message text
);

create index if not exists idx_collector_runs_started_at
on collector_runs (started_at desc);

-- Row Level Security
--
-- RLS is enabled on both tables, with deliberately permissive policies for the
-- `anon` and `authenticated` roles (the roles the Supabase anon key maps to).
-- The Collector and Processor connect via DATABASE_URL as the table owner,
-- which bypasses RLS entirely, so these policies do not affect them.
--
-- THIS IS NOT REAL AUTHENTICATION. The anon key is embedded in the
-- dashboard's client-side JavaScript and is therefore public. Anyone who
-- finds the dashboard URL can read every article and modify Michal's review
-- decisions. Withholding INSERT/DELETE policies limits the blast radius (a
-- leaked/public key cannot be used to destroy or pollute data) but does not
-- fix this. Proper Supabase Auth for the dashboard is a separate, still-open
-- task that must be done before handover.
--
-- These policies must live here, not be clicked together in the Supabase UI —
-- schema.sql is the single source of truth and must stay reproducible.

alter table content_items enable row level security;
alter table collector_runs enable row level security;

-- content_items: the Dashboard reads and updates rows, but never inserts or
-- deletes, so only SELECT and UPDATE policies exist. Their absence for
-- INSERT/DELETE is deliberate, not an oversight.
drop policy if exists content_items_select on content_items;
create policy content_items_select
on content_items
for select
to anon, authenticated
using (true);

drop policy if exists content_items_update on content_items;
create policy content_items_update
on content_items
for update
to anon, authenticated
using (true)
with check (true);

-- collector_runs: the Dashboard only ever reads this table (to show Collector
-- health). The Collector writes to it over the direct Postgres connection,
-- which bypasses RLS, so no write policy is needed here.
drop policy if exists collector_runs_select on collector_runs;
create policy collector_runs_select
on collector_runs
for select
to anon, authenticated
using (true);