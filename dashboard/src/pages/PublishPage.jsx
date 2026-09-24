// src/pages/PublishPage.jsx
//
// Separate from the review screens (FeedPage/ArchivePage) on purpose: this
// serves a different session. Michal reviews new items roughly weekly,
// deciding interesting/not; she reviews publication texts roughly monthly,
// before sending — different mindset, different frequency.
//
// Both tabs now have an "already done" split, deliberately mirrored: an
// article stops being offered for further action once the tab's own marker
// column is set (newsletter_batch_id for ניוזלטר, published_to_website_at
// for אתר), but it stays visible below, under its own "-ו בעבר" section,
// instead of disappearing — a vanished article is exactly the kind of
// silent behaviour this project avoids everywhere else
// (docs/project_notes.md). The newsletter tab batches through
// NewsletterBuilder; the website tab has no batch step at all — WordPress
// has no API integration (see docs/project_notes.md), so Michal copies and
// marks one article at a time, which is why its actions live directly on
// each PublishItem (channel="website") instead of a page-level builder.
import { useState } from 'react';
import PublishItem from '../components/PublishItem';
import NewsletterBuilder from '../components/NewsletterBuilder';

const TABS = [
  {
    key: 'newsletter',
    label: 'ניוזלטר',
    matches: (a) => a.publish_target === 'newsletter' || a.publish_target === 'both',
    isDone: (a) => Boolean(a.newsletter_batch_id),
    doneSectionHeading: 'נשלחו בעבר',
  },
  {
    key: 'website',
    label: 'אתר',
    matches: (a) => a.publish_target === 'website' || a.publish_target === 'both',
    isDone: (a) => Boolean(a.published_to_website_at),
    doneSectionHeading: 'פורסמו בעבר',
  },
];

export default function PublishPage({ articles, onUpdate }) {
  const [activeTab, setActiveTab] = useState('newsletter');

  const approved = articles.filter(a => a.review_status === 'approved');
  const activeTabDef = TABS.find(t => t.key === activeTab);
  const tabArticles = approved.filter(activeTabDef.matches);

  const pendingArticles = tabArticles.filter(a => !activeTabDef.isDone(a));
  const doneArticles = tabArticles.filter(a => activeTabDef.isDone(a));

  return (
    <section>
      <div style={tabBarStyle}>
        {TABS.map(tab => {
          // The badge counts only what still needs action — an article
          // already sent/published isn't something Michal needs to look at
          // again, even though it stays visible further down the page.
          const count = approved.filter(tab.matches).filter(a => !tab.isDone(a)).length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              style={{ ...tabStyle, ...(isActive ? activeTabStyle : {}) }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              <span style={badgeStyle}>{count}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'newsletter' && (
        <NewsletterBuilder eligibleArticles={pendingArticles} onUpdate={onUpdate} />
      )}

      {pendingArticles.map(article => (
        <PublishItem key={article.id} article={article} onUpdate={onUpdate} channel={activeTab} />
      ))}

      {doneArticles.length > 0 && (
        <div style={sentSectionStyle}>
          <h4 style={sentSectionHeadingStyle}>{activeTabDef.doneSectionHeading}</h4>
          {doneArticles.map(article => (
            <PublishItem key={article.id} article={article} onUpdate={onUpdate} channel={activeTab} />
          ))}
        </div>
      )}

      {pendingArticles.length === 0 && doneArticles.length === 0 && (
        <p style={{ color: '#888', textAlign: 'right', marginTop: '24px' }}>
          אין כתבות מאושרות ליעד זה.
        </p>
      )}
    </section>
  );
}

const tabBarStyle = {
  display: 'flex',
  gap: '4px',
  marginBottom: '24px',
  borderBottom: '1px solid var(--border, #e0e0e0)',
};

const tabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 16px',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontSize: '0.9rem',
  color: 'var(--text, #555)',
  fontFamily: 'inherit',
  marginBottom: '-1px',
};

const activeTabStyle = {
  color: 'var(--accent, #0066cc)',
  fontWeight: 'bold',
  borderBottom: '2px solid var(--accent, #0066cc)',
};

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '20px',
  padding: '1px 6px',
  borderRadius: '10px',
  fontSize: '0.75rem',
  background: 'var(--accent-bg, #e8f0fe)',
  color: 'var(--accent, #0066cc)',
  fontWeight: 'normal',
};

const sentSectionStyle = {
  marginTop: '32px',
  paddingTop: '16px',
  borderTop: '1px solid var(--border, #e0e0e0)',
};

const sentSectionHeadingStyle = {
  margin: '0 0 12px 0',
  fontSize: '0.9rem',
  color: 'var(--text)',
  textAlign: 'right',
};
