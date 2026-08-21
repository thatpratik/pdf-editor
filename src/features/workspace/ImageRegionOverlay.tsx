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

/**
 * Box geometry in raw viewport CSS-pixel units (i.e. before multiplying by
 * `displayScale`), NOT on-screen pixels. Keeping stored state in this
 * scale-independent unit — rather than pre-multiplied screen pixels — is
 * what lets the rendered box track `displayScale` live: if the window
 * resizes while boxes are mounted (changing `displayScale` via the
 * `ResizeObserver` in `PagePreview`), each render recomputes the on-screen
 * position from this fixed raw geometry instead of the box silently
 * drifting out of alignment with the canvas underneath it.
 */
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

/** Minimum box size, in on-screen pixels. */
const MIN_BOX_SIZE = 16

function initialBox(region: ImageRegion, viewport: PageViewport): Box {
  const [x1, y1] = viewport.convertToViewportPoint(region.boundingBox.x, region.boundingBox.y)
  const [x2, y2] = viewport.convertToViewportPoint(
    region.boundingBox.x + region.boundingBox.width,
    region.boundingBox.y + region.boundingBox.height,
  )
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/**
 * Draggable/resizable/deletable bounding-box overlay over each detected
 * image on the page, layered atop the already-rendered canvas the same way
 * `TextEditOverlay` is. This is the interaction-only slice of Phase 8 Step
 * 2: box geometry lives entirely in local component state (in raw viewport
 * units, scaled to screen pixels at render time via `displayScale`) and
 * is discarded on unmount — there is no `APPLY_IMAGE_EDIT` reducer action or
 * `buildPdf` wiring yet, so nothing here is undoable or reflected in the
 * downloaded PDF. Its purpose is to validate that drag/resize/delete feels
 * right before committing to the PDF-space edit-recording and export-time
 * redraw logic that comes next.
 */
export function ImageRegionOverlay({ regions, viewport, displayScale }: ImageRegionOverlayProps) {
  const [boxes, setBoxes] = useState<Record<string, RegionBoxState>>(() =>
    Object.fromEntries(
      regions.map((region) => [region.id, { ...initialBox(region, viewport), deleted: false }]),
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
    // Screen-pixel deltas are converted into the same raw viewport units the
    // box is stored in by dividing out `displayScale`, so dragging tracks the
    // pointer 1:1 on screen regardless of how much the canvas is currently
    // scaled up/down from its backing resolution.
    const dx = (event.clientX - drag.startX) / displayScale
    const dy = (event.clientY - drag.startY) / displayScale
    setBoxes((current) => {
      const box = current[drag.id]
      if (!box) return current
      if (drag.mode === 'move') {
        return { ...current, [drag.id]: { ...box, left: drag.start.left + dx, top: drag.start.top + dy } }
      }
      const minSize = MIN_BOX_SIZE / displayScale
      return {
        ...current,
        [drag.id]: {
          ...box,
          width: Math.max(minSize, drag.start.width + dx),
          height: Math.max(minSize, drag.start.height + dy),
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
            style={{
              left: box.left * displayScale,
              top: box.top * displayScale,
              width: box.width * displayScale,
              height: box.height * displayScale,
            }}
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
