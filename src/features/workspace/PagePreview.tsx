import { useEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { getPageViewport, renderPageToCanvas } from '../../lib/pdf'
import { getTextBlocks } from '../../lib/textBlocks'
import type { TextBlock } from '../../lib/textBlocks'
import { getPageImageRegions } from '../../lib/imageRegions'
import type { ImageRegion } from '../../lib/imageRegions'
import { matchStandardFont } from '../../lib/pdfExport'
import type { PageEdit, WorkingPage } from './types'
import { Spinner } from './Spinner'
import { TextEditOverlay } from './TextEditOverlay'
import { ImageRegionOverlay } from './ImageRegionOverlay'

/** Scale (before device-pixel-ratio) used for the larger single-page preview. */
const PREVIEW_SCALE = 1.4

type TextEdit = Extract<PageEdit, { type: 'text' }>

interface PagePreviewProps {
  doc: PDFDocumentProxy
  page: WorkingPage
  /** 1-based position of this page within the current working set. */
  position: number
  totalPages: number
  onApplyTextEdit: (edit: TextEdit) => void
  /** Whether the once-per-session text-edit disclosure has already been shown/dismissed. */
  hasSeenTextEditCaveat: boolean
  onDismissTextEditCaveat: () => void
}

/** Larger canvas render of the selected working page, shown in the side panel. */
export function PagePreview({
  doc,
  page,
  position,
  totalPages,
  onApplyTextEdit,
  hasSeenTextEditCaveat,
  onDismissTextEditCaveat,
}: PagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [isEditingText, setIsEditingText] = useState(false)
  const [textBlocks, setTextBlocks] = useState<TextBlock[] | null>(null)
  const [isShowingImages, setIsShowingImages] = useState(false)
  const [imageRegions, setImageRegions] = useState<ImageRegion[] | null>(null)

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
  // is what lets the text-edit overlay line up with the visible page.
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
    if (!isEditingText) return
    let cancelled = false
    getTextBlocks(doc, page.sourcePageNumber).then((blocks) => {
      if (!cancelled) setTextBlocks(blocks)
    })
    return () => {
      cancelled = true
    }
  }, [isEditingText, doc, page.sourcePageNumber])

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

  const handleToggleEditText = () => {
    setIsEditingText((current) => {
      const next = !current
      if (!next) setTextBlocks(null)
      return next
    })
  }

  const handleToggleShowImages = () => {
    setIsShowingImages((current) => {
      const next = !current
      if (!next) setImageRegions(null)
      return next
    })
  }

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
            className={`rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:text-slate-300 ${
              isShowingImages
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'text-emerald-600 hover:bg-emerald-50'
            }`}
          >
            {isShowingImages ? 'Hide images' : 'Show images'}
          </button>
          <button
            type="button"
            onClick={handleToggleEditText}
            disabled={status !== 'ready'}
            className={`rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:text-slate-300 ${
              isEditingText
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'text-blue-600 hover:bg-blue-50'
            }`}
          >
            {isEditingText ? 'Done editing' : 'Edit text'}
          </button>
        </div>
      </div>

      {isEditingText && !hasSeenTextEditCaveat && (
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

      <div className="relative flex min-h-96 items-center justify-center rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        {/* inline-block so this wrapper's box exactly matches the canvas's
            rendered size (not the whole centered container) — the overlay
            below positions itself relative to this, so it lines up with
            the canvas regardless of how much empty space surrounds it. */}
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="max-h-[75vh] max-w-full rounded object-contain" />
          {isEditingText && viewport && textBlocks && (
            <TextEditOverlay
              blocks={textBlocks}
              viewport={viewport}
              displayScale={displayScale}
              onCommit={handleCommitBlock}
            />
          )}
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
    </div>
  )
}
