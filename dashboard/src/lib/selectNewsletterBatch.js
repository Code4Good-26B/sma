// src/lib/selectNewsletterBatch.js
//
// The single split NewsletterBuilder.jsx reads from: which articles go INTO
// the newsletter (`included`), and which are left waiting for a later run
// (`excluded`). Pure — no React, no Supabase — so it can be tested directly
// with hand-built input, the same way computeCollectorHealth.js and
// buildNewsletterHtml.js are, instead of only through the rendered
// component. (Originally lived inline in NewsletterBuilder.jsx, but a file
// that default-exports a component may not also export a plain function —
// eslint-plugin-react-refresh's only-export-components rule — so it moved
// here, which also matches where every other piece of pure logic in this
// project already lives.)
//
// NewsletterBuilder's handleGenerate builds BOTH the preview and the "סמן
// כנשלח" batch (articleIds) from this function's `included` array, and from
// nothing else — there is no second computation of "which articles are in"
// anywhere in that file. Two computations of the same thing are two chances
// for them to drift apart, and a drift here means an article gets marked
// sent in a newsletter it was never actually in: a silent, permanent loss,
// which is exactly what this project exists to prevent.

// An article's text counts as present only when it's a non-empty (trimmed)
// string.
const hasText = (a) => Boolean(a.newsletter_text_he && a.newsletter_text_he.trim());

export function selectNewsletterBatch(eligibleArticles) {
  const included = eligibleArticles.filter(hasText);
  const excluded = eligibleArticles.filter((a) => !hasText(a));
  const canGenerate = included.length > 0;
  const generateLabel = excluded.length > 0 && canGenerate
    ? `צור ניוזלטר עם ${included.length} מתוך ${eligibleArticles.length} כתבות`
    : 'צור ניוזלטר';
  return { included, excluded, canGenerate, generateLabel };
}
