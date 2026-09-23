// src/pages/PublishPage.jsx
//
// Separate from the review screens (FeedPage/ArchivePage) on purpose: this
// serves a different session. Michal reviews new items roughly weekly,
// deciding interesting/not; she reviews publication texts roughly monthly,
// before sending — different mindset, different frequency.
//
// The website tab is where a per-item copy button lands — a later task,
// which is why it still shows every matching approved article exactly as
// before, with no "already sent" concept. The newsletter tab now has one:
// an article stops being offered for a new newsletter once
// newsletter_batch_id is set (NewsletterBuilder's "סמן כנשלח"), but it stays
// visible below, under "נשלחו בעבר", instead of disappearing — a vanished
// article is exactly the kind of silent behaviour this project avoids
// everywhere else (docs/project_notes.md).
import { useState } from 'react';
import PublishItem from '../components/PublishItem';
import NewsletterBuilder from '../components/NewsletterBuilder';

const TABS = [
  {
    key: 'newsletter',
    label: 'ניוזלטר',
    matches: (a) => a.publish_target === 'newsletter' || a.publish_target === 'both',
  },
  {
    key: 'website',
    label: 'אתר',
    matches: (a) => a.publish_target === 'website' || a.publish_target === 'both',
  },
];

export default function PublishPage({ articles, onUpdate }) {
  const [activeTab, setActiveTab] = useState('newsletter');

  const approved = articles.filter(a => a.review_status === 'approved');
  const activeTabDef = TABS.find(t => t.key === activeTab);
  const tabArticles = approved.filter(activeTabDef.matches);

  const isNewsletterTab = activeTab === 'newsletter';
  const unsentNewsletterArticles = isNewsletterTab ? tabArticles.filter(a => !a.newsletter_batch_id) : [];
  const sentNewsletterArticles = isNewsletterTab ? tabArticles.filter(a => a.newsletter_batch_id) : [];
  const visibleArticles = isNewsletterTab ? unsentNewsletterArticles : tabArticles;

  return (
    <section>
      <div style={tabBarStyle}>
        {TABS.map(tab => {
          // The newsletter tab's badge counts only what still needs
          // action (unsent articles) — one already sent isn't something
          // Michal needs to look at again, even though it stays visible
          // further down the page.
          const count = tab.key === 'newsletter'
            ? approved.filter(tab.matches).filter(a => !a.newsletter_batch_id).length
            : approved.filter(tab.matches).length;
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

      {isNewsletterTab && (
        <NewsletterBuilder eligibleArticles={unsentNewsletterArticles} onUpdate={onUpdate} />
      )}

      {visibleArticles.map(article => (
        <PublishItem key={article.id} article={article} onUpdate={onUpdate} />
      ))}

      {isNewsletterTab && sentNewsletterArticles.length > 0 && (
        <div style={sentSectionStyle}>
          <h4 style={sentSectionHeadingStyle}>נשלחו בעבר</h4>
          {sentNewsletterArticles.map(article => (
            <PublishItem key={article.id} article={article} onUpdate={onUpdate} />
          ))}
        </div>
      )}

      {visibleArticles.length === 0 && sentNewsletterArticles.length === 0 && (
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
