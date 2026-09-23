// src/components/NewsCards.jsx
import { useState } from 'react';

const BADGE = {
  not_reviewed: { text: 'ממתין',      bg: '#94a3b8' },
  needs_edit:   { text: 'לעריכה',     bg: '#f59e0b' },
  approved:     { text: 'אושר',       bg: '#22c55e' },
  irrelevant:   { text: 'לא רלוונטי', bg: '#ef4444' },
};

const STATUS_BORDER = {
  needs_edit:   '#f59e0b',
  approved:     '#22c55e',
  irrelevant:   '#ef4444',
  not_reviewed: 'transparent',
};

const PUBLISH_TARGET_LABEL = {
  website:    'אתר',
  newsletter: 'ניוזלטר',
  both:       'אתר + ניוזלטר',
  none:       'ללא יעד פרסום',
};

const toPublishTarget = ({ website, newsletter }) => {
  if (website && newsletter) return 'both';
  if (website) return 'website';
  if (newsletter) return 'newsletter';
  return 'none';
};

// Inverse of toPublishTarget — pre-fills the approve modal's checkboxes from
// the article's current publish_target, so opening it on an already-routed
// article shows where it's actually going instead of resetting to blank.
const toDestinations = (target) => ({
  website: target === 'website' || target === 'both',
  newsletter: target === 'newsletter' || target === 'both',
});

