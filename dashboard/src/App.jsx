// src/App.jsx
import { useState, useEffect } from 'react';
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

  const onUpdate = async (id, changes) => {
    setArticles(prev =>
      prev.map(a => a.id === id ? { ...a, ...changes } : a)
    );
    const { error } = await supabase
      .from('content_items')
      .update(changes)
      .eq('id', id);
    if (error) console.error('Failed to update article:', error);
  };

  return (
    <DashboardLayout>
      <Routes>
        <Route path="/" element={<FeedPage articles={articles} onUpdate={onUpdate} />} />
        <Route path="/archive" element={<ArchivePage articles={articles} onUpdate={onUpdate} />} />
        <Route path="/stats" element={<StatsPage articles={articles} />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </DashboardLayout>
  );
}

export default App;