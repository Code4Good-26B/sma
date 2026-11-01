// src/lib/newsletterTemplateFields.js
//
// Field metadata for the newsletter-template editing screen
// (SettingsPage.jsx): which keys are editable, what to call each one in
// Hebrew, which get a textarea, and which are destinations (URLs) rather
// than prose.
//
// Kept separate from SettingsPage.jsx the same way newsletterTheme.js is
// kept separate from buildNewsletterHtml.js: this is data about the
// fields, not the screen that renders them.
//
// The field LIST — which keys exist at all — comes from
// EDITABLE_STRING_KEYS/DONATION_URL_KEY in buildNewsletterHtml.js, the
// exact same source of truth the merge itself uses, not a second list kept
// in sync by hand. Only the grouping, order, label, and
// textarea-vs-single-line choice below are specific to this screen, and
// GROUPS is allowed to be incomplete — see buildFieldGroups, which adds
// anything GROUPS forgets into a fallback group rather than ever silently
// dropping a field.
import { EDITABLE_STRING_KEYS, DONATION_URL_KEY } from './buildNewsletterHtml';
import { STRINGS, DONATION_URL } from './newsletterTheme';

// Flat defaults for every editable key, STRINGS and DONATION_URL combined
// into the same shape as an overrides object, so "is this field at its
// default" is one lookup regardless of which source the default came from.
export const DEFAULT_TEMPLATE_VALUES = { ...STRINGS, [DONATION_URL_KEY]: DONATION_URL };

const LABELS = {
  title_a: 'כותרת – מילה ראשונה',
  title_b: 'כותרת – מילה שנייה',
  tagline: 'סלוגן',
  opener: 'טקסט הפתיחה',
  kicker: 'כיתוב קטן מעל אזור הכתבות',
  section_heading: 'כותרת אזור הכתבות',
  read_more: 'טקסט "להמשך קריאה"',
  disclaimer: 'הבהרה משפטית',
  donation_heading: 'כותרת באנר התרומה',
  donation_button: 'טקסט כפתור התרומה',
  [DONATION_URL_KEY]: 'קישור לעמוד התרומה',
  phone_prefix: 'תחילית מספר טלפון',
  contact_phone: 'מספר טלפון',
  contact_email: 'אימייל ליצירת קשר',
  site_label: 'טקסט קישור לאתר',
  site_url: 'קישור לאתר',
  facebook_label: 'טקסט קישור לפייסבוק',
  copyright_tail: 'טקסט זכויות (אחרי השנה)',
  logo_alt: 'טקסט חלופי ללוגו (alt, לא התמונה עצמה)',
};

// Long-form fields get a textarea; everything else a single-line input.
const LONG_TEXT_KEYS = new Set(['opener', 'disclaimer', 'donation_heading', 'section_heading']);

// Destinations, not prose — get the inline "looks like a URL?" warning
// (see SettingsPage.jsx) rather than a hard validator.
const URL_KEYS = new Set([DONATION_URL_KEY, 'site_url']);

// Latin-alphabet values that read better left-to-right even inside this
// RTL screen, regardless of whether they're also a URL.
const LTR_KEYS = new Set([DONATION_URL_KEY, 'site_url', 'contact_email', 'contact_phone']);

// Order and grouping to match the newsletter itself, top to bottom, so
// Michal can find a field by where she sees it rendered. Deliberately
// allowed to be incomplete: see buildFieldGroups below.
const GROUPS = [
  { heading: 'כותרת עליונה', keys: ['title_a', 'title_b', 'tagline'] },
  { heading: 'באנר פתיחה', keys: ['opener'] },
  { heading: 'אזור הכתבות', keys: ['kicker', 'section_heading', 'read_more', 'disclaimer'] },
  { heading: 'באנר תרומה', keys: ['donation_heading', 'donation_button', DONATION_URL_KEY] },
  {
    heading: 'תחתית',
    keys: [
      'phone_prefix', 'contact_phone', 'contact_email',
      'site_label', 'site_url', 'facebook_label', 'copyright_tail', 'logo_alt',
    ],
  },
];

function buildField(key) {
  return {
    key,
    label: LABELS[key] ?? key,
    multiline: LONG_TEXT_KEYS.has(key),
    isUrl: URL_KEYS.has(key),
    isLtr: LTR_KEYS.has(key),
    default: DEFAULT_TEMPLATE_VALUES[key] ?? '',
  };
}

// Builds the grouped field list for the form. Any key in
// EDITABLE_STRING_KEYS/DONATION_URL_KEY that GROUPS above doesn't mention
// — e.g. a string added to STRINGS after this file was last updated —
// still appears, in a fallback group at the end, rather than becoming
// invisible just because nobody updated this screen's layout.
export function buildFieldGroups() {
  const allKeys = [...EDITABLE_STRING_KEYS, DONATION_URL_KEY];
  const grouped = new Set(GROUPS.flatMap((g) => g.keys));
  const groups = GROUPS.map((g) => ({ heading: g.heading, fields: g.keys.map(buildField) }));

  const leftover = allKeys.filter((key) => !grouped.has(key));
  if (leftover.length > 0) {
    groups.push({ heading: 'שדות נוספים', fields: leftover.map(buildField) });
  }

  return groups;
}