export default function NewsCard({ article, onUpdate }) {
  const {
    id,
    source_name,
    published_at,
    source_url,
    title_he,
    summary_he,
    reviewed_title_he,
    reviewed_summary_he,
    review_status,
    processing_status,
    publish_target,
  } = article;

  const isProcessing = processing_status !== 'done';

  const displayTitle   = reviewed_title_he   ?? title_he   ?? '';
  const displaySummary = reviewed_summary_he ?? summary_he ?? '';

  const [showModal, setShowModal]                   = useState(false);
  const [showRejectModal, setShowRejectModal]       = useState(false);
  const [skipRejectConfirm, setSkipRejectConfirm]   = useState(false);
  const [editTitle, setEditTitle]                   = useState(displayTitle);
  const [editSummary, setEditSummary]               = useState(displaySummary);
  const [showApproveModal, setShowApproveModal]     = useState(false);
  const [approveDestinations, setApproveDestinations] = useState({ website: false, newsletter: false });
  const [expanded, setExpanded]                     = useState(false);

  const noDestinationSelected = !approveDestinations.website && !approveDestinations.newsletter;

  const formattedDate  = published_at ? new Date(published_at).toLocaleDateString('he-IL') : '—';
  const isTruncated    = displaySummary.length > 180;
  const summarySnippet = isTruncated && !expanded
    ? displaySummary.substring(0, 180)
    : displaySummary;

  const openModal = () => {
    setEditTitle(reviewed_title_he ?? title_he ?? '');
    setEditSummary(reviewed_summary_he ?? summary_he ?? '');
    setShowModal(true);
  };

  const saveDraft = () => {
    onUpdate(id, {
      reviewed_title_he:   editTitle,
      reviewed_summary_he: editSummary,
      review_status:       'needs_edit',
      reviewed_by:         'michal',
      reviewed_at:         new Date().toISOString(),
    });
    setShowModal(false);
  };

  const handleRejectClick = () => {
    if (localStorage.getItem('skipRejectConfirm') === 'true') {
      onUpdate(id, { review_status: 'irrelevant', reviewed_by: 'michal', reviewed_at: new Date().toISOString() });
    } else {
      setSkipRejectConfirm(false);
      setShowRejectModal(true);
    }
  };

  const confirmReject = () => {
    if (skipRejectConfirm) localStorage.setItem('skipRejectConfirm', 'true');
    onUpdate(id, { review_status: 'irrelevant', reviewed_by: 'michal', reviewed_at: new Date().toISOString() });
    setShowRejectModal(false);
  };

  const openApproveFromEdit = () => {
    onUpdate(id, { reviewed_title_he: editTitle, reviewed_summary_he: editSummary });
    setShowModal(false);
    setApproveDestinations(toDestinations(publish_target));
    setShowApproveModal(true);
  };

  const openApproveModal = () => {
    setApproveDestinations(toDestinations(publish_target));
    setShowApproveModal(true);
  };

  const takeBackApproval = () => {
    // Deliberately does NOT clear newsletter_text_he: if Michal re-approves
    // later, the publication text is still there and no Gemini call is
    // spent regenerating it.
    onUpdate(id, { review_status: 'not_reviewed', publish_target: 'none' });
  };

  return (
    <>
      <div style={{ ...cardStyle, borderLeft: `4px solid ${STATUS_BORDER[review_status] ?? 'transparent'}` }}>
        <div style={{ opacity: review_status === 'irrelevant' ? 0.6 : 1 }}>
          <div style={cardHeaderStyle}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{displayTitle}</h3>
            {BADGE[review_status] && (
              <span style={{ ...statusBadgeStyle, background: BADGE[review_status].bg }}>
                {BADGE[review_status].text}
              </span>
            )}
          </div>
          <div style={metaStyle}>
            <strong>מקור:</strong> {source_name} | <strong>תאריך:</strong> {formattedDate} |{' '}
            <a href={source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>מעבר למקור</a>
          </div>
          {review_status === 'approved' && (
            <div
              style={{
                ...publishTargetStyle,
                ...(publish_target === 'none' ? publishTargetWarningStyle : publishTargetOkStyle),
              }}
            >
              {PUBLISH_TARGET_LABEL[publish_target] ?? publish_target}
            </div>
          )}
          {isProcessing ? (
            <p style={processingPlaceholderStyle}>הידיעה עדיין בתהליך עיבוד</p>
          ) : (
            <p style={{ lineHeight: '1.5', marginTop: '12px', marginBottom: '12px', fontSize: '0.85rem' }}>
              {summarySnippet}
              {isTruncated && (
                <>
                  {!expanded && '...'}
                  <button onClick={() => setExpanded(e => !e)} style={readMoreBtnStyle}>
                    {expanded ? 'קרא פחות' : 'קרא עוד'}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        <div style={actionsStyle}>
          {review_status === 'irrelevant' ? (
            <button
              style={{ ...btnStyle, backgroundColor: 'var(--secondary)', color: '#fff', borderColor: 'var(--secondary)' }}
              onClick={() => onUpdate(id, { review_status: 'not_reviewed' })}
            >
              החזרה לתור ידיעות חדשות
            </button>
          ) : review_status === 'approved' ? (
            <>
              <button style={btnStyle} onClick={openModal}>עריכה</button>
              <button
                style={{ ...btnStyle, backgroundColor: '#22c55e', color: '#fff', borderColor: '#22c55e' }}
                onClick={openApproveModal}
              >
                שינוי יעד
              </button>
              {/* No direct "reject" button here on purpose: rejecting an
                  already-approved article now takes two deliberate steps —
                  this button back to the queue, then דחייה from there —
                  rather than one click, which is the safer default for an
                  approval that may already be live in the newsletter/site. */}
              <button
                style={{ ...btnStyle, backgroundColor: 'var(--secondary)', color: '#fff', borderColor: 'var(--secondary)' }}
                onClick={takeBackApproval}
              >
                החזרה לתור
              </button>
            </>
          ) : (
            <>
              <button style={btnStyle} onClick={openModal}>עריכה</button>
              <button
                style={{ ...btnStyle, backgroundColor: '#22c55e', color: '#fff', borderColor: '#22c55e' }}
                onClick={openApproveModal}
              >
                פירסום
              </button>
              <button
                style={{ ...btnStyle, backgroundColor: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
                onClick={handleRejectClick}
              >
                דחייה
              </button>
            </>
          )}
        </div>
      </div>

      {showRejectModal && (
        <div style={overlayStyle} onClick={() => setShowRejectModal(false)}>
          <div style={{ ...modalStyle, width: '360px' }} onClick={e => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>האם לדחות את הידיעה?</h3>
              <button style={closeBtnStyle} onClick={() => setShowRejectModal(false)}>✕</button>
            </div>
            <label style={{ ...checkboxLabelStyle, fontSize: '0.85rem', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={skipRejectConfirm}
                onChange={e => setSkipRejectConfirm(e.target.checked)}
                style={{ accentColor: '#e8614a', width: '15px', height: '15px', cursor: 'pointer' }}
              />
              אל תציג הודעה זו שוב
            </label>
            <div style={modalFooterStyle}>
              <button
                style={{ ...btnStyle, backgroundColor: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
                onClick={confirmReject}
              >
                דחיית הידיעה
              </button>
              <button style={btnStyle} onClick={() => setShowRejectModal(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {showApproveModal && (
        <div style={overlayStyle} onClick={() => setShowApproveModal(false)}>
          <div style={{ ...modalStyle, width: '360px' }} onClick={e => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>יעד הפירסום</h3>
              <button style={closeBtnStyle} onClick={() => setShowApproveModal(false)}>✕</button>
            </div>
            <div style={approveCheckboxesStyle}>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={approveDestinations.website}
                  onChange={e => setApproveDestinations(d => ({ ...d, website: e.target.checked }))}
                  style={{ accentColor: '#e8614a', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                אתר
              </label>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={approveDestinations.newsletter}
                  onChange={e => setApproveDestinations(d => ({ ...d, newsletter: e.target.checked }))}
                  style={{ accentColor: '#e8614a', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                ניוזלטר
              </label>
            </div>
            <div style={modalFooterStyle}>
              {/* Always clickable — the previous version disabled this
                  button with no destination selected, but "approved, I
                  haven't decided where yet" is a legitimate thing for
                  Michal to mean, and the danger that guarded against (an
                  article approved to nowhere, invisibly) is now handled by
                  the red "ללא יעד פרסום" badge shown on the card itself.
                  Instead, the button's own label and colour say exactly
                  what it will do, so confirming it can't be an accident. */}
              <button
                style={{
                  ...btnStyle,
                  backgroundColor: noDestinationSelected ? '#9ca3af' : '#22c55e',
                  color: '#fff',
                  borderColor: noDestinationSelected ? '#9ca3af' : '#22c55e',
                }}
                onClick={() => {
                  onUpdate(id, {
                    review_status:  'approved',
                    publish_target: toPublishTarget(approveDestinations),
                    reviewed_by:    'michal',
                    reviewed_at:    new Date().toISOString(),
                  });
                  setShowApproveModal(false);
                }}
              >
                {noDestinationSelected ? 'אישור ללא יעד' : 'פירסום'}
              </button>
              <button style={btnStyle} onClick={() => setShowApproveModal(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div style={overlayStyle} onClick={() => setShowModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>עריכת ידיעה</h3>
              <button style={closeBtnStyle} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div>
              <label style={labelStyle}>כותרת</label>
              <input style={inputStyle} value={editTitle} onChange={e => setEditTitle(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>תקציר</label>
              <textarea style={textareaStyle} rows={5} value={editSummary} onChange={e => setEditSummary(e.target.value)} />
            </div>
            <div style={modalFooterStyle}>
              <button style={{ ...btnStyle, backgroundColor: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }} onClick={saveDraft}>שמירת טיוטה</button>
              <button style={{ ...btnStyle, backgroundColor: '#22c55e', color: '#fff', borderColor: '#22c55e' }} onClick={openApproveFromEdit}>פירסום</button>
              <button style={btnStyle} onClick={() => setShowModal(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </>
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

const metaStyle = { fontSize: '0.9rem', color: 'var(--text)' };

const actionsStyle = {
  marginTop: '12px',
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-start',
  alignItems: 'center',
};

const btnStyle = {
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  background: 'var(--bg-secondary)',
  color: 'var(--text-h)',
};

const statusBadgeStyle = {
  flexShrink: 0,
  alignSelf: 'flex-start',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  padding: '2px 10px',
  color: '#fff',
};

const publishTargetStyle = {
  display: 'inline-block',
  marginTop: '4px',
  marginBottom: '8px',
  padding: '2px 10px',
  borderRadius: '999px',
  fontSize: '0.75rem',
  fontWeight: 600,
};

const publishTargetOkStyle = {
  background: 'var(--secondary-bg)',
  color: 'var(--secondary)',
  border: '1px solid rgba(74, 191, 176, 0.3)',
};

const publishTargetWarningStyle = {
  background: 'rgba(239, 68, 68, 0.12)',
  color: '#ef4444',
  border: '1px solid rgba(239, 68, 68, 0.35)',
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalStyle = {
  background: 'var(--bg, #fff)',
  borderRadius: '12px',
  padding: '24px',
  width: '560px',
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const modalHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };

const closeBtnStyle = {
  background: 'none',
  border: 'none',
  fontSize: '1.2rem',
  cursor: 'pointer',
  color: 'var(--text)',
  lineHeight: 1,
};

const labelStyle = { fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '4px', display: 'block' };

const inputStyle = {
  width: '100%',
  padding: '8px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  textAlign: 'right',
  background: 'var(--bg)',
  color: 'var(--text-h)',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
};

const modalFooterStyle = { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' };

const cardHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '12px',
};

const approveCheckboxesStyle = {
  display: 'flex',
  gap: '20px',
  padding: '8px 0',
};

const processingPlaceholderStyle = {
  margin: '12px 0',
  fontSize: '0.85rem',
  color: 'var(--text)',
  fontStyle: 'italic',
  opacity: 0.6,
};

const readMoreBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--accent)',
  textDecoration: 'underline',
  fontSize: 'inherit',
  padding: '0 4px',
  fontFamily: 'inherit',
};

const checkboxLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '0.85rem',
  cursor: 'pointer',
};
