import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { renderPageToCanvas } from '../../lib/pdf'
import type { PageEdit, WorkingPage } from './types'
import { Spinner } from './Spinner'
import { TextEditDialog } from './TextEditDialog'
import { ImageEditDialog } from './ImageEditDialog'

/** Scale (before device-pixel-ratio) used for the larger single-page preview. */
const PREVIEW_SCALE = 1.4

type TextEdit = Extract<PageEdit, { type: 'text' }>
type ImageEdit = Extract<PageEdit, { type: 'image' }>

interface PagePreviewProps {
  doc: PDFDocumentProxy
  page: WorkingPage
  /** 1-based position of this page within the current working set. */
  position: number
  totalPages: number
  onApplyTextEdit: (edit: TextEdit) => void
  onApplyImageEdit: (edit: ImageEdit) => void
  /** Whether the once-per-session edit disclosure has already been shown/dismissed. */
  hasSeenEditCaveat: boolean
  onDismissEditCaveat: () => void
}

/** Larger canvas render of the selected working page, shown in the side panel. */
export function PagePreview({
  doc,
  page,
  position,
  totalPages,
  onApplyTextEdit,
  onApplyImageEdit,
  hasSeenEditCaveat,
  onDismissEditCaveat,
}: PagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [isEditingText, setIsEditingText] = useState(false)
  const [isEditingImages, setIsEditingImages] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    setIsEditingText(false)
    setIsShowingImages(false)
    const scale = PREVIEW_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, page.sourcePageNumber, canvas, scale, page.rotation)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))
    getPageViewport(doc, page.sourcePageNumber, scale, page.rotation).then(setViewport)

    return () => handle.cancel()
  }, [doc, page.sourcePageNumber, page.rotation])

  // The canvas's backing-store resolution (for sharpness) differs from its
  // displayed CSS size (clamped by max-h-[75vh]/max-w-full) — this factor
  // is what lets the image-region overlay line up with the visible page.
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
    if (!isShowingImages) return
    let cancelled = false
    getPageImageRegions(doc, page.sourcePageNumber).then((regions) => {
      if (!cancelled) setImageRegions(regions)
    })
    return () => {
      cancelled = true
    }
  }, [isShowingImages, doc, page.sourcePageNumber])

  // Text editing opens in its own full-screen `TextEditDialog` rather than
  // overlaying edit boxes on this panel — the panel is a fixed, fairly
  // narrow sidebar column, too cramped for multiple edit boxes and their
  // hover controls. Closing images first avoids leaving a stale "Show
  // images" overlay active behind the dialog for no reason.
  const handleOpenTextEdit = () => {
    setIsShowingImages(false)
    setImageRegions(null)
    setIsEditingText(true)
  }

  const handleToggleShowImages = () => {
    setIsShowingImages((current) => {
      const next = !current
      if (!next) setImageRegions(null)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">
          Page {position} of {totalPages}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleShowImages}
            disabled={status !== 'ready'}
            className={`rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent ${
              isShowingImages
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'text-emerald-600 hover:bg-emerald-50'
            }`}
          >
            {isShowingImages ? 'Hide images' : 'Show images'}
          </button>
          <button
            type="button"
            onClick={handleOpenTextEdit}
            disabled={status !== 'ready'}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            Edit text
          </button>
        </div>
      </div>

      <div className="relative flex min-h-96 items-center justify-center rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        {/* inline-block so this wrapper's box exactly matches the canvas's
            rendered size (not the whole centered container) — the overlay
            below positions itself relative to this, so it lines up with
            the canvas regardless of how much empty space surrounds it. */}
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="max-h-[75vh] max-w-full rounded object-contain" />
          {isShowingImages && viewport && imageRegions && (
            <ImageRegionOverlay
              regions={imageRegions}
              viewport={viewport}
              displayScale={displayScale}
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

      {isEditingText && (
        <TextEditDialog
          doc={doc}
          page={page}
          position={position}
          totalPages={totalPages}
          onApplyTextEdit={onApplyTextEdit}
          hasSeenEditCaveat={hasSeenEditCaveat}
          onDismissEditCaveat={onDismissEditCaveat}
          onClose={() => setIsEditingText(false)}
        />
      )}
    </div>
  )
}
