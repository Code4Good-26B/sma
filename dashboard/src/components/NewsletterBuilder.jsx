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
import {
  buildNewsletterHtml,
  buildNewsletterPlainText,
  resolveBooleanOverride,
  BOOLEAN_OVERRIDE_DEFAULTS,
} from '../lib/buildNewsletterHtml';
import { formatIssueDateHe } from '../lib/newsletterTheme';
import { selectNewsletterBatch } from '../lib/selectNewsletterBatch';

export default function NewsletterBuilder({
  eligibleArticles,
  onUpdate,
  templateOverrides = {},
  onUpdateNewsletterTemplate,
}) {
  const [preview, setPreview] = useState(null); // { html, plainText, articleIds, generatedAt }
  const [copyState, setCopyState] = useState(null); // 'ok' | 'error' | null
  const [hasExported, setHasExported] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markResult, setMarkResult] = useState(null); // { ok, total } | null
  // Keyed by article id, this session only — deliberately NOT persisted
  // (no database column). An article that's been sent in a newsletter can
  // never be sent in another one (the newsletter_batch_id guard), so by
  // construction an image chosen for this issue has no second use once
  // it's sent. Lost on reload — intentional, not a gap to fix.
  const [imageUrls, setImageUrls] = useState({});
  // Keyed by article id too: true once that article's thumbnail <img>
  // failed to load. Separate from imageUrls so clearing it (on the next
  // edit to that article's field, see handleImageUrlChange) doesn't need
  // to touch the URL itself.
  const [imageLoadErrors, setImageLoadErrors] = useState({});

  const handleImageUrlChange = (articleId, value) => {
    setImageUrls((prev) => ({ ...prev, [articleId]: value }));
    // Clears on every edit, not just a successful one: Michal typing a fix
    // should make the error message go away immediately, before the new
    // URL has even had a chance to load or fail on its own.
    setImageLoadErrors((prev) => {
      if (!prev[articleId]) return prev;
      const next = { ...prev };
      delete next[articleId];
      return next;
    });
  };

  const {
    included: articlesWithText,
    excluded: articlesMissingText,
    canGenerate,
    generateLabel,
  } = selectNewsletterBatch(eligibleArticles);

  // Derived fresh from templateOverrides on every render rather than kept
  // as separate component state: clicking a toggle below calls
  // onUpdateNewsletterTemplate directly, which updates the SAME overrides
  // row these are read from, so there's nothing for a second copy of this
  // state to get out of sync with.
  const showOpenerButton = resolveBooleanOverride(templateOverrides, 'show_opener_button');
  const showDonationButton = resolveBooleanOverride(templateOverrides, 'show_donation_button');

  // Writes the literal value only when it differs from the hard-coded
  // default, and deletes the override (via `undefined`) when it's flipped
  // back to the default — same "stay empty until something genuinely
  // changes" discipline as SettingsPage.jsx's computeChanges, just applied
  // to one key immediately instead of batched behind a save button.
  const toggleBooleanOverride = async (key, nextChecked) => {
    const changes = { [key]: nextChecked === BOOLEAN_OVERRIDE_DEFAULTS[key] ? undefined : nextChecked };
    await onUpdateNewsletterTemplate(changes);
    // The failure toast already fires from App.jsx on error.
  };

  const handleGenerate = () => {
    const generatedAt = new Date();
    // articlesWithText, not eligibleArticles: this is the one and only
    // place the sent batch is built, from the one and only filtered list —
    // see the comment on articlesWithText above.
    const mapped = articlesWithText.map((a) => ({
      title: a.reviewed_title_he ?? a.title_he ?? '',
      url: a.source_url,
      text: a.newsletter_text_he ?? '',
      imageUrl: imageUrls[a.id] || '',
    }));
    const issueDate = formatIssueDateHe(generatedAt);
    // The copyright line's year comes from this same generatedAt, not a
    // fresh new Date() inside the builder — see buildNewsletterHtml.js.
    const issueYear = generatedAt.getFullYear();
    setPreview({
      html: buildNewsletterHtml(mapped, issueDate, issueYear, templateOverrides),
      plainText: buildNewsletterPlainText(mapped, issueDate, issueYear, templateOverrides),
      articleIds: articlesWithText.map((a) => a.id),
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
      {/* Toggles, not a field on SettingsPage: this is a per-build choice
          Michal makes each time she generates an issue, not standing
          template text — but whatever she leaves it on becomes the
          remembered default for next time (the hint below says so), since
          both save straight into the same overrides row. */}
      <div style={buttonTogglesRowStyle}>
        <label style={toggleLabelStyle}>
          <input
            type="checkbox"
            checked={showOpenerButton}
            onChange={(e) => toggleBooleanOverride('show_opener_button', e.target.checked)}
          />
          כפתור בבאנר הפתיחה
        </label>
        <label style={toggleLabelStyle}>
          <input
            type="checkbox"
            checked={showDonationButton}
            onChange={(e) => toggleBooleanOverride('show_donation_button', e.target.checked)}
          />
          כפתור תרומה בבאנר התרומה
        </label>
        <span style={toggleHintStyle}>הבחירה נשמרת כברירת מחדל לניוזלטרים הבאים, לא רק לזה</span>
      </div>

      <div style={topRowStyle}>
        <button style={generateBtnStyle} disabled={!canGenerate} onClick={handleGenerate}>
          {generateLabel}
        </button>
        {!canGenerate && (
          <span style={disabledNoteStyle}>
            {eligibleArticles.length === 0
              ? 'אין כתבות שממתינות לשליחה בניוזלטר.'
              : 'אף אחת מהכתבות הממתינות עדיין לא קיבלה טקסט לפרסום — יש להמתין להרצה הבאה.'}
          </span>
        )}
      </div>

      {/* Named by title, not just counted — a number alone doesn't let
          Michal tell WHICH article is missing and decide whether it's worth
          waiting for. Shown whenever any article is left out, whether or
          not that leaves generation possible at all. */}
      {articlesMissingText.length > 0 && (
        <div style={missingListStyle}>
          <p style={missingListHeadingStyle}>
            {canGenerate
              ? 'הכתבות הבאות עדיין ללא טקסט לפרסום ולא ייכללו בניוזלטר הזה (יוצעו שוב בהרצה הבאה):'
              : 'הכתבות הבאות עדיין ללא טקסט לפרסום:'}
          </p>
          <ul style={missingListUlStyle}>
            {articlesMissingText.map((a) => (
              <li key={a.id}>{a.reviewed_title_he ?? a.title_he ?? '(ללא כותרת)'}</li>
            ))}
          </ul>
        </div>
      )}

      {/* One image per article, chosen here and here only — see
          imageUrls's own comment above for why nothing of this is saved. */}
      {articlesWithText.length > 0 && (
        <div style={articleImagesSectionStyle}>
          <p style={articleImagesHeadingStyle}>
            תמונה לכתבה (אופציונלי, לניוזלטר הזה בלבד — לא נשמר להרצה הבאה):
          </p>
          <p style={articleImagesHintStyle}>
            איך מוצאים כתובת לתמונה: לוחצים קליק ימני על התמונה המבוקשת באתר
            האינטרנט, ובוחרים "העתק כתובת תמונה" (Copy image address),
            ומדביקים אותה בשדה שמתחת לכתבה המתאימה.
          </p>
          {articlesWithText.map((a) => (
            <div key={a.id} style={articleImageRowStyle}>
              <span style={articleImageTitleStyle}>
                {a.reviewed_title_he ?? a.title_he ?? '(ללא כותרת)'}
              </span>
              <input
                style={articleImageInputStyle}
                type="text"
                dir="ltr"
                placeholder="כתובת URL של תמונה (אופציונלי)"
                value={imageUrls[a.id] ?? ''}
                onChange={(e) => handleImageUrlChange(a.id, e.target.value)}
              />
              {imageUrls[a.id] && !imageLoadErrors[a.id] && (
                <img
                  src={imageUrls[a.id]}
                  alt=""
                  style={articleImageThumbStyle}
                  // A mail client generally sends no Referer header; a
                  // browser <img> otherwise sends one naming this
                  // dashboard's own origin, and many news sites block
                  // hotlinking on exactly that header. Without this, the
                  // thumbnail can report "did not load" for an image the
                  // actual newsletter email would display fine — this
                  // makes the preview's verdict match what the real
                  // request will look like.
                  referrerPolicy="no-referrer"
                  onError={() => setImageLoadErrors((prev) => ({ ...prev, [a.id]: true }))}
                />
              )}
              {imageUrls[a.id] && imageLoadErrors[a.id] && (
                // Replaces the thumbnail entirely rather than showing the
                // browser's own broken-image glyph alongside it — that
                // glyph reads to a non-technical user as "the system is
                // broken", not "this link is wrong".
                <span style={articleImageErrorStyle}>
                  התמונה לא נטענה — נראה שהכתובת שגויה (לא בעיה בניוזלטר עצמו)
                </span>
              )}
            </div>
          ))}
        </div>
      )}

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

const buttonTogglesRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '18px',
  flexWrap: 'wrap',
  marginBottom: '14px',
  paddingBottom: '14px',
  borderBottom: '1px solid var(--border, #e0e0e0)',
};

const toggleLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '0.85rem',
  color: 'var(--text-h)',
  cursor: 'pointer',
};

const toggleHintStyle = {
  fontSize: '0.78rem',
  color: 'var(--text)',
  opacity: 0.75,
};

const articleImagesSectionStyle = {
  marginTop: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const articleImagesHeadingStyle = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--text)',
};

