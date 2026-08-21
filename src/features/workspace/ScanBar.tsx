/**
 * A scanner-style sweep shown while a page canvas is rendering — the loading
 * state doubles as the app's identity (this is, literally, scanning a
 * document page) instead of a generic spinner. `.scan-bar`'s keyframes and
 * its `prefers-reduced-motion` fallback live in `index.css`.
 */
export function ScanBar({ className = 'text-accent' }: { className?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" role="status" aria-label="Rendering page">
      <div
        className={`scan-bar absolute inset-x-0 top-1/2 h-px shadow-[0_0_10px_1px_currentcolor] ${className}`}
        style={{ backgroundColor: 'currentcolor' }}
      />
    </div>
  )
}
