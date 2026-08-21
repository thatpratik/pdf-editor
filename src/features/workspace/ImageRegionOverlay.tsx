import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { ImageRegion } from '../../lib/imageRegions'

interface ImageRegionOverlayProps {
  regions: ImageRegion[]
  viewport: PageViewport
  /** Backing-store-pixels-to-displayed-CSS-pixels ratio for the canvas underneath this overlay. */
  displayScale: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface RegionBoxState extends Box {
  deleted: boolean
}

type DragMode = 'move' | 'resize'

interface DragState {
  id: string
  mode: DragMode
  startX: number
  startY: number
  start: Box
}

const MIN_BOX_SIZE = 16

function initialBox(region: ImageRegion, viewport: PageViewport, displayScale: number): Box {
  const [x1, y1] = viewport.convertToViewportPoint(region.boundingBox.x, region.boundingBox.y)
  const [x2, y2] = viewport.convertToViewportPoint(
    region.boundingBox.x + region.boundingBox.width,
    region.boundingBox.y + region.boundingBox.height,
  )
  return {
    left: Math.min(x1, x2) * displayScale,
    top: Math.min(y1, y2) * displayScale,
    width: Math.abs(x2 - x1) * displayScale,
    height: Math.abs(y2 - y1) * displayScale,
  }
}

/**
 * Draggable/resizable/deletable bounding-box overlay over each detected
 * image on the page, layered atop the already-rendered canvas the same way
 * `TextEditOverlay` is. This is the interaction-only slice of Phase 8 Step
 * 2: box geometry lives entirely in local, screen-space component state and
 * is discarded on unmount — there is no `APPLY_IMAGE_EDIT` reducer action or
 * `buildPdf` wiring yet, so nothing here is undoable or reflected in the
 * downloaded PDF. Its purpose is to validate that drag/resize/delete feels
 * right before committing to the PDF-space edit-recording and export-time
 * redraw logic that comes next.
 */
export function ImageRegionOverlay({ regions, viewport, displayScale }: ImageRegionOverlayProps) {
  const [boxes, setBoxes] = useState<Record<string, RegionBoxState>>(() =>
    Object.fromEntries(
      regions.map((region) => [
        region.id,
        { ...initialBox(region, viewport, displayScale), deleted: false },
      ]),
    ),
  )
  const dragRef = useRef<DragState | null>(null)

  const beginDrag = (id: string, mode: DragMode) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxes[id]
    if (!box) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { id, mode, startX: event.clientX, startY: event.clientY, start: box }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    setBoxes((current) => {
      const box = current[drag.id]
      if (!box) return current
      if (drag.mode === 'move') {
        return { ...current, [drag.id]: { ...box, left: drag.start.left + dx, top: drag.start.top + dy } }
      }
      return {
        ...current,
        [drag.id]: {
          ...box,
          width: Math.max(MIN_BOX_SIZE, drag.start.width + dx),
          height: Math.max(MIN_BOX_SIZE, drag.start.height + dy),
        },
      }
    })
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  const handleDelete = (id: string) => {
    setBoxes((current) => ({ ...current, [id]: { ...current[id], deleted: true } }))
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {regions.map((region, index) => {
        const box = boxes[region.id]
        if (!box || box.deleted) return null

        return (
          <div
            key={region.id}
            onPointerDown={beginDrag(region.id, 'move')}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            className="group pointer-events-auto absolute cursor-move touch-none border-2 border-dashed border-emerald-500 bg-emerald-400/10"
          >
            <span className="pointer-events-none absolute -top-5 left-0 rounded bg-emerald-600 px-1 text-[10px] font-medium text-white">
              Image {index + 1}
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => handleDelete(region.id)}
              aria-label={`Delete image ${index + 1}`}
              className="absolute -top-5 right-0 flex h-4 w-4 items-center justify-center rounded bg-red-600 text-[10px] leading-none font-bold text-white opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
            <div
              onPointerDown={beginDrag(region.id, 'resize')}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-se-resize touch-none rounded-full border border-white bg-emerald-600"
            />
          </div>
        )
      })}
    </div>
  )
}
