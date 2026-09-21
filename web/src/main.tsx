import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/tokens.css'
import App from './App'

// This app intentionally registers NO service worker. If one exists on this
// origin (e.g. left over from a previous deployment or a dev-tools overlay),
// it can keep retrying dead WebSocket connections and serve stale caches.
// Unregister it and clear its caches once.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
    .then((removed) => {
      if (removed.some(Boolean) && 'caches' in window) {
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      }
    })
    .catch(() => {}) // never block the app on cleanup
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
