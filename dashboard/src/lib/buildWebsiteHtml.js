// src/lib/buildWebsiteHtml.js
//
// The content-area HTML for a WordPress post — the deliberate inverse of
// buildNewsletterHtml.js. A newsletter must inline every style because email
// clients strip <style> blocks and stylesheets, so buildNewsletterHtml.js
// inlines everything. A WordPress post is styled by the site's own theme
// instead; inline styles here would fight that theme and produce a post
// that looks foreign on the association's own site. So this file carries NO
// inline styles, NO <style> block, and no class attributes — just plain
// semantic markup (<p> tags) for the theme to style.
//
// Pure for the same reason buildNewsletterHtml.js is: testable without a
// browser and without writing anything to the database.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The exact same blank-line splitting buildNewsletterHtml.js uses — the
// paragraph bug (blank-line-separated paragraphs collapsing into one
// unbroken wall of text once dumped into a single element) applies here
// identically, since this is the same newsletter_text_he column serving
// both channels (docs/db_contract.md, Pass 2).
function splitParagraphs(text) {
  return String(text ?? '')
    .split(/\r?\n\s*\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const SOURCE_LINK_LABEL = 'למקור המלא';

/**
 * `article.title` is accepted only for interface parity with the shape
 * buildNewsletterHtml/buildNewsletterPlainText take — it is deliberately NOT
 * rendered here. The title goes into WordPress's own title field through a
 * separate "העתק כותרת" copy button, never into the content area, so there
 * is nothing here for it to duplicate.
 *
 * @param {{ title?: string, url: string, text: string }} article
 * @returns {string} content-area HTML: no inline styles, no <style> block
 */
export function buildWebsiteHtml(article) {
  const paragraphsHtml = splitParagraphs(article?.text)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
  const url = escapeHtml(article?.url);
  return `${paragraphsHtml}\n<p><a href="${url}">${SOURCE_LINK_LABEL}</a></p>`;
}

// text/plain alternative for the clipboard's text/plain slot (Part A1), for
// an editor that will not accept HTML.
export function buildWebsitePlainText(article) {
  const paragraphs = splitParagraphs(article?.text);
  const url = article?.url ?? '';
  return [...paragraphs, `${SOURCE_LINK_LABEL}: ${url}`].join('\n\n');
}
