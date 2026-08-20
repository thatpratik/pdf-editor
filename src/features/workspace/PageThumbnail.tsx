import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { renderPageToCanvas } from '../../lib/pdf'
import type { WorkingPage } from './types'
import { Spinner } from './Spinner'

/** Scale (before device-pixel-ratio) used for grid thumbnails — small and cheap to render many of. */
const THUMBNAIL_SCALE = 0.3

interface PageThumbnailProps {
  page: WorkingPage
  doc: PDFDocumentProxy
  isSelected: boolean
  onSelect: (pageId: string) => void
}

/**
 * One canvas-rendered thumbnail in the page grid, labeled with its page
 * number and draggable (via the handle) to reorder the working set.
 */
export function PageThumbnail({ page, doc, isSelected, onSelect }: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    const scale = THUMBNAIL_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, page.sourcePageNumber, canvas, scale)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))

    return () => handle.cancel()
  }, [doc, page.sourcePageNumber])

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex flex-col items-center gap-1.5 rounded-lg border p-2 transition ${
        isSelected
          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      } ${isDragging ? 'z-10 opacity-70' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute left-1.5 top-1.5 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <circle cx="9" cy="6" r="1.4" />
          <circle cx="15" cy="6" r="1.4" />
          <circle cx="9" cy="12" r="1.4" />
          <circle cx="15" cy="12" r="1.4" />
          <circle cx="9" cy="18" r="1.4" />
          <circle cx="15" cy="18" r="1.4" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => onSelect(page.id)}
        aria-current={isSelected}
        className="flex w-full flex-col items-center gap-1.5"
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
        <span className="text-xs font-medium text-slate-500">{page.sourcePageNumber}</span>
      </button>
    </div>
  )
}
