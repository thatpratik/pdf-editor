/** Small reusable loading spinner, used anywhere a render/load is in flight. */
export function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full border-2 border-slate-300 border-t-slate-500 ${className}`}
    />
  )
}
