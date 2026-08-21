import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { getPageViewport, renderPageToCanvas } from '../../lib/pdf'
import { getPageImageRegions, cropRegionToPng } from '../../lib/imageRegions'
import type { ImageRegion } from '../../lib/imageRegions'
import type { Box } from './ImageRegionOverlay'
import type { PageEdit, PdfRect, WorkingPage } from './types'
import { Spinner } from './Spinner'
import { ImageRegionOverlay } from './ImageRegionOverlay'

/**
 * Backing-store render scale (before device-pixel-ratio) for the canvas
 * inside this dialog. Controls sharpness only — see the identical constant
 * in `TextEditDialog` for why this doesn't affect the displayed size.
 */
const DIALOG_SCALE = 2.2

type ImageEdit = Extract<PageEdit, { type: 'image' }>

interface ImageEditDialogProps {
  doc: PDFDocumentProxy
  page: WorkingPage
  /** 1-based position of this page within the current working set. */
  position: number
  totalPages: number
  onApplyImageEdit: (edit: ImageEdit) => void
  /** Whether the once-per-session edit disclosure has already been shown/dismissed. */
  hasSeenEditCaveat: boolean
  onDismissEditCaveat: () => void
  onClose: () => void
}

/** Converts a committed screen-gesture box (raw viewport units) into a PDF-space rect. */
function boxToPdfRect(box: Box, viewport: PageViewport): PdfRect {
  const [x1, y1] = viewport.convertToPdfPoint(box.left, box.top)
  const [x2, y2] = viewport.convertToPdfPoint(box.left + box.width, box.top + box.height)
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/**
 * Full-screen dialog for moving, resizing, and deleting existing images on a
 * page — the same "give this its own dialog rather than the cramped sidebar
 * panel" treatment `TextEditDialog` already got. Owns its own, larger canvas
 * render, independent of the small `PagePreview` panel.
 */
export function ImageEditDialog({
  doc,
  page,
  position,
  totalPages,
  onApplyImageEdit,
  hasSeenEditCaveat,
  onDismissEditCaveat,
  onClose,
}: ImageEditDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [imageRegions, setImageRegions] = useState<ImageRegion[] | null>(null)

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
    getPageImageRegions(doc, page.sourcePageNumber).then((regions) => {
      if (!cancelled) setImageRegions(regions)
    })
    return () => {
      cancelled = true
    }
  }, [doc, page.sourcePageNumber])

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  const handleCommitRegion = async (region: ImageRegion, box: Box | null) => {
    if (!viewport || !canvasRef.current) return

    if (!box) {
      // Deleted: nothing to draw, so no pixels need extracting.
      onApplyImageEdit({
        type: 'image',
        originalBoundingBox: region.boundingBox,
        newBoundingBox: null,
        imageBytes: new Uint8Array(),
        imageFormat: 'png',
      })
      return
    }

    const newBoundingBox = boxToPdfRect(box, viewport)
    const imageBytes = await cropRegionToPng(canvasRef.current, region, viewport)
    onApplyImageEdit({
      type: 'image',
      originalBoundingBox: region.boundingBox,
      newBoundingBox,
      imageBytes,
      imageFormat: 'png',
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6"
      onClick={handleClose}
    >
      <div
        className="flex max-h-full w-full max-w-[95vw] flex-col gap-3 rounded-xl bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">
            Editing images — page {position} of {totalPages}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Done editing
          </button>
        </div>

        {!hasSeenEditCaveat && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>
              Edited or covered content isn&apos;t fully removed from the file — it&apos;s
              visually replaced, but the original content can still be recovered by inspecting
              the PDF directly.
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

        <div className="relative flex flex-1 items-center justify-center overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-4">
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              className="max-w-[88vw] rounded bg-white object-contain shadow"
            />
            {viewport && imageRegions && (
              <ImageRegionOverlay
                regions={imageRegions}
                viewport={viewport}
                displayScale={displayScale}
                onCommit={handleCommitRegion}
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
