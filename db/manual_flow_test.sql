begin;

-- Insert a manual test item, simulating the Collector
insert into content_items (
    source_name,
    source_type,
    source_url,
    external_id,
    published_at,
    title_en,
    raw_text
)
values (
    'MANUAL_TEST',
    'website',
    'https://manual-test.local/stage-13-flow-test',
    'manual-test-stage-13',
    now(),
    'Manual test article',
    'This is a manual test article used to verify the full database workflow.'
);

-- Verify that the Processor (Pass 1 / triage) can find pending items
select *
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test'
  and processing_status = 'pending';

-- Simulate Processor Pass 1 (triage): Hebrew title + short summary for Michal to review
update content_items
set
    title_he = 'כותרת בדיקה בעברית',
    summary_he = 'זהו סיכום בדיקה בעברית עבור בדיקת הזרימה המלאה.',
    processing_status = 'done',
    processing_attempts = processing_attempts + 1,
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

-- Verify that the Processor (Pass 2 / publication text) can find approved
-- items that still need their publication text generated
select *
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test'
  and review_status = 'approved'
  and newsletter_text_he is null;

-- Simulate Processor Pass 2: the accessible Hebrew publication text
-- (serves both the newsletter and the website copy-paste block)
update content_items
set
    newsletter_text_he = 'זהו טקסט הפרסום הנגיש בעברית לבדיקת הזרימה המלאה.',
    updated_at = now()
where source_url = 'https://manual-test.local/stage-13-flow-test'
returning *;

-- Verify that the Dashboard (acting as the Publisher) can find items ready
-- to be generated into a newsletter or copied to the website
select *
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test'
  and review_status = 'approved'
  and publish_target != 'none'
  and publish_status = 'not_published';

-- Simulate Michal copying the article to the website from the dashboard
-- (there is no WordPress API call — this is a manual copy-paste action,
-- the dashboard just stamps that it happened so the item isn't offered again)
update content_items
set
    publish_status = 'published',
    published_to_website_at = now(),
    updated_at = now()
where source_url = 'https://manual-test.local/stage-13-flow-test'
returning *;

-- Verify the final state
select
    source_name,
    source_url,
    processing_status,
    processing_attempts,
    review_status,
    publish_target,
    publish_status,
    title_he,
    summary_he,
    newsletter_text_he,
    reviewed_title_he,
    reviewed_summary_he,
    published_to_website_at
from content_items
where source_url = 'https://manual-test.local/stage-13-flow-test';

rollback;
