// src/pages/SettingsPage.jsx
import { useState } from 'react';
import { buildNewsletterHtml } from '../lib/buildNewsletterHtml';
import { formatIssueDateHe } from '../lib/newsletterTheme';
import { buildFieldGroups, DEFAULT_TEMPLATE_VALUES } from '../lib/newsletterTemplateFields';

const FIELD_GROUPS = buildFieldGroups();
const ALL_FIELD_KEYS = FIELD_GROUPS.flatMap((group) => group.fields.map((f) => f.key));

const URL_PATTERN = /^https?:\/\//i;

// Two fictional, obviously-sample articles for the live preview — never
// real data. Without this, editing `kicker` or `read_more` is blind: there
// is no way to see what the word even labels. The preview is what makes
// this screen usable, not a nicety.
const SAMPLE_ARTICLES = [
  {
    title: '[כתבה לדוגמה] מחקר חדש בתחום ה-SMA',
    url: 'https://example.org/sample-1',
    text: (
      'זהו טקסט דוגמה בלבד, שנועד להראות כיצד כתבה תיראה בניוזלטר האמיתי.\n\n' +
      'פסקה שנייה לדוגמה, כדי להמחיש גם איך נראית כתבה עם כמה פסקאות.'
    ),
  },
  {
    title: '[כתבה לדוגמה] עדכון נוסף מהקהילה',
    url: 'https://example.org/sample-2',
    text: 'טקסט דוגמה קצר לכתבה שנייה.',
  },
];

// A fixed date, not new Date(): the preview must look the same regardless
// of when Michal happens to open this screen.
const SAMPLE_DATE = new Date(2026, 0, 1);
const SAMPLE_ISSUE_DATE = formatIssueDateHe(SAMPLE_DATE);
const SAMPLE_YEAR = SAMPLE_DATE.getFullYear();

function buildInitialValues(overrides) {
  const safe = overrides && typeof overrides === 'object' ? overrides : {};
  const values = {};
  for (const key of ALL_FIELD_KEYS) {
    values[key] = Object.prototype.hasOwnProperty.call(safe, key)
      ? safe[key]
      : DEFAULT_TEMPLATE_VALUES[key];
  }
  return values;
}

// Diffs the form against the hard-coded defaults AND the currently-saved
// overrides, so the row written to the database holds only fields that
// genuinely differ from the default — it should stay empty until Michal
// changes something — and a field reset back to its default is sent as
// `undefined` (delete), never as the default value itself (see
// onUpdateNewsletterTemplate in App.jsx for why that distinction matters).
function computeChanges(formValues, savedOverrides) {
  const safeSaved = savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {};
  const changes = {};
  for (const key of ALL_FIELD_KEYS) {
    const isDefault = formValues[key] === DEFAULT_TEMPLATE_VALUES[key];
    const currentlyOverridden = Object.prototype.hasOwnProperty.call(safeSaved, key);
    if (isDefault) {
      if (currentlyOverridden) changes[key] = undefined;
    } else if (!currentlyOverridden || safeSaved[key] !== formValues[key]) {
      changes[key] = formValues[key];
    }
  }
  return changes;
}

