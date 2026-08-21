const POSITIONS = [
  'top-0 left-0 border-t-2 border-l-2',
  'top-0 right-0 border-t-2 border-r-2',
  'bottom-0 left-0 border-b-2 border-l-2',
  'bottom-0 right-0 border-b-2 border-r-2',
]

/**
 * Four corner brackets framing the active page — a viewfinder "lock-on",
 * the one deliberate visual signature of this app. Grounded in what the
 * tool actually does (targeting a specific document page), it's reserved
 * for the single focused view (preview panel, edit dialogs, an active
 * drop target) rather than repeated across every grid thumbnail.
 */
const COLOR_CLASSES = {
  accent: 'border-accent drop-shadow-[0_0_6px_var(--color-accent)]',
  teal: 'border-teal drop-shadow-[0_0_6px_var(--color-teal)]',
}

export function CornerMarks({ color = 'accent' }: { color?: keyof typeof COLOR_CLASSES }) {
  return (
    <div className="lock-on pointer-events-none absolute inset-2" aria-hidden="true">
      {POSITIONS.map((position) => (
        <div key={position} className={`absolute h-4 w-4 ${position} ${COLOR_CLASSES[color]}`} />
      ))}
    </div>
  )
}
