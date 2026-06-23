// src/pages/SettingsPage.jsx
import { useState } from 'react';

export default function SettingsPage() {
  const [skipRejectConfirm, setSkipRejectConfirm] = useState(
    localStorage.getItem('skipRejectConfirm') === 'true'
  );

  const toggle = (checked) => {
    setSkipRejectConfirm(checked);
    if (checked) {
      localStorage.setItem('skipRejectConfirm', 'true');
    } else {
      localStorage.removeItem('skipRejectConfirm');
    }
  };

  return (
    <section>
      <h3 style={{ marginBottom: '24px' }}>הגדרות</h3>
      <div style={sectionStyle}>
        <h4 style={sectionTitleStyle}>אישורים ודיאלוגים</h4>
        <label style={rowStyle}>
          <div style={rowTextStyle}>
            <span style={rowLabelStyle}>אישור דחיית ידיעה</span>
            <span style={rowDescStyle}>הצג חלון אישור לפני דחיית ידיעה</span>
          </div>
          <div
            style={{ ...toggleTrackStyle, background: skipRejectConfirm ? 'var(--border)' : 'var(--accent)' }}
            onClick={() => toggle(!skipRejectConfirm)}
          >
            <div style={{ ...toggleThumbStyle, transform: skipRejectConfirm ? 'translateX(0)' : 'translateX(20px)' }} />
          </div>
        </label>
      </div>
    </section>
  );
}

const sectionStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const sectionTitleStyle = {
  margin: '0 0 16px 0',
  fontSize: '0.85rem',
  fontWeight: 700,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  cursor: 'pointer',
  padding: '8px 0',
};

const rowTextStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const rowLabelStyle = {
  fontSize: '0.95rem',
  color: 'var(--text-h)',
  fontWeight: 500,
};

const rowDescStyle = {
  fontSize: '0.8rem',
  color: 'var(--text)',
};

const toggleTrackStyle = {
  width: '44px',
  height: '24px',
  borderRadius: '999px',
  flexShrink: 0,
  cursor: 'pointer',
  transition: 'background 0.2s',
  position: 'relative',
};

const toggleThumbStyle = {
  position: 'absolute',
  top: '3px',
  left: '3px',
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  transition: 'transform 0.2s',
};
