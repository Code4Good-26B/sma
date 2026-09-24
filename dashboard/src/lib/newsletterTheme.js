// src/lib/newsletterTheme.js
//
// Ported verbatim from sma-publisher/src/publisher.py: THEME, STRINGS['he'],
// LOGO_URL, DONATION_URL. Only the Hebrew strings are ported — the
// association does not send newsletters today and does not want an English
// version, so STRINGS['en'] and send_brevo.py stay in sma-publisher/ as
// reference only (see sma-publisher/README.md).
//
// Kept as data, separate from buildNewsletterHtml.js's markup, exactly as
// publisher.py kept THEME/STRINGS separate from newsletter.html.j2. Do not
// reword or re-tune any of this — it is the association's own approved
// copy and palette (sma-publisher/docs/newsletter-design-spec.md).

export const THEME = {
  coral: '#F28080',       // brand fill / donation band
  coral_ink: '#ED686B',   // accent text / links
  coral_deep: '#D9534F',  // button text on white
  coral_soft: '#FBE2E2',  // opener band wash
  teal: '#68B4B4',        // wordmark accent
  teal_deep: '#3F8C8C',   // footer band
  ink: '#2D2D32',         // headings
  ink_soft: '#4A4A52',    // body
  slate: '#6B6B73',       // meta / summaries
  mute: '#9A9AA2',        // disclaimer
  cloud: '#F4F5F5',       // publications band background
  page: '#FFFFFF',        // white backdrop
  white: '#FFFFFF',
  line: '#E4E4E7',        // hairline borders
  // Web fonts (Google Fonts link in <head>) with Hebrew-capable system fallback.
  font: "'Rubik','Heebo',Arial,Helvetica,sans-serif",
};

export const STRINGS = {
  dir: 'rtl',
  lang_attr: 'he',
  title_a: 'עלון',
  title_b: 'הקהילה',
  tagline: 'ידע הוא כוח, הבנה היא תקווה',
  kicker: 'מהמחקר העולמי',
  section_heading: 'פרסומים אחרונים בתחום ה‑SMA',
  opener: (
    'המחקר על SMA מתקדם בקצב שלא הכרנו - וכל פריצת דרך מתורגמת אצלנו לשאלה ' + // deliberately a plain hyphen here, not publisher.py's em dash (that's the only reader-facing character changed anywhere in this file) — an em dash reads as machine-written to Hebrew readers, and this text goes to families; the fidelity check handles this one exception explicitly rather than loosening its word-for-word comparison
    'אחת: מה זה אומר עבור הילדים והמבוגרים שלנו, כאן ועכשיו.'
  ),
  read_more: 'להמשך קריאה ›',
  disclaimer: (
    'המידע מובא לידע כללי ולהנגשת המחקר העדכני, ואינו מהווה ייעוץ או המלצה ' +
    'רפואית. לכל החלטה טיפולית התייעצו עם הצוות הרפואי המטפל.'
  ),
  donation_heading: 'כל תרומה מתורגמת למעטפת טיפול ולקהילה תומכת.',
  donation_button: 'לתרומה לעמותה ›',
  footer_slogan: 'קהילה אחת, חלומות משותפים',
  phone_prefix: 'טל׳ ',
  contact_phone: '052-4581058',
  contact_email: 'sma.org.il@gmail.com',
  site_label: 'www.sma.org.il',
  site_url: 'https://www.sma.org.il',
  facebook_label: 'פייסבוק · קהילת SMA ישראל',
  copyright: '© 2026 עמותת SMA ישראל · עלון הקהילה',
  logo_alt: 'עמותת SMA ישראל',
};

// Public URL for the masthead/footer logo. Must stay a hosted URL, never a
// data: URI — Gmail and most clients block embedded base64 images (see
// sma-publisher/README.md, "Two things that are easy to get wrong").
export const LOGO_URL = 'https://www.sma.org.il/wp-content/uploads/2024/05/Group-152.png';

// Donation page on the association's WordPress site.
export const DONATION_URL = 'https://www.sma.org.il/product/donation/';

// Gregorian month names in Hebrew, for the masthead issue date (e.g.
// "ספטמבר 2026") — ported from HE_GREG_MONTHS in publisher.py. Index 0 is
// unused so month numbers (1-12) index directly.
const HE_GREG_MONTHS = [
  '', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// Takes a Date so buildNewsletterHtml.js never calls new Date() internally —
// the caller (NewsletterBuilder) computes issueDate once, at generation
// time, and passes it in.
export function formatIssueDateHe(date) {
  return `${HE_GREG_MONTHS[date.getMonth() + 1]} ${date.getFullYear()}`;
}
