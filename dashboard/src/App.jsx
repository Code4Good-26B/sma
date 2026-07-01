// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import FeedPage from './pages/FeedPage';
import ArchivePage from './pages/ArchivePage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import { supabase } from './supabaseClient';

function App() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    async function fetchArticles() {
      const { data, error } = await supabase
        .from('content_items')
        .select('*')
        .order('published_at', { ascending: false });

      if (error) {
        console.error('Error fetching articles:', error);
      } else {
        setArticles(data);
      }
      setLoading(false);
    }

    fetchArticles();
  }, []);

  const showToast = (message, type) => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const onUpdate = async (id, changes) => {
    const previous = articles.find(a => a.id === id);

    setArticles(prev =>
      prev.map(a => a.id === id ? { ...a, ...changes } : a)
    );

    const { data, error } = await supabase
      .from('content_items')
      .update(changes)
      .eq('id', id)
      .select();

    if (error || data.length === 0) {
      setArticles(prev =>
        prev.map(a => a.id === id ? previous : a)
      );
      showToast('השמירה נכשלה, נסי שוב', 'error');
      if (error) console.error('Failed to update article:', error);
    }
  };

  return (
    <>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<FeedPage articles={articles} onUpdate={onUpdate} />} />
          <Route path="/archive" element={<ArchivePage articles={articles} onUpdate={onUpdate} />} />
          <Route path="/stats" element={<StatsPage articles={articles} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </DashboardLayout>

      {toast && (
        <div style={toastStyle}>
          {toast.message}
        </div>
      )}
    </>
  );
}

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
