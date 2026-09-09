-- Quick inspection queries for development and testing.
-- Run via Supabase SQL Editor.

-- Collector health: most recent run, its status, how long ago it finished,
-- and how many items it inserted. This is the query the Dashboard's health
-- indicator is built on: "the most recent row with status in ('success', 'partial')".
SELECT
    id,
    status,
    started_at,
    finished_at,
    now() - finished_at AS time_since_finished,
    items_seen,
    items_inserted,
    error_message
FROM collector_runs
ORDER BY started_at DESC
LIMIT 1;

-- Total articles by source
SELECT source_name, COUNT(*) AS total
FROM content_items
GROUP BY source_name
ORDER BY total DESC;

-- Recent articles (last 20)
SELECT source_name, title_en, published_at, processing_status, created_at
FROM content_items
ORDER BY created_at DESC
LIMIT 20;

-- Status breakdown
SELECT processing_status, COUNT(*) AS total
FROM content_items
GROUP BY processing_status
ORDER BY total DESC;

-- Articles with missing data
SELECT id, source_name, title_en, published_at
FROM content_items
WHERE published_at IS NULL
   OR title_en = ''
   OR raw_text = ''
ORDER BY created_at DESC;
