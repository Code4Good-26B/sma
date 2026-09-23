// src/lib/buildNewsletterHtml.js
//
// JavaScript port of sma-publisher/src/templates/newsletter.html.j2 (theme
// and strings from sma-publisher/src/publisher.py, now in
// ./newsletterTheme.js). The Python renderer is a one-off CLI; the
// dashboard is a static React app on Vercel with no backend, so the SAME
// markup, palette and wording are reproduced here instead of reused at
// runtime. Do not redesign anything in this file — colours, spacing,
// section order and wording all carry over exactly from the approved spec
// (sma-publisher/docs/newsletter-design-spec.md). This is a Hebrew-only
// port: the association does not want an English version, so the
// rtl/ltr branching newsletter.html.j2 does per-language collapses to
// fixed RTL values here.
//
// Pure for the same reason computeCollectorHealth.js is pure: it is the
// only way to test the rendered HTML without a browser and without writing
// anything to the database. No React, no Supabase, no `new Date()` inside —
// issueDate is a parameter, computed once by the caller
// (formatIssueDateHe in ./newsletterTheme.js).
import { THEME, STRINGS, LOGO_URL, DONATION_URL } from './newsletterTheme.js';

const t = THEME;
const s = STRINGS;
const START = 'right'; // s.dir === 'rtl' always in this Hebrew-only port
const END = 'left';

