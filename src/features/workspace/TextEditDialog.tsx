import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { getPageViewport, renderPageToCanvas } from '../../lib/pdf'
import { getTextBlocks } from '../../lib/textBlocks'
import type { TextBlock } from '../../lib/textBlocks'
import { matchStandardFont } from '../../lib/pdfExport'
import type { PageEdit, WorkingPage } from './types'
import { Spinner } from './Spinner'
import { TextEditOverlay } from './TextEditOverlay'

/**
 * Scale (before device-pixel-ratio) used when rendering the page inside this
 * dialog — deliberately larger than `PagePreview`'s inline scale, since the
 * whole point of the dialog is giving text editing much more room than the
 * cramped, fixed-width sidebar panel it used to live in.
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
  hasSeenTextEditCaveat: boolean
  onDismissTextEditCaveat: () => void
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
  hasSeenTextEditCaveat,
  onDismissTextEditCaveat,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6"
      onClick={closeAndCommitPending}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col gap-3 rounded-xl bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">
            Editing text — page {position} of {totalPages}
          </h2>
          <button
            type="button"
            onClick={closeAndCommitPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Done editing
          </button>
        </div>

        {!hasSeenTextEditCaveat && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>
              Edited or covered text isn&apos;t fully removed from the file — it&apos;s visually
              replaced, but the original content can still be recovered by inspecting the PDF
              directly.
            </span>
            <button
              type="button"
              onClick={onDismissTextEditCaveat}
              className="shrink-0 font-medium hover:underline"
            >
              Got it
            </button>
          </div>
        )}

        <div className="relative flex flex-1 items-center justify-center overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-4">
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              className="max-h-[78vh] max-w-[80vw] rounded bg-white object-contain shadow"
            />
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
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
              <Spinner />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/90 px-6 text-center text-sm text-red-500">
              Couldn&apos;t render this page.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
