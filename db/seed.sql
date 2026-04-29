insert into content_items (
    source_name,
    source_type,
    source_url,
    published_at,
    title_en,
    raw_text,
    processing_status,
    review_status,
    publish_target,
    publish_status
)
values
(
    'SMA Europe',
    'website',
    'https://example.com/sma-europe-sample-1',
    now(),
    'New SMA research update',
    'This is a sample article text about SMA research progress.',
    'pending',
    'not_reviewed',
    'none',
    'not_published'
),
(
    'Cure SMA',
    'website',
    'https://example.com/cure-sma-sample-1',
    now(),
    'Clinical trial update for SMA',
    'This is a sample article text about a clinical trial update.',
    'pending',
    'not_reviewed',
    'none',
    'not_published'
);