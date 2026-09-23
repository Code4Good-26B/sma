// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import FeedPage from './pages/FeedPage';
import ArchivePage from './pages/ArchivePage';
import PublishPage from './pages/PublishPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import { supabase } from './supabaseClient';
import { computeCollectorHealth } from './lib/computeCollectorHealth';

function App() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [health, setHealth] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // reloadKey, not a callable fetch function passed to "נסי שוב": an effect
  // must own its own fetch call inline to synchronize with unmount (the
  // `cancelled` guard below) — calling an externally-defined function
  // reference from inside an effect can't offer that guarantee, which is
  // also why ESLint's react-hooks rules flag it. Retrying just bumps this
  // counter, which re-runs the effect exactly like the initial mount did.
  useEffect(() => {
    let cancelled = false;

    async function fetchArticles() {
      setLoading(true);
      setLoadError(false);

      // Explicit column list, not select('*'): '*' pulls raw_text too,
      // which measured ~70% of the response payload on the live database
      // and is never displayed anywhere in this UI — keep it out even as
      // columns get added here (newsletter_text_he, reviewed_at, for the
      // publication-texts screen).
      const { data, error } = await supabase
        .from('content_items')
        .select(
          'id, source_name, source_url, published_at, created_at, ' +
          'title_he, summary_he, reviewed_title_he, reviewed_summary_he, ' +
          'newsletter_text_he, reviewed_at, ' +
          'review_status, processing_status, publish_target'
        )
        .order('published_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('Error fetching articles:', error);
        setLoadError(true);
      } else {
        setArticles(data);
      }
      setLoading(false);
    }

    fetchArticles();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retryFetch = () => setReloadKey(k => k + 1);

  useEffect(() => {
    async function fetchHealth() {
      const { data, error } = await supabase
        .from('collector_runs')
        .select('started_at, finished_at, status, items_seen, items_inserted, sources, error_message')
        .order('started_at', { ascending: false })
        .limit(14);

      if (error) {
        console.error('Error fetching collector_runs:', error);
        setHealth({ status: 'unknown' });
      } else {
        setHealth(computeCollectorHealth(data, new Date()));
      }
    }

    fetchHealth();
  }, []);

  const showToast = (message, type) => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // Returns true/false so a caller that needs to show its own success
  // confirmation (the publish screen's "שמירה" button) can tell whether the
  // write actually landed, without a second update path — the failure
  // toast below still fires from here either way, so callers only need to
  // handle their own success case.
  const onUpdate = async (id, changes) => {
    const previous = articles.find(a => a.id === id);

    setArticles(prev =>
      prev.map(a => a.id === id ? { ...a, ...changes } : a)
    );

    // .select('id'), not a bare .select(): the code below only reads
    // data.length to confirm the row was actually updated (see
    // docs/project_notes.md on the RLS UPDATE-vs-SELECT gap this guards
    // against) — a bare .select() would return every column, raw_text
    // included, on every single approve/reject/edit for no reason.
    const { data, error } = await supabase
      .from('content_items')
      .update(changes)
      .eq('id', id)
      .select('id');

    if (error || data.length === 0) {
      setArticles(prev =>
        prev.map(a => a.id === id ? previous : a)
      );
      showToast('השמירה נכשלה, נסי שוב', 'error');
      if (error) console.error('Failed to update article:', error);
      return false;
    }

    return true;
  };

  return (
    <>
      <DashboardLayout health={health}>
        {loading ? (
          <LoadingState />
        ) : loadError ? (
          <ErrorState onRetry={retryFetch} />
        ) : (
          <Routes>
            <Route path="/" element={<FeedPage articles={articles} onUpdate={onUpdate} />} />
            <Route path="/archive" element={<ArchivePage articles={articles} onUpdate={onUpdate} />} />
            <Route path="/publish" element={<PublishPage articles={articles} onUpdate={onUpdate} />} />
            <Route path="/stats" element={<StatsPage articles={articles} />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        )}
      </DashboardLayout>

      {toast && (
        <div style={toastStyle}>
          {toast.message}
        </div>
      )}
    </>
  );
}

function LoadingState() {
  return <p style={centeredMessageStyle}>טוענת ידיעות...</p>;
}

function ErrorState({ onRetry }) {
  return (
    <div style={centeredMessageStyle}>
      <p style={{ margin: '0 0 12px 0' }}>לא ניתן היה לטעון את הידיעות. בדקי את החיבור לאינטרנט.</p>
      <button style={retryBtnStyle} onClick={onRetry}>נסי שוב</button>
    </div>
  );
}

const centeredMessageStyle = {
  textAlign: 'center',
  color: 'var(--text)',
  marginTop: '60px',
  fontSize: '0.95rem',
};

const retryBtnStyle = {
  padding: '6px 20px',
  borderRadius: '6px',
  border: '1px solid var(--accent-border)',
  background: 'var(--accent-bg)',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 600,
};

const toastStyle = {
  position: 'fixed',
  bottom: '24px',
  left: '24px',
  background: 'var(--accent)',
  color: '#fff',
  padding: '12px 20px',
  borderRadius: '8px',
  fontSize: '0.9rem',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 999,
  direction: 'rtl',
};

export default App;