// The Jinja template rendered with autoescaping on (`select_autoescape` in
// publisher.py); nothing here does that automatically, so every piece of
// text that originates from an article — title, url, publication text —
// is escaped by hand before being interpolated into the HTML string. A
// title containing `<script>` or `&` must render as visible text, not as
// markup or a broken attribute.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The publication texts on the /publish screen contain multiple paragraphs
// separated by blank lines, and the review <textarea> preserves them — but
// newsletter.html.j2 interpolated the whole text into a single <div>, and
// HTML collapses newlines into spaces. Reviewed side-by-side that is
// invisible: the reviewer's textarea still shows tidy paragraphs while the
// actual newsletter markup would have rendered one unbroken wall of text.
// Splitting on blank lines and rendering one element per paragraph fixes
// that. A lone newline inside a paragraph is left as-is on purpose: browsers
// already collapse a single newline to a space by default, so it does not
// need special handling to avoid creating a break.
function splitParagraphs(text) {
  return String(text ?? '')
    .split(/\r?\n\s*\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function renderParagraphs(text) {
  return splitParagraphs(text)
    .map((p, i) => {
      const marginTop = i === 0 ? '10px' : '12px';
      return `<div style="margin-top:${marginTop}; font-family:${t.font}; font-size:15px; line-height:1.6; color:${t.slate}; text-align:${START};">${escapeHtml(p)}</div>`;
    })
    .join('');
}

function renderArticleCard(article) {
  const title = escapeHtml(article.title);
  const url = escapeHtml(article.url);
  const bodyHtml = article.text ? renderParagraphs(article.text) : '';
  return `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${s.dir}" style="background:${t.white}; border:1px solid ${t.line}; border-radius:14px; margin-bottom:18px;">
              <tr>
                <td style="padding:22px 24px;">
                  <div style="font-family:${t.font}; font-size:20px; font-weight:800; line-height:1.2; color:${t.ink}; text-align:${START};">${title}</div>
${bodyHtml}
                  <div style="margin-top:14px; text-align:${START};"><a href="${url}" style="font-family:${t.font}; font-size:15px; font-weight:700; color:${t.coral_ink}; text-decoration:none;">${s.read_more}</a></div>
                </td>
              </tr>
            </table>
`;
}

/**
 * @param {Array<{ title: string, url: string, text: string }>} articles
 * @param {string} issueDate - e.g. "ספטמבר 2026" (see formatIssueDateHe in ./newsletterTheme)
 * @returns {string} the complete newsletter HTML document
 */
export function buildNewsletterHtml(articles, issueDate) {
  const list = Array.isArray(articles) ? articles : [];
  const cardsHtml = list.map(renderArticleCard).join('');

  return `<!DOCTYPE html>
<html lang="${s.lang_attr}" dir="${s.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s.title_a} ${s.title_b} · SMA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&family=Rubik:wght@400;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body dir="${s.dir}" style="margin:0; padding:0; background:${t.page};">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${s.dir}" style="background:${t.page}; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:0;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${s.dir}" style="width:100%; max-width:100%; background:${t.white}; overflow:hidden; font-family:${t.font};">

        <tr>
          <td style="padding:30px 36px 24px 36px; border-bottom:1px solid ${t.line};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="ltr" style="direction:ltr; width:100%;">
              <tr>
                <td width="55%" valign="middle" style="text-align:left;">
                  <img src="${LOGO_URL}" alt="${s.logo_alt}" height="52" style="height:52px; width:auto; display:inline-block;">
                </td>
                <td width="45%" valign="middle" style="text-align:right; font-family:${t.font}; font-size:13px; color:${t.slate}; line-height:1.5;">${escapeHtml(issueDate)}</td>
              </tr>
            </table>
            <div style="margin-top:24px; font-family:${t.font}; font-weight:900; font-size:46px; line-height:1.0; color:${t.ink}; text-align:${START};">${s.title_a} <span style="color:${t.coral_ink};">${s.title_b}</span></div>
            <div style="margin-top:10px; font-family:${t.font}; font-size:15px; font-weight:600; color:${t.teal_deep}; text-align:${START};">${s.tagline}</div>
          </td>
        </tr>

        <tr>
          <td align="center" style="background:${t.coral_soft}; padding:30px 44px;">
            <div style="max-width:460px; margin:0 auto; font-family:${t.font}; font-size:20px; font-weight:600; line-height:1.45; color:${t.ink};">${s.opener}</div>
          </td>
        </tr>

        <tr>
          <td style="background:${t.cloud}; padding:40px 36px;">
            <div style="font-family:${t.font}; font-size:13px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:${t.teal_deep}; text-align:${START};">${s.kicker}</div>
            <div style="margin-top:8px; margin-bottom:24px; font-family:${t.font}; font-size:28px; font-weight:800; line-height:1.15; color:${t.ink}; text-align:${START};">${s.section_heading}</div>
${cardsHtml}            <div style="margin-top:18px; font-family:${t.font}; font-size:13px; line-height:1.5; color:${t.mute}; text-align:${START};">${s.disclaimer}</div>
          </td>
        </tr>

        <tr>
          <td align="center" bgcolor="${t.coral}" style="background:${t.coral}; padding:34px 44px;">
            <div style="max-width:380px; margin:0 auto 22px auto; font-family:${t.font}; font-size:25px; font-weight:800; line-height:1.25; color:${t.white};">${s.donation_heading}</div>
            <a href="${DONATION_URL}" style="display:inline-block; background:${t.white}; color:${t.coral_deep}; font-family:${t.font}; font-size:17px; font-weight:700; text-decoration:none; padding:14px 30px; border-radius:999px;">${s.donation_button}</a>
          </td>
        </tr>

        <tr>
          <td bgcolor="${t.teal_deep}" style="background:${t.teal_deep}; padding:36px 36px 30px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="direction:ltr; width:100%;">
              <tr>
                <td width="50%" valign="top" style="direction:${s.dir}; text-align:${END}; font-family:${t.font}; font-size:15px; line-height:1.9; color:${t.white};">
                  ${s.phone_prefix}<a href="tel:${s.contact_phone.replace(/-/g, '')}" style="color:${t.white}; text-decoration:none;">${s.contact_phone}</a><br>
                  <a href="mailto:${s.contact_email}" style="color:${t.white}; text-decoration:none;">${s.contact_email}</a><br>
                  <a href="${s.site_url}" style="color:${t.white}; text-decoration:none;">${s.site_label}</a><br>
                  ${s.facebook_label}
                </td>
                <td width="50%" valign="top" style="direction:${s.dir}; text-align:${START};">
                  <img src="${LOGO_URL}" alt="${s.logo_alt}" height="44" style="height:44px; width:auto; display:inline-block;">
                  <div style="margin-top:14px; font-family:${t.font}; font-size:20px; font-weight:700; line-height:1.3; color:${t.white};">${s.footer_slogan}</div>
                </td>
              </tr>
            </table>

            <div style="margin-top:22px; padding-top:18px; border-top:1px solid rgba(255,255,255,0.22); font-family:${t.font}; font-size:13px; line-height:1.7; color:rgba(255,255,255,0.66); text-align:${START};">${s.copyright}</div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}

// A plain-text alternative for the clipboard's text/plain slot (Part C3) —
// pasting the text/html slot keeps formatting in Gmail/Outlook, but clients
// that only accept plain text still get something readable instead of raw
// markup.
export function buildNewsletterPlainText(articles, issueDate) {
  const list = Array.isArray(articles) ? articles : [];
  const lines = [`${s.title_a} ${s.title_b} · ${issueDate}`, '', s.opener, '', s.section_heading, ''];
  for (const a of list) {
    lines.push(a.title, '');
    if (a.text) lines.push(a.text.trim(), '');
    lines.push(`${s.read_more} ${a.url}`, '', '---', '');
  }
  lines.push(s.disclaimer, '', s.donation_heading, `${s.donation_button} ${DONATION_URL}`, '', s.copyright);
  return lines.join('\n');
}
