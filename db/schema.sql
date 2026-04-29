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
    raw_html text,

    summary_en text,
    title_he text,
    summary_he text,

    processing_status text not null default 'pending'
        check (processing_status in ('pending', 'processing', 'done', 'failed')),

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

    wordpress_post_id text,
    newsletter_batch_id text,
    published_to_website_at timestamptz,
    published_to_newsletter_at timestamptz,

    error_message text,
    archived_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (source_url)
);

create index if not exists idx_content_items_processing_status
on content_items (processing_status);

create index if not exists idx_content_items_review_status
on content_items (review_status);

create index if not exists idx_content_items_publish_status
on content_items (publish_status);

create index if not exists idx_content_items_created_at
on content_items (created_at desc);