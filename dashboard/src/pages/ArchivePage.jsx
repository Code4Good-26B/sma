// src/pages/ArchivePage.jsx
import { useState } from 'react';
import NewsCard from '../components/NewsCards';

const TABS = [
  { key: 'approved',   label: 'אושרו' },
  { key: 'irrelevant', label: 'נדחו' },
];

export default function ArchivePage({ articles, onUpdate }) {
  const [activeFilter, setActiveFilter] = useState('approved');
  const filteredArticles = articles.filter(a => a.review_status === activeFilter);

  return (
    <section>
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

      {filteredArticles.map(article => (
        <NewsCard key={article.id} article={article} onUpdate={onUpdate} />
      ))}

      {filteredArticles.length === 0 && (
        <p style={{ color: '#888', textAlign: 'right', marginTop: '24px' }}>אין כתבות בסטטוס זה.</p>
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
