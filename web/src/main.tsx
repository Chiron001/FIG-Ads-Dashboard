import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PasswordGate } from './components/PasswordGate.tsx'
import { applyTheme, getStoredTheme } from './lib/theme.ts'

// Applied before React ever mounts (not inside a useEffect) so the very
// first paint -- including the password gate, which renders before
// anything else -- already reflects the stored preference. Doing this in
// an effect instead would flash dark (the CSS default) then snap to light
// a frame later for anyone who'd chosen light.
applyTheme(getStoredTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <App />
    </PasswordGate>
  </StrictMode>,
)
