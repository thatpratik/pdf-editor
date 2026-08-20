import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { renderPageToCanvas } from '../../lib/pdf'
import { Spinner } from './Spinner'

/** Scale (before device-pixel-ratio) used for grid thumbnails — small and cheap to render many of. */
const THUMBNAIL_SCALE = 0.3

interface PageThumbnailProps {
  doc: PDFDocumentProxy
  pageNumber: number
  isSelected: boolean
  onSelect: (pageNumber: number) => void
}

/** One canvas-rendered thumbnail in the page grid, labeled with its page number. */
export function PageThumbnail({ doc, pageNumber, isSelected, onSelect }: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    const scale = THUMBNAIL_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, pageNumber, canvas, scale)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))

    return () => handle.cancel()
  }, [doc, pageNumber])

  return (
    <button
      type="button"
      onClick={() => onSelect(pageNumber)}
      aria-current={isSelected}
      className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition ${
        isSelected
          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded bg-slate-100">
        <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-red-500">
            Couldn&apos;t render
          </div>
        )}
      </div>
      <span className="text-xs font-medium text-slate-500">{pageNumber}</span>
    </button>
  )
}
