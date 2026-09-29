// src/AuthGate.jsx
//
// The ONLY component allowed to render <App />, and it does so only once an
// active session exists. This is the actual mechanism behind "gate the
// render, not the query" (see db/schema.sql's RLS comment for the other
// half of this): App.jsx's effects fetch articles and collector health the
// moment it mounts, with no auth check of their own. After content_items'
// and collector_runs' RLS policies were scoped to `authenticated` only, an
// anonymous query against them no longer errors — PostgREST/RLS silently
// filters out every row, returning an empty, successful result instead. A
// dashboard that queried anyway and rendered whatever came back would show
// a perfectly healthy-looking, empty screen to a logged-out visitor —
// indistinguishable from a genuinely quiet news week, which is exactly the
// failure mode this whole project exists to prevent for the Collector and
// must not reintroduce here by another route. So App is simply never
// mounted until there is a session: its effects cannot issue a query that
// was never going to be trusted anyway, because the component that owns
// them does not exist in the tree yet.
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { AuthContext } from './AuthContext';
import App from './App';
import LoginScreen from './components/LoginScreen';

export default function AuthGate() {
  // Three distinct values on purpose, matching the three required render
  // states exactly:
  //   undefined -> still checking for an existing session (brief)
  //   null      -> checked, there is no session -> the login screen
  //   object    -> a session exists -> the app
  // Collapsing "checking" and "no session" into one falsy state would mean
  // a page reload always flashes the login screen at an already-logged-in
  // user for a moment — the small wrongness this task explicitly calls out.
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });

    // Keeps sign-in/sign-out (from this tab, another tab, or a token
    // refresh failing) in sync with the UI with no manual reload — this is
    // also what "resumes" the session on every subsequent page load, since
    // getSession() above only covers the very first render.
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!cancelled) setSession(newSession);
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (session === undefined) {
    return <CheckingSession />;
  }

  if (session === null) {
    return <LoginScreen />;
  }

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ session, signOut }}>
      <App />
    </AuthContext.Provider>
  );
}

function CheckingSession() {
  return (
    <div dir="rtl" style={checkingStyle}>
      <p>בודקת התחברות...</p>
    </div>
  );
}

const checkingStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  color: 'var(--text)',
  fontSize: '0.95rem',
  fontFamily: '"Heebo", sans-serif',
};
