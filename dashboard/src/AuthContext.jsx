// src/AuthContext.jsx
//
// One place for the cross-cutting pieces of "who is signed in" that pure
// prop-drilling would otherwise have to thread through pages that don't
// otherwise touch auth at all — DashboardLayout's sign-out control, and
// NewsCard's need for the current user's email when it stamps reviewed_by.
// AuthGate.jsx is the only component that ever provides this value; every
// other component only reads it via useAuth().
import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

// Returns { session, signOut }. Meaningful only inside the tree AuthGate.jsx
// mounts once a session exists — App.jsx (and everything under it, which is
// where every consumer of this hook lives) is never rendered otherwise, so
// `session` can be relied on to be non-null there. See AuthGate.jsx for why
// that is an actual structural guarantee, not just a convention to remember.
export function useAuth() {
  return useContext(AuthContext);
}
