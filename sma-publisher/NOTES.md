# Notes — decisions and open items

## Design decisions

The template follows the association's own designed template: Hebrew-first RTL,
coral `#F28080` / teal `#68B4B4`, Rubik/Heebo with Arial fallback. English mirrors
it in LTR. Palette and fonts live in `THEME` in `src/publisher.py`; all chrome text
(header, intro, "read more", disclaimer, footer, contact details) lives in
`STRINGS` in the same file. Full spec: `docs/newsletter-design-spec.md`.

Deliberately not in the design: per-article images, source pills, issue numbers,
unsubscribe link. Cards are title + summary + external link.

The masthead date is the Gregorian month and year in the locale's language
(`יוני 2026` / `June 2026`) — no Hebrew calendar.

RTL was never literally specified in a project doc; it was inferred from Hebrew
being right-to-left. The closest the docs come is Mai's Dashboard sprint plan
("ensure the UI handles Hebrew titles and sources correctly").

The Hebrew `STRINGS` are the association's own wording. **The English `STRINGS`
are unreviewed translations** and were never signed off.

The Publisher deliberately does no summarization — content arrives already
summarized from the Processor. It renders, it doesn't transform.

## Open items

### Real data instead of fixtures (highest priority)

The Publisher reads `sample_articles/*.json`. In production it must query the
database. Per `docs/db-contract.md` the query is:

```sql
SELECT * FROM content_items
WHERE review_status = 'approved'
  AND publish_target IN ('newsletter', 'both')
  AND publish_status = 'not_published';
```

**The field names don't line up yet.** `FIELD_MAP` in `src/publisher.py` expects
`title` / `content` / `title_he` / `summary_he`; the DB contract defines
`title_en` / `summary_en` / `title_he` / `summary_he`. Two changes needed:

1. Map English to `title_en` / `summary_en`.
2. Prefer Michal's edits — `reviewed_title_he` and `reviewed_summary_he` should
   take precedence over `title_he` / `summary_he` when present. The Publisher
   currently ignores them entirely.

After a send, the Publisher is also supposed to write back `publish_status`,
`newsletter_batch_id` and `published_to_newsletter_at`. None of that is
implemented.

### Curation and batching

Every JSON in the input directory goes into one newsletter. The real flow has
Michal choosing items in the Dashboard, and the Publisher receiving exactly that
set. There's also no notion of an issue or a dated batch.

### Email delivery

- Brevo list id 2 ("SMA Newsletter") is empty. Populating it is most cheaply done
  with the Brevo WordPress plugin, syncing continuously from the site's signup
  form; a custom WP→Brevo sync script is the more expensive alternative.
- `send_brevo.py --send` (campaign → list) is implemented but has never run
  against a real list. Untested end to end.
- Sends currently come from `ran.mahalal@gmail.com`, which works but hurts spam
  placement. Real distribution wants SPF/DKIM on `sma.org.il` and a
  `@sma.org.il` sender.
- Brevo free tier caps at 300 emails/day.

### Dashboard integration

The intended flow — manager selects articles → "Create Newsletter" → preview →
"Send Newsletter" — isn't built. Both scripts are CLI and file-based. It needs a
backend endpoint the Dashboard can call for render + send, plus an in-dashboard
preview of the rendered HTML.

## Verified

Hebrew and English render correctly in Gmail (tested by transactional send to
`ran.mahalal@gmail.com` and `sma.org.il@gmail.com`). PDF generation works via
WeasyPrint on macOS with Pango installed.

Never tested: campaign send to a list, any real Collector or Processor output,
any Dashboard output.
