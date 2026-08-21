const POSITIONS = [
  'top-0 left-0 border-t border-l',
  'top-0 right-0 border-t border-r',
  'bottom-0 left-0 border-b border-l',
  'bottom-0 right-0 border-b border-r',
]

/**
 * Four small corner ticks framing the active page, echoing print-shop
 * registration marks — the one deliberate visual signature of this app,
 * reserved for the single focused-document view (preview panel, edit
 * dialogs) rather than repeated across every grid thumbnail.
 */
export function CornerMarks({ className = 'border-accent/70' }: { className?: string }) {
  return (
    <div className="pointer-events-none absolute inset-2" aria-hidden="true">
      {POSITIONS.map((position) => (
        <div key={position} className={`absolute h-3 w-3 ${position} ${className}`} />
      ))}
    </div>
  )
}
