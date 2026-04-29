update content_items
set
    raw_text = null,
    raw_html = null,
    archived_at = now()
where created_at < now() - interval '90 days'
  and archived_at is null
  and processing_status = 'done'
  and review_status in ('approved', 'irrelevant')
  and publish_status in ('published', 'not_published');