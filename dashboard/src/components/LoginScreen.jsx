// src/components/LoginScreen.jsx
//
// Rendered by AuthGate.jsx whenever there is no session. Two deliberate
// omissions, both worth recording so a future reader doesn't "complete" this
// screen by adding them back:
//
// - The error message does NOT distinguish a wrong email from a wrong
//   password. One generic message for both, so a failed attempt can't be
//   used to probe which email addresses have an account here.
// - There is NO "forgot password" flow. Supabase's built-in password-reset
//   email is rate-limited and explicitly not meant for production traffic
//   on the free plan, so this product cannot depend on it arriving when
//   Michal actually needs it. A password reset is done from the Supabase
//   dashboard directly — that belongs in the handover documentation, not
//   as a UI feature promising something it can't reliably deliver.
import { useState } from 'react';
import smaLogo from '../assets/sma_logo.png';
import { supabase } from '../supabaseClient';

const GENERIC_ERROR = 'האימייל או הסיסמה שגויים.';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(GENERIC_ERROR);
      return;
    }
    // On success, AuthGate's onAuthStateChange subscription picks up the new
    // session on its own — there is nothing else to do here, and no local
    // "logged in" state to set, since this component unmounts the moment
    // AuthGate re-renders with a session.
  };

  return (
    <div dir="rtl" style={pageStyle}>
      <form style={cardStyle} onSubmit={handleSubmit}>
        <img src={smaLogo} alt="SMA Israel" style={logoStyle} />
        <h2 style={titleStyle}>כניסה לפורטל ניהול הידיעות</h2>

        <label style={labelStyle}>
          אימייל
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={inputStyle}
            autoComplete="username"
            required
          />
        </label>

        <label style={labelStyle}>
          סיסמה
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p style={errorStyle}>{error}</p>}

        <button type="submit" style={submitBtnStyle} disabled={submitting}>
          {submitting ? 'מתחברת...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}

const pageStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  background: 'var(--bg-secondary)',
  fontFamily: '"Heebo", sans-serif',
  boxSizing: 'border-box',
  padding: '16px',
};

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  width: '340px',
  maxWidth: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow)',
  borderRadius: '12px',
  padding: '32px 28px',
  boxSizing: 'border-box',
};

const logoStyle = {
  width: '140px',
  display: 'block',
  margin: '0 auto 8px',
};

const titleStyle = {
  margin: '0 0 8px',
  fontSize: '1.05rem',
  color: 'var(--text-h)',
  textAlign: 'center',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '0.85rem',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  textAlign: 'right',
};

const inputStyle = {
  padding: '8px 10px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  textAlign: 'right',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  fontFamily: 'inherit',
};

const errorStyle = {
  margin: 0,
  padding: '8px 10px',
  borderRadius: '6px',
  fontSize: '0.85rem',
  fontWeight: 600,
  background: 'rgba(239, 68, 68, 0.12)',
  color: '#ef4444',
  border: '1px solid rgba(239, 68, 68, 0.35)',
  textAlign: 'center',
};

const submitBtnStyle = {
  marginTop: '6px',
  padding: '10px 18px',
  borderRadius: '6px',
  border: '1px solid var(--accent)',
  cursor: 'pointer',
  fontSize: '0.95rem',
  fontWeight: 700,
  background: 'var(--accent)',
  color: '#fff',
};
