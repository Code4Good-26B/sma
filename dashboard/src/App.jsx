// src/App.jsx
import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import FeedPage from './pages/FeedPage';
import ArchivePage from './pages/ArchivePage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import { articlesData } from './mockData';

function App() {
  const [articles, setArticles] = useState(articlesData);

  const onUpdate = (id, changes) => {
    setArticles(prev =>
      prev.map(a => a.id === id ? { ...a, ...changes } : a)
    );
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
