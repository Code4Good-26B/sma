begin;

-- Insert a manual test item, simulating the Collector
insert into content_items (
    source_name,
    source_type,
    source_url,
    external_id,
    published_at,
    title_en,
    raw_text,
    raw_html
)
values (
    'MANUAL_TEST',
    'website',
    'https://manual-test.local/stage-13-flow-test',
    'manual-test-stage-13',
    now(),
    'Manual test article',
    'This is a manual test article used to verify the full database workflow.',
    null
);

-- Verify that the Processor can find pending items
select *
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test'
  and processing_status = 'pending';

-- Simulate Processor work
update content_items
set
    summary_en = 'Sample English summary for the manual flow test.',
    title_he = 'כותרת בדיקה בעברית',
    summary_he = 'זהו סיכום בדיקה בעברית עבור בדיקת הזרימה המלאה.',
    processing_status = 'done',
    updated_at = now()
where source_url = 'https://manual-test.local/stage-13-flow-test'
returning *;

-- Verify that the Dashboard can find processed items
select *
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test'
  and processing_status = 'done';

-- Simulate Michal's review decision in the Dashboard
update content_items
set
    review_status = 'approved',
    publish_target = 'website',
    reviewed_title_he = title_he,
    reviewed_summary_he = summary_he,
    reviewed_by = 'Michal',
    reviewed_at = now(),
    updated_at = now()
where source_url = 'https://manual-test.local/stage-13-flow-test'
returning *;

-- Verify that the Publisher can find items ready for publishing
select *
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test'
  and review_status = 'approved'
  and publish_target != 'none'
  and publish_status = 'not_published';

-- Simulate successful publishing
update content_items
set
    publish_status = 'published',
    wordpress_post_id = 'manual-test-wordpress-post-id',
    published_to_website_at = now(),
    updated_at = now()
where source_url = 'https://manual-test.local/stage-13-flow-test'
returning *;

-- Verify the final state
select
    source_name,
    source_url,
    processing_status,
    review_status,
    publish_target,
    publish_status,
    title_he,
    summary_he,
    reviewed_title_he,
    reviewed_summary_he,
    wordpress_post_id,
    published_to_website_at
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test';

rollback;