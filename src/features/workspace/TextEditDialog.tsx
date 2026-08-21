import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { getPageViewport, renderPageToCanvas } from '../../lib/pdf'
import { getTextBlocks } from '../../lib/textBlocks'
import type { TextBlock } from '../../lib/textBlocks'
import { matchStandardFont } from '../../lib/pdfExport'
import type { PageEdit, WorkingPage } from './types'
import { TextEditOverlay } from './TextEditOverlay'
import { CornerMarks } from './CornerMarks'
import { ScanBar } from './ScanBar'

/**
 * Backing-store render scale (before device-pixel-ratio) for the canvas
 * inside this dialog. This controls sharpness only, not the displayed
 * size — the canvas's CSS `max-width` (see the canvas's className below)
 * is what actually determines how big the page looks on screen, since a
 * canvas's CSS size clamp divides back out any resolution increase here.
 * Kept above 1 purely so the page stays crisp on high-DPI displays once
 * scaled up to fill most of the dialog's width.
 */
const DIALOG_SCALE = 2.2

type TextEdit = Extract<PageEdit, { type: 'text' }>

interface TextEditDialogProps {
  doc: PDFDocumentProxy
  page: WorkingPage
  /** 1-based position of this page within the current working set. */
  position: number
  totalPages: number
  onApplyTextEdit: (edit: TextEdit) => void
  /** Whether the once-per-session text-edit disclosure has already been shown/dismissed. */
  hasSeenEditCaveat: boolean
  onDismissEditCaveat: () => void
  onClose: () => void
}

/**
 * Full-screen dialog for in-place text editing, replacing the old approach
 * of overlaying edit boxes directly on the small (`w-[26rem]`) sidebar
 * preview — that panel is too narrow for multiple edit boxes and their
 * hover controls to sit in without feeling cramped. This dialog renders its
 * own, larger canvas independent of the sidebar's, so editing gets much more
 * screen space without changing how the small preview behaves when not
 * editing.
 */
export function TextEditDialog({
  doc,
  page,
  position,
  totalPages,
  onApplyTextEdit,
  hasSeenEditCaveat,
  onDismissEditCaveat,
  onClose,
}: TextEditDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [textBlocks, setTextBlocks] = useState<TextBlock[] | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    const scale = DIALOG_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, page.sourcePageNumber, canvas, scale, page.rotation)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))
    getPageViewport(doc, page.sourcePageNumber, scale, page.rotation).then(setViewport)

    return () => handle.cancel()
  }, [doc, page.sourcePageNumber, page.rotation])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || status !== 'ready') return

    const updateScale = () => {
      const rect = canvas.getBoundingClientRect()
      if (canvas.width > 0 && rect.width > 0) setDisplayScale(rect.width / canvas.width)
    }
    updateScale()

    const observer = new ResizeObserver(updateScale)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [status])

  useEffect(() => {
    let cancelled = false
    getTextBlocks(doc, page.sourcePageNumber).then((blocks) => {
      if (!cancelled) setTextBlocks(blocks)
    })
    return () => {
      cancelled = true
    }
  }, [doc, page.sourcePageNumber])

  // Blurring the active element before closing (via Escape, the backdrop, or
  // the Done button) ensures a pending edit still commits through the edit
  // box's own onBlur handler rather than being silently dropped.
  const closeAndCommitPending = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    onClose()
  }, [onClose])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndCommitPending()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeAndCommitPending])

  const handleCommitBlock = (block: TextBlock, newText: string) => {
    if (newText === block.text) return
    onApplyTextEdit({
      type: 'text',
      boundingBox: block.boundingBox,
      newText,
      fontKey: matchStandardFont(block.fontFamilyHint),
      fontSize: block.fontSize,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onClick={closeAndCommitPending}
    >
      <div
        className="flex max-h-full w-full max-w-[95vw] flex-col gap-3 rounded-xl bg-surface p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-medium text-ink/70">
            Editing text — page {position} of {totalPages}
          </h2>
          <button
            type="button"
            onClick={closeAndCommitPending}
            className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Done editing
          </button>
        </div>

        {!hasSeenEditCaveat && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn">
            <span>
              Edited or covered text isn&apos;t fully removed from the file — it&apos;s visually
              replaced, but the original content can still be recovered by inspecting the PDF
              directly.
            </span>
            <button
              type="button"
              onClick={onDismissEditCaveat}
              className="shrink-0 font-medium hover:underline"
            >
              Got it
            </button>
          </div>
        )}

        <div className="relative flex flex-1 overflow-auto rounded-lg border border-ink/10 bg-sunken p-4">
          <div className="relative m-auto inline-block">
            {/* Sized by width only (no max-height): a canvas's CSS
                max-height/max-width clamp the *displayed* size independent
                of how high its backing-store resolution is rendered, so
                capping height here would silently undo any attempt to make
                text bigger. Letting width drive the size and scrolling
                vertically (the frame below is `overflow-auto`) is what
                makes the natural, un-enlarged text big enough to edit
                without needing a separate "pop out bigger on focus" step.
                `m-auto` (not `items-center`/`justify-center` on the scroll
                container) keeps content centered when it fits but lets it
                scroll flush from the start edge once it overflows — center
                alignment on the scrollable element itself would hide half
                the overflow beyond the reachable scroll range. */}
            <canvas
              ref={canvasRef}
              className="max-w-[88vw] rounded bg-surface object-contain shadow"
            />
            {status === 'ready' && <CornerMarks />}
            {viewport && textBlocks && (
              <TextEditOverlay
                blocks={textBlocks}
                viewport={viewport}
                displayScale={displayScale}
                onCommit={handleCommitBlock}
              />
            )}
          </div>
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface/80">
              <ScanBar />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface/90 px-6 text-center text-sm text-danger">
              Couldn&apos;t render this page.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
