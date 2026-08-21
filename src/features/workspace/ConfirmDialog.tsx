import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A destructive-action confirmation, replacing `window.confirm` — the native
 * dialog can't be styled or themed and looks jarring next to the rest of the
 * app. Escape and the backdrop both cancel, matching the edit dialogs.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-display text-lg text-ink">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink/60">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3.5 py-2 text-sm font-medium text-ink/70 hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`rounded-md px-3.5 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              danger
                ? 'bg-danger-fill hover:bg-danger-hover focus-visible:ring-danger'
                : 'bg-accent-fill hover:bg-accent-hover focus-visible:ring-accent'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
