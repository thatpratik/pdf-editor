import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { getPageViewport, renderPageToCanvas } from '../../lib/pdf'
import { getPageImageRegions, cropRegionToPng } from '../../lib/imageRegions'
import type { ImageRegion } from '../../lib/imageRegions'
import type { Box } from './ImageRegionOverlay'
import type { PageEdit, PdfRect, WorkingPage } from './types'
import { ImageRegionOverlay } from './ImageRegionOverlay'
import { CornerMarks } from './CornerMarks'
import { ScanBar } from './ScanBar'

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

/** Inverse of `boxToPdfRect`: converts a PDF-space rect into raw viewport units. */
function pdfRectToBox(rect: PdfRect, viewport: PageViewport): Box {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y)
  const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

function sameRect(a: PdfRect, b: PdfRect, epsilon = 0.05): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  )
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
  // Mirrors `canvasRef.current` in state purely so the JSX below can
  // condition on it — reading a ref's `.current` during render (rather than
  // in an effect or event handler) isn't safe, since it doesn't trigger a
  // re-render when the ref is attached.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
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

  // Seeds each region's starting box from this page's existing edits (if
  // any), matched by `originalBoundingBox` the same way the reducer's
  // upsert does — otherwise reopening this dialog after a prior move/resize
  // would show the region back at its pristine, pre-edit position, and a
  // deleted image would reappear as if it were never removed.
  const initialBoxOverrides: Record<string, Box | 'deleted'> = {}
  if (viewport && imageRegions) {
    const imageEdits = page.edits.filter((edit): edit is ImageEdit => edit.type === 'image')
    for (const region of imageRegions) {
      const match = [...imageEdits]
        .reverse()
        .find((edit) => sameRect(edit.originalBoundingBox, region.boundingBox))
      if (!match) continue
      initialBoxOverrides[region.id] = match.newBoundingBox
        ? pdfRectToBox(match.newBoundingBox, viewport)
        : 'deleted'
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onClick={handleClose}
    >
      <div
        className="flex max-h-full w-full max-w-[95vw] flex-col gap-3 rounded-xl bg-surface p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-medium text-ink/70">
            Editing images — page {position} of {totalPages}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md bg-teal-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
          >
            Done editing
          </button>
        </div>

        {!hasSeenEditCaveat && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn">
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

        <div className="relative flex flex-1 overflow-auto rounded-lg border border-ink/10 bg-sunken p-4">
          <div className="relative m-auto inline-block">
            <canvas
              ref={(el) => {
                canvasRef.current = el
                setCanvasEl(el)
              }}
              className="max-w-[88vw] rounded bg-surface object-contain shadow"
            />
            {status === 'ready' && <CornerMarks color="teal" />}
            {/* Gated on `status === 'ready'`, not just viewport/imageRegions
                being loaded — the overlay snapshots each region's pixels
                straight off the canvas on mount, which needs the canvas to
                have actually finished rendering, not just been sized. */}
            {status === 'ready' && viewport && imageRegions && canvasEl && (
              <ImageRegionOverlay
                regions={imageRegions}
                viewport={viewport}
                canvas={canvasEl}
                displayScale={displayScale}
                initialBoxOverrides={initialBoxOverrides}
                onCommit={handleCommitRegion}
              />
            )}
          </div>
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface/80">
              <ScanBar className="text-teal" />
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
