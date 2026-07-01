// src/pages/FeedPage.jsx
import { useState } from 'react';
import NewsCard from '../components/NewsCards';

const TABS = [
  { key: 'not_reviewed', label: 'ידיעות הממתינות לאישור' },
  { key: 'needs_edit',   label: 'טיוטות' },
];

export default function FeedPage({ articles, onUpdate }) {
  const [activeFilter, setActiveFilter] = useState('not_reviewed');
  const [hideProcessing, setHideProcessing] = useState(false);

  const tabArticles = articles.filter(a => a.review_status === activeFilter);
  const filteredArticles = hideProcessing
    ? tabArticles.filter(a => a.processing_status === 'done')
    : tabArticles;

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={tabBarStyle}>
          {TABS.map(tab => {
            const count = articles.filter(a => a.review_status === tab.key).length;
            const isActive = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                style={{ ...tabStyle, ...(isActive ? activeTabStyle : {}) }}
                onClick={() => setActiveFilter(tab.key)}
              >
                {tab.label}
                <span style={badgeStyle}>{count}</span>
              </button>
            );
          })}
        </div>
        <label style={filterToggleStyle}>
          <input
            type="checkbox"
            checked={hideProcessing}
            onChange={e => setHideProcessing(e.target.checked)}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          הסתרת ידיעות בעיבוד
        </label>
      </div>

      {filteredArticles.map(article => (
        <NewsCard key={article.id} article={article} onUpdate={onUpdate} />
      ))}

      {filteredArticles.length === 0 && (
        <p style={{ color: '#888', textAlign: 'right', marginTop: '24px' }}>אין ידיעות בסטטוס זה.</p>
      )}
    </section>
  );
}

const filterToggleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '0.82rem',
  color: 'var(--text)',
  cursor: 'pointer',
  paddingBottom: '8px',
  userSelect: 'none',
};

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
