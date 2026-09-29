import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import AuthGate from './AuthGate.jsx'

// AuthGate, not App, at the root: App (and its data-fetching effects) must
// not exist in the tree at all until there is a session — see AuthGate.jsx.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate />
    </BrowserRouter>
  </StrictMode>,
)
