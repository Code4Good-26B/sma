// src/pages/ArchivePage.jsx
import { useState } from 'react';
import NewsCard from '../components/NewsCards';

const TABS = [
  { key: 'approved',   label: 'אושרו' },
  { key: 'irrelevant', label: 'נדחו' },
];

const matchesSearch = (a, q) => {
  const title   = (a.reviewed_title_he   ?? a.title_he   ?? '').toLowerCase();
  const summary = (a.reviewed_summary_he ?? a.summary_he ?? '').toLowerCase();
  return title.includes(q) || summary.includes(q);
};

export default function ArchivePage({ articles, onUpdate }) {
  const [activeFilter, setActiveFilter] = useState('approved');
  const [searchQuery, setSearchQuery]   = useState('');

  const tabArticles = articles.filter(a => a.review_status === activeFilter);
  const q = searchQuery.trim().toLowerCase();
  const filteredArticles = q
    ? tabArticles.filter(a => matchesSearch(a, q))
    : tabArticles;

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
              onClick={() => { setActiveFilter(tab.key); setSearchQuery(''); }}
            >
              {tab.label}
              <span style={badgeStyle}>{count}</span>
            </button>
          );
        })}
      </div>

      <input
        type="search"
        placeholder="חיפוש בכותרת ובתוכן..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={searchInputStyle}
      />

      {filteredArticles.map(article => (
        <NewsCard key={article.id} article={article} onUpdate={onUpdate} />
      ))}

      {filteredArticles.length === 0 && (
        <p style={{ color: '#888', textAlign: 'right', marginTop: '24px' }}>
          {q ? 'לא נמצאו כתבות התואמות את החיפוש.' : 'אין כתבות בסטטוס זה.'}
        </p>
      )}
    </section>
  );
}

const searchInputStyle = {
  width: '100%',
  padding: '8px 14px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
  textAlign: 'right',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  fontFamily: 'inherit',
  marginBottom: '20px',
  outline: 'none',
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
