import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App.tsx'
import './index.css'

function main() {
  // After a new deploy, lazily-loaded route chunks get new content-hashed names and
  // the old ones are removed from the server. A browser still running the previous
  // index.html will 404 when it tries to import an old chunk ("Failed to fetch
  // dynamically imported module"). Vite fires `vite:preloadError` in that case - we
  // reload once to pull the fresh index.html + chunk names. The 10s time-guard stops
  // an infinite reload loop if the chunk is genuinely missing rather than just stale.
  window.addEventListener('vite:preloadError', () => {
    const KEY = 'vite:last-preload-reload'
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()))
      window.location.reload()
    }
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

main()

export default main