export default function SettingsPage({ newsletterOverrides, onUpdateNewsletterTemplate }) {
  const [skipRejectConfirm, setSkipRejectConfirm] = useState(
    localStorage.getItem('skipRejectConfirm') === 'true'
  );
  const [formValues, setFormValues] = useState(() => buildInitialValues(newsletterOverrides));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Snapshot of newsletterOverrides taken right before handleSave calls
  // onUpdateNewsletterTemplate. App.jsx updates that state optimistically
  // (triggering the resync below, harmlessly — it matches what's already
  // in the form) and, ONLY if the write then fails, reverts it by
  // reassigning this exact same object reference back. That revert is the
  // ONLY way newsletterOverrides can become reference-equal to a value it
  // held earlier in this session — a successful write always produces a
  // brand-new merged object — so landing back on this snapshot
  // unambiguously means "our own save just failed", and is the signal to
  // skip the resync below instead of wiping out what Michal typed. A
  // plain state value, not a ref: the check below runs during render (the
  // same "adjust state during render" pattern as prevOverrides itself),
  // and React's rules disallow reading or writing a ref there.
  const [pendingRevertTarget, setPendingRevertTarget] = useState(null);

  // Re-derives the form whenever newsletterOverrides changes identity:
  // once when App.jsx's own fetch resolves after this screen has already
  // mounted (newsletterOverrides starts at {} before that), and again
  // after every successful save from this same screen. Both are exactly
  // when the form SHOULD reflect the latest saved state. The one exception
  // is the failed-save revert described above — skipped so a dropped
  // connection doesn't erase a paragraph Michal just rewrote, leaving
  // nothing to retry but pressing "שמירה" again. Adjusting state during
  // render rather than in a useEffect — React's own documented pattern for
  // resetting derived state when a prop changes — avoids the extra render
  // an effect would cause.
  const [prevOverrides, setPrevOverrides] = useState(newsletterOverrides);
  if (newsletterOverrides !== prevOverrides) {
    setPrevOverrides(newsletterOverrides);
    if (newsletterOverrides === pendingRevertTarget) {
      setPendingRevertTarget(null);
    } else {
      setFormValues(buildInitialValues(newsletterOverrides));
    }
  }

  const toggle = (checked) => {
    setSkipRejectConfirm(checked);
    if (checked) {
      localStorage.setItem('skipRejectConfirm', 'true');
    } else {
      localStorage.removeItem('skipRejectConfirm');
    }
  };

  const setField = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const resetField = (key) => {
    setFormValues((prev) => ({ ...prev, [key]: DEFAULT_TEMPLATE_VALUES[key] }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    // Set right before the write so the render-time check above can
    // recognize App.jsx's revert-on-failure as exactly that, and leave
    // formValues untouched instead of re-deriving it from the reverted
    // (pre-edit) overrides — see pendingRevertTarget's own comment.
    setPendingRevertTarget(newsletterOverrides);
    const changes = computeChanges(formValues, newsletterOverrides);
    const ok = await onUpdateNewsletterTemplate(changes);
    setSaving(false);
    // The failure toast already fires from App.jsx on error — nothing
    // else to show here on failure, only on success.
    if (ok) {
      setPendingRevertTarget(null); // no revert coming; nothing to guard against
      setSaved(true);
    }
  };

  // show_opener_button/show_donation_button are forced true HERE ONLY —
  // the real toggles live on the newsletter-builder screen (NewsletterBuilder.jsx),
  // not here, and this does not touch formValues (what actually gets
  // saved) or the real newsletter in any way. Without this, a button
  // whose saved default is off (show_opener_button) would never appear in
  // this preview no matter what Michal types into its text/URL fields —
  // she'd be editing it blind. Spread after formValues so these two always
  // win regardless of what's in the form.
  const previewOverrides = { ...formValues, show_opener_button: true, show_donation_button: true };
  const previewHtml = buildNewsletterHtml(SAMPLE_ARTICLES, SAMPLE_ISSUE_DATE, SAMPLE_YEAR, previewOverrides);

  return (
    <section>
      <h3 style={{ marginBottom: '24px' }}>הגדרות</h3>
      <div style={sectionStyle}>
        <h4 style={sectionTitleStyle}>אישורים ודיאלוגים</h4>
        <label style={rowStyle}>
          <div style={rowTextStyle}>
            <span style={rowLabelStyle}>אישור דחיית ידיעה</span>
            <span style={rowDescStyle}>הצג חלון אישור לפני דחיית ידיעה</span>
          </div>
          <div
            style={{ ...toggleTrackStyle, background: skipRejectConfirm ? 'var(--border)' : 'var(--accent)' }}
            onClick={() => toggle(!skipRejectConfirm)}
          >
            <div style={{ ...toggleThumbStyle, transform: skipRejectConfirm ? 'translateX(0)' : 'translateX(20px)' }} />
          </div>
        </label>
      </div>

      {/* Deliberately on this screen, not inside the newsletter builder on
          /publish: these are the association's standing defaults, changed
          rarely and permanently. Putting them inside the monthly send flow
          would invite editing them by accident while sending, and would
          make a one-off edit look like it might be temporary when it is
          not. */}
      <div style={{ ...sectionStyle, marginTop: '20px' }}>
        <h4 style={sectionTitleStyle}>טקסטי הניוזלטר</h4>
        <p style={templateIntroStyle}>
          עריכת הטקסטים הקבועים בניוזלטר (לא כולל הכתבות עצמן, שמגיעות מהידיעות המאושרות).
          שינוי כאן הוא קבוע ומשפיע על כל הניוזלטרים הבאים, עד שישונה מחדש.
        </p>

        <div style={templateLayoutStyle}>
          <div style={fieldsColumnStyle}>
            {FIELD_GROUPS.map((group) => (
              <div key={group.heading} style={fieldGroupStyle}>
                <h5 style={fieldGroupHeadingStyle}>{group.heading}</h5>
                {group.fields.map((field) => (
                  <TemplateField
                    key={field.key}
                    field={field}
                    value={formValues[field.key] ?? ''}
                    onChange={(value) => setField(field.key, value)}
                    onReset={() => resetField(field.key)}
                  />
                ))}
              </div>
            ))}

            <div style={saveRowStyle}>
              <button style={saveBtnStyle} disabled={saving} onClick={handleSave}>
                {saving ? 'שומרת...' : 'שמירה'}
              </button>
              {saved && <span style={savedNoteStyle}>נשמר ✓</span>}
            </div>
          </div>

          <div style={previewColumnStyle}>
            <h5 style={fieldGroupHeadingStyle}>תצוגה מקדימה (עם כתבות לדוגמה)</h5>
            <p style={previewNoteStyle}>
              לנוחות העריכה, שני הכפתורים (בפתיחה ובתרומה) מוצגים כאן תמיד כדי
              שניתן לראות את הטקסט שלהם — האם כל כפתור יוצג בניוזלטר שנשלח
              בפועל נקבע במסך בניית הניוזלטר, לא כאן.
            </p>
            <iframe
              title="תצוגה מקדימה של הניוזלטר"
              srcDoc={previewHtml}
              style={previewFrameStyle}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function TemplateField({ field, value, onChange, onReset }) {
  const isDefault = value === field.default;
  const showUrlWarning = field.isUrl && value !== '' && !URL_PATTERN.test(value);
  const dir = field.isLtr ? 'ltr' : 'rtl';

  return (
    <div style={fieldRowStyle}>
      <div style={fieldLabelRowStyle}>
        <label style={fieldLabelStyle}>{field.label}</label>
        {!isDefault && (
          <button type="button" style={resetBtnStyle} onClick={onReset}>
            ברירת מחדל
          </button>
        )}
      </div>
      {field.multiline ? (
        <textarea
          style={textareaStyle}
          value={value}
          dir={dir}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          style={inputStyle}
          value={value}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {showUrlWarning && (
        <span style={urlWarningStyle}>
          הכתובת לא נראית כקישור תקין (צריכה להתחיל ב-http:// או https://)
        </span>
      )}
    </div>
  );
}

const sectionStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const sectionTitleStyle = {
  margin: '0 0 16px 0',
  fontSize: '0.85rem',
  fontWeight: 700,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  cursor: 'pointer',
  padding: '8px 0',
};

const rowTextStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const rowLabelStyle = {
  fontSize: '0.95rem',
  color: 'var(--text-h)',
  fontWeight: 500,
};

const rowDescStyle = {
  fontSize: '0.8rem',
  color: 'var(--text)',
};

const toggleTrackStyle = {
  width: '44px',
  height: '24px',
  borderRadius: '999px',
  flexShrink: 0,
  cursor: 'pointer',
  transition: 'background 0.2s',
  position: 'relative',
};

const toggleThumbStyle = {
  position: 'absolute',
  top: '3px',
  left: '3px',
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  transition: 'transform 0.2s',
};

const templateIntroStyle = {
  margin: '0 0 16px 0',
  fontSize: '0.85rem',
  color: 'var(--text)',
  lineHeight: 1.6,
};

const templateLayoutStyle = {
  display: 'flex',
  gap: '24px',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
};

const fieldsColumnStyle = {
  flex: '1 1 380px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
};

const previewColumnStyle = {
  flex: '1 1 380px',
  minWidth: 0,
  position: 'sticky',
  top: '20px',
};

const fieldGroupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const fieldGroupHeadingStyle = {
  margin: '0 0 4px 0',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--text)',
};

const fieldRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const fieldLabelRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
};

const fieldLabelStyle = {
  fontSize: '0.85rem',
  color: 'var(--text-h)',
  fontWeight: 500,
};

const resetBtnStyle = {
  padding: '2px 10px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: '0.75rem',
  background: 'var(--bg)',
  color: 'var(--text)',
  flexShrink: 0,
};

const inputStyle = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  background: 'var(--bg)',
  color: 'var(--text-h)',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  lineHeight: 1.5,
};

const urlWarningStyle = {
  fontSize: '0.78rem',
  color: '#b45309',
};

const saveRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginTop: '4px',
};

const saveBtnStyle = {
  padding: '8px 22px',
  borderRadius: '6px',
  border: '1px solid var(--accent)',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 700,
  background: 'var(--accent)',
  color: '#fff',
};

const savedNoteStyle = {
  fontSize: '0.85rem',
  color: 'var(--secondary, #4abfb0)',
  fontWeight: 600,
};

const previewFrameStyle = {
  width: '100%',
  height: '640px',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  background: '#fff',
};

const previewNoteStyle = {
  margin: '0 0 10px 0',
  fontSize: '0.78rem',
  color: 'var(--text)',
  opacity: 0.75,
  lineHeight: 1.5,
};
