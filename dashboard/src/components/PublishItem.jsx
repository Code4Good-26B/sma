// src/components/PublishItem.jsx
//
// One approved article's publication text, editable in place. Saves
// directly to newsletter_text_he — there is deliberately no
// reviewed_newsletter_text_he column, unlike the reviewed_title_he /
// reviewed_summary_he pattern used for the triage text. Pass 2's own
// selection guard is `newsletter_text_he IS NULL`
// (processor/process_newsletter_text.py), so an edited (non-null) text is
// already safe from being silently regenerated over — that property falls
// out of the existing guard for free. A second column would buy exactly one
// thing (seeing the original AI text after an edit) at the cost of a
// migration, a schema change, a contract update in three documents, and a
// fallback rule in every reader. The real trade-off, recorded here and in
// docs/project_notes.md: editing is destructive — there is no "revert to
// generated" in this UI. If that turns out to matter, the answer is adding
// reviewed_newsletter_text_he later; nothing here needs to change to allow
// that.
import { useState } from 'react';
import { buildWebsiteHtml, buildWebsitePlainText } from '../lib/buildWebsiteHtml.js';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// channel distinguishes the two /publish tabs, which share this component
// for the title/summary header, the edit textarea and the save flow, but
// diverge below that: the newsletter tab has no per-item copy/publish
// buttons (that's NewsletterBuilder's batch flow), while the website tab
// has no batch step at all — Michal copies and marks one article at a time,
// since WordPress has no API integration to build a batch against (see
// docs/project_notes.md).
export default function PublishItem({ article, onUpdate, channel = 'newsletter' }) {
  const {
    id,
    source_name,
    published_at,
    source_url,
    title_he,
    reviewed_title_he,
    newsletter_text_he,
    reviewed_at,
    newsletter_batch_id,
    published_to_newsletter_at,
    published_to_website_at,
  } = article;

  const displayTitle = reviewed_title_he ?? title_he ?? '';
  const formattedDate = published_at ? new Date(published_at).toLocaleDateString('he-IL') : '—';
  const sentDate = published_to_newsletter_at
    ? new Date(published_to_newsletter_at).toLocaleDateString('he-IL')
    : null;
  const websitePublishedDate = published_to_website_at
    ? new Date(published_to_website_at).toLocaleDateString('he-IL')
    : null;

  const savedText = newsletter_text_he ?? '';
  const [text, setText] = useState(savedText);
  const [saved, setSaved] = useState(false);

  const isDirty = text !== savedText;
  const hasText = savedText.trim().length > 0;

  // Shared by the שמירה button and handleCopyContent below — both save the
  // same way, to the same column, and both need to know whether it worked.
  const saveText = async () => {
    const ok = await onUpdate(id, { newsletter_text_he: text });
    // Failure already shows the shared toast from onUpdate itself — callers
    // only need to react to the success case.
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    return ok;
  };

  const handleSave = async () => {
    setSaved(false);
    await saveText();
  };

  // Website-channel actions — independent of the save flow above, and of
  // each other: copying is read-only and never touches the database (except
  // handleCopyContent's own save-before-copy, see below); marking published
  // is the only one that always writes, through the same onUpdate every
  // other write in this app uses.
  const [titleCopyState, setTitleCopyState] = useState(null); // 'ok' | 'error' | null
  const [contentCopyState, setContentCopyState] = useState(null);
  const [marking, setMarking] = useState(false);
  const [markState, setMarkState] = useState(null); // 'ok' | 'error' | null

  // These three notes disappear on their own, like `saved` above — a single
  // helper instead of repeating the same setter + setTimeout three times.
  const flashState = (setter, value) => {
    setter(value);
    setTimeout(() => setter(null), 3000);
  };

  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(displayTitle);
      flashState(setTitleCopyState, 'ok');
    } catch (err) {
      // The Clipboard API can be refused by the browser — a copy button
      // that silently does nothing on failure is worse than no button.
      console.error('Title clipboard copy failed:', err);
      flashState(setTitleCopyState, 'error');
    }
  };

  const handleCopyContent = async () => {
    // Invariant: after this button returns, the clipboard content and
    // newsletter_text_he in the database can never disagree — an unsaved
    // edit is saved first, and a failed save never reaches the clipboard.
    if (isDirty) {
      setSaved(false);
      const ok = await saveText();
      if (!ok) {
        flashState(setContentCopyState, 'error');
        return;
      }
    }
    try {
      const html = buildWebsiteHtml({ url: source_url, text });
      const plain = buildWebsitePlainText({ url: source_url, text });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      flashState(setContentCopyState, 'ok');
    } catch (err) {
      console.error('Content clipboard copy failed:', err);
      flashState(setContentCopyState, 'error');
    }
  };

  const handleMarkPublished = async () => {
    setMarking(true);
    const ok = await onUpdate(id, { published_to_website_at: new Date().toISOString() });
    setMarking(false);
    flashState(setMarkState, ok ? 'ok' : 'error');
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{displayTitle}</h3>
      </div>
      <div style={metaStyle}>
        <strong>מקור:</strong> {source_name} | <strong>תאריך:</strong> {formattedDate} |{' '}
        <a href={source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>מעבר למקור</a>
      </div>

      {/* newsletter_batch_id / published_to_website_at are set only by the
          deliberate per-channel actions below (docs/db_contract.md,
          "Dashboard (as Publisher)") — an article stays fully visible and
          editable after either, so nothing here disappears silently, but
          these notes make clear it already went out and isn't waiting on
          anything. Both can be true of the same article (publish_target
          'both'), so both render independently. */}
      {newsletter_batch_id && (
        <div style={sentNoticeStyle}>נשלח בניוזלטר{sentDate ? ` ב-${sentDate}` : ''}</div>
      )}
      {websitePublishedDate && (
        <div style={sentNoticeStyle}>פורסם באתר ב-{websitePublishedDate}</div>
      )}

      {hasText ? (
        <>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false); }}
            rows={10}
            style={textareaStyle}
          />
          <div style={actionsRowStyle}>
            <button
              disabled={!isDirty}
              style={{
                ...saveBtnStyle,
                ...(isDirty ? {} : { opacity: 0.5, cursor: 'not-allowed' }),
              }}
              onClick={handleSave}
            >
              שמירה
            </button>
            {saved && <span style={savedNoteStyle}>נשמר ✓</span>}
          </div>

          {channel === 'website' && (
            <>
              <div style={websiteActionsRowStyle}>
                <button style={secondaryBtnStyle} onClick={handleCopyTitle}>העתק כותרת</button>
                <button style={secondaryBtnStyle} onClick={handleCopyContent}>העתק תוכן</button>
                <button
                  style={markPublishedBtnStyle}
                  disabled={marking}
                  onClick={handleMarkPublished}
                >
                  {marking ? 'מסמנת...' : 'סמן כפורסם באתר'}
                </button>
              </div>
              {titleCopyState === 'ok' && <p style={successNoteStyle}>הכותרת הועתקה.</p>}
              {titleCopyState === 'error' && (
                <p style={errorNoteStyle}>העתקת הכותרת נכשלה — הדפדפן חסם את הגישה ללוח ההעתקה.</p>
              )}
              {contentCopyState === 'ok' && <p style={successNoteStyle}>התוכן הועתק, כולל עיצוב.</p>}
              {/* Generic wording on purpose: this state now covers two
                  different causes (the clipboard API was refused, or the
                  save-before-copy failed and the copy never ran) — see the
                  invariant comment in handleCopyContent. A message blaming
                  the clipboard specifically would be wrong for the second
                  cause, and onUpdate already shows its own failure toast for
                  a failed save. */}
              {contentCopyState === 'error' && (
                <p style={errorNoteStyle}>העתקת התוכן נכשלה — לא הועתק דבר.</p>
              )}
              {markState === 'ok' && <p style={successNoteStyle}>סומן כפורסם באתר.</p>}
              {markState === 'error' && <p style={errorNoteStyle}>הסימון נכשל, נסי שוב.</p>}
            </>
          )}
        </>
      ) : (
        <>
          <EmptyTextNotice reviewedAt={reviewed_at} />
          {/* No content-copy or mark-published button without a publication
              text — there is nothing to paste into the content area yet.
              The title exists independently (Pass 1), so its copy button
              still works. */}
          {channel === 'website' && (
            <>
              <div style={websiteActionsRowStyle}>
                <button style={secondaryBtnStyle} onClick={handleCopyTitle}>העתק כותרת</button>
              </div>
              {titleCopyState === 'ok' && <p style={successNoteStyle}>הכותרת הועתקה.</p>}
              {titleCopyState === 'error' && (
                <p style={errorNoteStyle}>העתקת הכותרת נכשלה — הדפדפן חסם את הגישה ללוח ההעתקה.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function EmptyTextNotice({ reviewedAt }) {
  const approvedAtMs = reviewedAt ? new Date(reviewedAt).getTime() : null;
  const isRecent = approvedAtMs == null || (new Date().getTime() - approvedAtMs) <= TWO_DAYS_MS;

  if (isRecent) {
    return (
      <p style={infoNoticeStyle}>
        הטקסט טרם נוצר. הוא ייווצר אוטומטית בהרצה הבאה.
      </p>
    );
  }

  const dateStr = new Date(reviewedAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
  return (
    <p style={warningNoticeStyle}>
      הטקסט לא נוצר מאז האישור ב-{dateStr}.
    </p>
  );
}

const cardStyle = {
  boxSizing: 'border-box',
  width: '100%',
  background: 'var(--bg, #fff)',
  border: '1px solid var(--border, #e0e0e0)',
  boxShadow: 'var(--shadow, 0 2px 4px rgba(0,0,0,0.05))',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '15px',
  textAlign: 'right',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '12px',
};

const metaStyle = { fontSize: '0.9rem', color: 'var(--text)', marginBottom: '12px' };

const sentNoticeStyle = {
  display: 'inline-block',
  marginBottom: '12px',
  padding: '2px 10px',
  borderRadius: '999px',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--secondary-bg, rgba(74,191,176,0.08))',
  color: 'var(--secondary, #4abfb0)',
};

const textareaStyle = {
  width: '100%',
  minHeight: '180px',
  padding: '10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '0.9rem',
  lineHeight: '1.6',
  boxSizing: 'border-box',
  textAlign: 'right',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  fontFamily: 'inherit',
  resize: 'vertical',
};

const actionsRowStyle = {
  marginTop: '10px',
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
};

const saveBtnStyle = {
  padding: '6px 18px',
  borderRadius: '4px',
  border: '1px solid var(--accent)',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
  background: 'var(--accent)',
  color: '#fff',
};

const savedNoteStyle = {
  fontSize: '0.82rem',
  color: 'var(--secondary)',
  fontWeight: 600,
};

const infoNoticeStyle = {
  margin: 0,
  padding: '10px 14px',
  borderRadius: '6px',
  fontSize: '0.85rem',
  background: 'var(--bg-secondary)',
  color: 'var(--text)',
};

const warningNoticeStyle = {
  margin: 0,
  padding: '10px 14px',
  borderRadius: '6px',
  fontSize: '0.85rem',
  fontWeight: 600,
  background: 'rgba(245, 158, 11, 0.12)',
  color: '#b45309',
  border: '1px solid rgba(245, 158, 11, 0.35)',
};

const websiteActionsRowStyle = {
  marginTop: '12px',
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  alignItems: 'center',
};

const secondaryBtnStyle = {
  padding: '6px 16px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: '0.85rem',
  background: 'var(--bg-secondary)',
  color: 'var(--text-h)',
};

const markPublishedBtnStyle = {
  padding: '6px 16px',
  borderRadius: '4px',
  border: '1px solid var(--secondary)',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
  background: 'var(--secondary)',
  color: '#fff',
  marginInlineStart: 'auto',
};

const successNoteStyle = {
  marginTop: '8px',
  marginBottom: 0,
  fontSize: '0.82rem',
  color: 'var(--secondary, #4abfb0)',
  fontWeight: 600,
};

const errorNoteStyle = {
  marginTop: '8px',
  marginBottom: 0,
  fontSize: '0.82rem',
  color: '#ef4444',
  fontWeight: 600,
};
