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

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export default function PublishItem({ article, onUpdate }) {
  const {
    id,
    source_name,
    published_at,
    source_url,
    title_he,
    reviewed_title_he,
    newsletter_text_he,
    reviewed_at,
  } = article;

  const displayTitle = reviewed_title_he ?? title_he ?? '';
  const formattedDate = published_at ? new Date(published_at).toLocaleDateString('he-IL') : '—';

  const savedText = newsletter_text_he ?? '';
  const [text, setText] = useState(savedText);
  const [saved, setSaved] = useState(false);

  const isDirty = text !== savedText;
  const hasText = savedText.trim().length > 0;

  const handleSave = async () => {
    setSaved(false);
    const ok = await onUpdate(id, { newsletter_text_he: text });
    // Failure already shows the shared toast from onUpdate itself — this
    // component only needs to react to the success case.
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
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
        </>
      ) : (
        <EmptyTextNotice reviewedAt={reviewed_at} />
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
