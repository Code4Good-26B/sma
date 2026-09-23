// src/pages/PublishPage.jsx
//
// Separate from the review screens (FeedPage/ArchivePage) on purpose: this
// serves a different session. Michal reviews new items roughly weekly,
// deciding interesting/not; she reviews publication texts roughly monthly,
// before sending — different mindset, different frequency.
//
// The newsletter tab is where "צור ניוזלטר" lands (a button on this tab);
// the website tab is where a per-item copy button lands. Both are later
// tasks — this file is structured so they drop onto an existing tab without
// rearranging the page.
import { useState } from 'react';
import PublishItem from '../components/PublishItem';

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

  return (
    <section>
      <div style={tabBarStyle}>
        {TABS.map(tab => {
          const count = approved.filter(tab.matches).length;
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

      {tabArticles.map(article => (
        <PublishItem key={article.id} article={article} onUpdate={onUpdate} />
      ))}

      {tabArticles.length === 0 && (
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
