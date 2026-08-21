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
  onRotate: (pageId: string) => void
  onDelete: (pageId: string) => void
  isSelectedForExtract: boolean
  onToggleExtract: (pageId: string) => void
  isSplitAfter: boolean
  onToggleSplitAfter: (pageId: string) => void
}

/**
 * One canvas-rendered thumbnail in the page grid, labeled with its page
 * number, draggable (via the handle) to reorder the working set, and
 * carrying its own rotate/delete actions plus an extraction checkbox.
 */
export function PageThumbnail({
  page,
  doc,
  isSelected,
  onSelect,
  onRotate,
  onDelete,
  isSelectedForExtract,
  onToggleExtract,
  isSplitAfter,
  onToggleSplitAfter,
}: PageThumbnailProps) {
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
    const handle = renderPageToCanvas(doc, page.sourcePageNumber, canvas, scale, page.rotation)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))

    return () => handle.cancel()
  }, [doc, page.sourcePageNumber, page.rotation])

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex flex-col items-center gap-1.5 rounded-lg border p-2 transition ${
        isSelected
          ? 'border-accent bg-accent/6'
          : 'border-ink/10 bg-white hover:border-ink/20 hover:bg-ink/[0.02]'
      } ${isDragging ? 'z-10 opacity-70' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute top-1.5 left-1.5 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-full text-ink/40 hover:bg-ink/8 hover:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
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

      <div className="absolute top-1.5 right-1.5 z-10 flex gap-1">
        <button
          type="button"
          onClick={() => onRotate(page.id)}
          aria-label="Rotate page 90°"
          className="flex h-6 w-6 items-center justify-center rounded-full text-ink/40 hover:bg-ink/8 hover:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h5M20 20v-5h-5M4.5 9A8 8 0 0 1 19 8M19.5 15a8 8 0 0 1-14.5 1"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(page.id)}
          aria-label="Delete page"
          className="flex h-6 w-6 items-center justify-center rounded-full text-ink/40 hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"
            />
          </svg>
        </button>
      </div>

      <label className="absolute bottom-1.5 left-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/85 hover:bg-white">
        <input
          type="checkbox"
          checked={isSelectedForExtract}
          onChange={() => onToggleExtract(page.id)}
          aria-label="Select page for extraction"
          className="h-4 w-4 accent-accent"
        />
      </label>

      <button
        type="button"
        onClick={() => onToggleSplitAfter(page.id)}
        aria-pressed={isSplitAfter}
        aria-label="Split into a new file after this page"
        title="Split into a new file after this page"
        className={`absolute right-1.5 bottom-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          isSplitAfter
            ? 'bg-accent text-white hover:bg-accent-hover'
            : 'bg-white/85 text-ink/40 hover:bg-white hover:text-ink/70'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5 20 20M7.5 16.5 20 4" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => onSelect(page.id)}
        aria-current={isSelected}
        className="flex w-full flex-col items-center gap-1.5"
      >
        <div className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded-md bg-ink/5">
          <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="h-5 w-5" />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-danger">
              Couldn&apos;t render
            </div>
          )}
        </div>
        <span className="font-mono text-xs text-ink/50">{page.sourcePageNumber}</span>
      </button>
    </div>
  )
}