const articleImagesHintStyle = {
  margin: '-4px 0 4px 0',
  fontSize: '0.78rem',
  color: 'var(--text)',
  opacity: 0.75,
  lineHeight: 1.5,
};

const articleImageRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
};

const articleImageTitleStyle = {
  flex: '1 1 220px',
  fontSize: '0.85rem',
  color: 'var(--text-h)',
};

const articleImageInputStyle = {
  flex: '1 1 260px',
  boxSizing: 'border-box',
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '0.85rem',
  background: 'var(--bg)',
  color: 'var(--text-h)',
};

const articleImageThumbStyle = {
  width: '44px',
  height: '44px',
  objectFit: 'cover',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  flexShrink: 0,
};

const articleImageErrorStyle = {
  fontSize: '0.78rem',
  color: '#b45309',
  flex: '1 1 160px',
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

const missingListStyle = {
  marginTop: '12px',
  padding: '10px 14px',
  borderRadius: '6px',
  background: 'rgba(245, 158, 11, 0.10)',
  border: '1px solid rgba(245, 158, 11, 0.3)',
};

const missingListHeadingStyle = {
  margin: 0,
  fontSize: '0.85rem',
  color: '#b45309',
  fontWeight: 600,
};

const missingListUlStyle = {
  margin: '6px 0 0 0',
  paddingInlineStart: '20px',
  fontSize: '0.85rem',
  color: '#b45309',
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
