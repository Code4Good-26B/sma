// src/components/DashboardLayout.jsx
import { NavLink } from 'react-router-dom';
import smaLogo from '../assets/sma_logo.png';

const navLinks = [
  { to: '/',          label: '📰 ידיעות חדשות',    end: true },
  { to: '/archive',   label: '🗂️ ידיעות שטופלו' },
  { to: '/stats',     label: '📊 סטטיסטיקות' },
  { to: '/settings',  label: '⚙️ הגדרות' },
];

export default function DashboardLayout({ children }) {
  return (
    <div dir="rtl" style={layoutStyle}>
      {/* Sidebar */}
      <aside style={sidebarStyle}>
        <img src={smaLogo} alt="SMA Israel" style={logoStyle} />
        <nav style={navStyle}>
          {navLinks.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({ ...navItemStyle, ...(isActive ? activeNavItemStyle : {}) })}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div style={mainWrapperStyle}>
        <header style={headerStyle}>
          <h2 style={{ margin: 0 }}>עמותת משפחות SMA ישראל: פורטל ניהול ידיעות</h2>
          <div style={userProfileStyle}>שלום, מיכל 👋</div>
        </header>

        <main style={contentStyle}>
          {children}
        </main>
      </div>
    </div>
  );
}

const layoutStyle = {
  display: 'flex',
  minHeight: '100vh',
  backgroundColor: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: '"Heebo", sans-serif',
};

const sidebarStyle = {
  width: '180px',
  backgroundColor: 'var(--bg-secondary)',
  borderLeft: '1px solid var(--border)',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
};

const logoStyle = {
  width: '160px',
  display: 'block',
  margin: '0 auto 24px',
};

const navStyle = { display: 'flex', flexDirection: 'column', gap: '4px' };

const navItemStyle = {
  display: 'block',
  textDecoration: 'none',
  color: 'var(--text-h)',
  cursor: 'pointer',
  padding: '10px 12px',
  borderRadius: '4px',
  fontSize: '0.95rem',
  transition: 'background 0.2s',
};

const activeNavItemStyle = {
  fontWeight: 'bold',
  color: 'var(--accent, #0066cc)',
  backgroundColor: 'var(--accent-bg, #e8f0fe)',
};

const mainWrapperStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' };

const headerStyle = {
  height: '70px',
  backgroundColor: 'var(--bg-secondary)',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0 30px',
};

const userProfileStyle = { fontSize: '0.9rem', color: 'var(--text)' };

const contentStyle = {
  boxSizing: 'border-box',
  padding: '30px',
  overflowX: 'hidden',
  overflowY: 'auto',
  maxWidth: '900px',
  margin: '0 auto',
  width: '100%',
};
