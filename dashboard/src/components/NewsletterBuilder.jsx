// src/components/NewsletterBuilder.jsx
//
// "צור ניוזלטר" builds a preview in memory from the currently-unsent
// newsletter articles and writes nothing to the database. Marking those
// articles as sent (newsletter_batch_id + published_to_newsletter_at) is a
// separate, deliberate action — the "סמן כנשלח" button below, distinct from
// and visually secondary to the three export actions above it.
//
// Why separate: this system has no way to know whether Michal actually sent
// the mail. Marking on generation would mean that previewing the
// newsletter, spotting a typo, and closing the tab silently consumes those
// articles — they would never reach anyone, and nothing would show that.
// Marking only on an explicit click risks the opposite mistake: she forgets,
// and the same articles get offered again in the next newsletter. But
// duplication is recoverable (a family reads the same update twice) and
// silent loss is not, so the explicit click wins. See docs/db_contract.md
// ("Dashboard (as Publisher)") for the same reasoning applied to the
// (not yet built) website copy flow.
import { useState } from 'react';
import { buildNewsletterHtml, buildNewsletterPlainText } from '../lib/buildNewsletterHtml';
import { formatIssueDateHe } from '../lib/newsletterTheme';

export default function NewsletterBuilder({ eligibleArticles, onUpdate }) {
  const [preview, setPreview] = useState(null); // { html, plainText, articleIds, generatedAt }
  const [copyState, setCopyState] = useState(null); // 'ok' | 'error' | null
  const [hasExported, setHasExported] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markResult, setMarkResult] = useState(null); // { ok, total } | null

  const missingTextCount = eligibleArticles.filter(
    (a) => !a.newsletter_text_he || !a.newsletter_text_he.trim()
  ).length;
  const canGenerate = eligibleArticles.length > 0 && missingTextCount === 0;

  const handleGenerate = () => {
    const generatedAt = new Date();
    const mapped = eligibleArticles.map((a) => ({
      title: a.reviewed_title_he ?? a.title_he ?? '',
      url: a.source_url,
      text: a.newsletter_text_he ?? '',
    }));
    const issueDate = formatIssueDateHe(generatedAt);
    setPreview({
      html: buildNewsletterHtml(mapped, issueDate),
      plainText: buildNewsletterPlainText(mapped, issueDate),
      articleIds: eligibleArticles.map((a) => a.id),
      generatedAt,
    });
    setCopyState(null);
    setHasExported(false);
    setMarkResult(null);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([preview.html], { type: 'text/html' }),
          'text/plain': new Blob([preview.plainText], { type: 'text/plain' }),
        }),
      ]);
      setCopyState('ok');
      setHasExported(true);
    } catch (err) {
      // The Clipboard API can be refused by the browser (permissions,
      // insecure context, no clipboard-write support) — a copy button that
      // silently does nothing on failure is worse than no button.
      console.error('Newsletter clipboard copy failed:', err);
      setCopyState('error');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([preview.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `newsletter_${preview.generatedAt.toISOString().slice(0, 10)}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setHasExported(true);
  };

  const handlePrint = () => {
    const frame = document.getElementById('newsletter-preview-frame');
    if (frame?.contentWindow) {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }
  };

  const handleMarkSent = async () => {
    setMarking(true);
    // The batch id is the GENERATION timestamp, not the moment of this
    // click — see the file header comment and docs/db_contract.md.
    const batchId = preview.generatedAt.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    const sentAtIso = new Date().toISOString();
    const results = await Promise.all(
      preview.articleIds.map((id) =>
        onUpdate(id, { newsletter_batch_id: batchId, published_to_newsletter_at: sentAtIso })
      )
    );
    setMarking(false);
    const okCount = results.filter(Boolean).length;
    setMarkResult({ ok: okCount, total: results.length });
    if (okCount === results.length) {
      setPreview(null);
      setHasExported(false);
    }
    // A partial failure leaves `preview` in place (with its original
    // articleIds) so retrying "סמן כנשלח" simply re-attempts every article,
    // including ones that already succeeded — onUpdate's write is
    // idempotent (same batchId, same near-identical timestamp), so this is
    // safe to repeat.
  };

  return (
    <div style={builderCardStyle}>
      <div style={topRowStyle}>
        <button style={generateBtnStyle} disabled={!canGenerate} onClick={handleGenerate}>
          צור ניוזלטר
        </button>
        {!canGenerate && (
          <span style={disabledNoteStyle}>
            {eligibleArticles.length === 0
              ? 'אין כתבות שממתינות לשליחה בניוזלטר.'
              : `${missingTextCount} מתוך ${eligibleArticles.length} כתבות עדיין ללא טקסט לפרסום — יש להמתין להרצה הבאה או לבדוק אותן בהמשך הרשימה.`}
          </span>
        )}
      </div>

      {preview && (
        <div style={previewWrapStyle}>
          <iframe
            id="newsletter-preview-frame"
            title="תצוגה מקדימה של הניוזלטר"
            srcDoc={preview.html}
            style={previewFrameStyle}
          />

          <div style={actionsRowStyle}>
            <button style={secondaryBtnStyle} onClick={handleCopy}>העתקה</button>
            <button style={secondaryBtnStyle} onClick={handleDownload}>הורדה</button>
            <button style={secondaryBtnStyle} onClick={handlePrint}>הדפסה / שמירה כ-PDF</button>
            <button
              style={{ ...markSentBtnStyle, ...(hasExported ? markSentProminentStyle : {}) }}
              disabled={marking}
              onClick={handleMarkSent}
            >
              {marking ? 'מסמנת...' : 'סמן כנשלח'}
            </button>
          </div>

          {copyState === 'ok' && (
            <p style={successNoteStyle}>הועתק בהצלחה, כולל עיצוב — ניתן להדביק בג׳ימייל או באאוטלוק.</p>
          )}
          {copyState === 'error' && (
            <p style={errorNoteStyle}>ההעתקה נכשלה — הדפדפן חסם את הגישה ללוח ההעתקה. אפשר להשתמש בהורדה במקום.</p>
          )}
          {markResult && markResult.ok === markResult.total && (
            <p style={successNoteStyle}>סומן כנשלח בהצלחה.</p>
          )}
          {markResult && markResult.ok < markResult.total && (
            <p style={errorNoteStyle}>{`סומנו ${markResult.ok} מתוך ${markResult.total} בלבד — אפשר ללחוץ שוב על "סמן כנשלח" עבור השאר.`}</p>
          )}
        </div>
      )}
    </div>
  );
}

const builderCardStyle = {
  boxSizing: 'border-box',
  width: '100%',
  background: 'var(--bg-secondary, #f7f5f2)',
  border: '1px solid var(--border, #e0e0e0)',
  borderRadius: '8px',
  padding: '18px 20px',
  marginBottom: '20px',
};

const topRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  flexWrap: 'wrap',
};

const generateBtnStyle = {
  padding: '8px 22px',
  borderRadius: '6px',
  border: '1px solid var(--accent)',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 700,
  background: 'var(--accent)',
  color: '#fff',
};

const disabledNoteStyle = {
  fontSize: '0.85rem',
  color: 'var(--text)',
  opacity: 0.75,
};

const previewWrapStyle = {
  marginTop: '18px',
};

const previewFrameStyle = {
  width: '100%',
  height: '520px',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  background: '#fff',
};

const actionsRowStyle = {
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
  background: 'var(--bg)',
  color: 'var(--text-h)',
};

// "סמן כנשלח" starts visually secondary (grey outline, like the other
// actions) and turns prominent (filled, coral) once a copy or download has
// happened — so forgetting to click it is unlikely, without making it the
// most tempting button before anything has actually been exported.
const markSentBtnStyle = {
  padding: '6px 16px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
  background: 'var(--bg)',
  color: 'var(--text)',
  marginInlineStart: 'auto',
};

const markSentProminentStyle = {
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#fff',
};

const successNoteStyle = {
  marginTop: '10px',
  fontSize: '0.85rem',
  color: 'var(--secondary, #4abfb0)',
  fontWeight: 600,
};

const errorNoteStyle = {
  marginTop: '10px',
  fontSize: '0.85rem',
  color: '#ef4444',
  fontWeight: 600,
};
