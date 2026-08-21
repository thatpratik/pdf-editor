import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function readInitialTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/**
 * Toggles `data-theme` on the root element, which is what every color token
 * in `index.css` is keyed off — no React state threading needed elsewhere.
 * The initial value is set synchronously by an inline script in
 * `index.html` (before this component mounts) so there's no flash of the
 * wrong theme on load.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <button
      type="button"
      onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-8 w-8 items-center justify-center rounded-full text-ink/55 hover:bg-ink/8 hover:text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4.5 w-4.5" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" />
          <path strokeLinecap="round" d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5" aria-hidden="true">
          <path d="M20.4 14.7A8.6 8.6 0 0 1 9.3 3.6a.6.6 0 0 0-.75-.8A9.6 9.6 0 1 0 21.2 15.4a.6.6 0 0 0-.8-.7Z" />
        </svg>
      )}
    </button>
  )
}
