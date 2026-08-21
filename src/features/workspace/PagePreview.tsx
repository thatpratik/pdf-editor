import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { renderPageToCanvas } from '../../lib/pdf'
import type { PageEdit, WorkingPage } from './types'
import { TextEditDialog } from './TextEditDialog'
import { ImageEditDialog } from './ImageEditDialog'
import { CornerMarks } from './CornerMarks'
import { ScanBar } from './ScanBar'

/** Scale (before device-pixel-ratio) used for the larger per-page preview. */
const PREVIEW_SCALE = 1.4

type TextEdit = Extract<PageEdit, { type: 'text' }>
type ImageEdit = Extract<PageEdit, { type: 'image' }>

interface PagePreviewProps {
  doc: PDFDocumentProxy
  page: WorkingPage
  /** Name of the source file this page came from, shown as a title above the preview. */
  sourceFileName: string
  /** 1-based position of this page within the current working set. */
  position: number
  totalPages: number
  isSelected: boolean
  onSelect: (pageId: string) => void
  onApplyTextEdit: (edit: TextEdit) => void
  onApplyImageEdit: (edit: ImageEdit) => void
  /** Whether the once-per-session edit disclosure has already been shown/dismissed. */
  hasSeenEditCaveat: boolean
  onDismissEditCaveat: () => void
}

/**
 * One page's larger canvas render, shown in the full-file preview list.
 * Draggable (via the handle) to reorder the working set — the same
 * `useSortable` pattern `PageThumbnail` uses in the grid — so reordering
 * works from either view; both dispatch the same `REORDER_PAGES` action.
 */
export function PagePreview({
  doc,
  page,
  sourceFileName,
  position,
  totalPages,
  isSelected,
  onSelect,
  onApplyTextEdit,
  onApplyImageEdit,
  hasSeenEditCaveat,
  onDismissEditCaveat,
}: PagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [isEditingText, setIsEditingText] = useState(false)
  const [isEditingImages, setIsEditingImages] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    setIsEditingText(false)
    setIsEditingImages(false)
    const scale = PREVIEW_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, page.sourcePageNumber, canvas, scale, page.rotation)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))

    return () => handle.cancel()
  }, [doc, page.sourcePageNumber, page.rotation])

  // Text/image editing each open in their own full-screen dialog rather than
  // overlaying edit boxes on this panel — the panel is a fixed, fairly
  // narrow sidebar column, too cramped for multiple edit boxes and their
  // hover controls. Closing the other editor first avoids leaving a stale
  // dialog-behind-a-dialog state for no reason.
  const handleOpenTextEdit = () => {
    setIsEditingImages(false)
    setIsEditingText(true)
  }

  const handleOpenImageEdit = () => {
    setIsEditingText(false)
    setIsEditingImages(true)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onSelect(page.id)}
      className={`flex flex-col gap-3 rounded-lg border p-3 transition ${
        isSelected ? 'border-accent bg-accent/6' : 'border-transparent'
      } ${isDragging ? 'z-10 opacity-70' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
            aria-label="Drag to reorder"
            className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-full text-ink/40 hover:bg-ink/8 hover:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
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
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] text-ink/45" title={sourceFileName}>
              {sourceFileName}
            </p>
            <h2 className="font-mono text-sm font-medium text-ink/70">
              Page {position} of {totalPages}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleOpenImageEdit()
            }}
            disabled={status !== 'ready'}
            className="rounded-md px-2 py-1 text-xs font-medium text-teal hover:bg-teal/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal disabled:cursor-not-allowed disabled:text-ink/25 disabled:hover:bg-transparent"
          >
            Edit images
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleOpenTextEdit()
            }}
            disabled={status !== 'ready'}
            className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-ink/25 disabled:hover:bg-transparent"
          >
            Edit text
          </button>
        </div>
      </div>

      <div className="relative flex min-h-96 items-center justify-center rounded-lg border border-ink/10 bg-surface p-3 shadow-sm">
        <canvas ref={canvasRef} className="max-h-[70vh] max-w-full rounded object-contain" />
        {status === 'ready' && <CornerMarks />}
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

      {isEditingImages && (
        <ImageEditDialog
          doc={doc}
          page={page}
          position={position}
          totalPages={totalPages}
          onApplyImageEdit={onApplyImageEdit}
          hasSeenEditCaveat={hasSeenEditCaveat}
          onDismissEditCaveat={onDismissEditCaveat}
          onClose={() => setIsEditingImages(false)}
        />
      )}
    </div>
  )
}
