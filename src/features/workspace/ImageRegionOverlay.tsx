import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { ImageRegion } from '../../lib/imageRegions'

interface ImageRegionOverlayProps {
  regions: ImageRegion[]
  viewport: PageViewport
  /** The already-rendered page canvas, used to snapshot each region's current pixels for the live drag/resize preview. */
  canvas: HTMLCanvasElement
  /** Backing-store-pixels-to-displayed-CSS-pixels ratio for the canvas underneath this overlay. */
  displayScale: number
  /**
   * Per-region starting state (keyed by region id), seeded from this page's
   * already-committed edits — `'deleted'` if the region was removed, or a
   * `Box` if it was moved/resized — so reopening this dialog reflects prior
   * edits instead of the freshly re-detected, pristine original.
   */
  initialBoxOverrides: Record<string, Box | 'deleted'>
  /**
   * Called once a drag/resize gesture releases (with the region's final raw
   * viewport-space box) or a region is deleted (with `null`). Not called for
   * a click that didn't actually move/resize anything, so a no-op click
   * doesn't produce a spurious edit.
   */
  onCommit: (region: ImageRegion, box: Box | null) => void
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
export interface Box {
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

/**
 * Extra margin, in on-screen pixels, added around the white rectangle that
 * covers a region's vacated original spot. The occlusion is otherwise sized
 * to exactly match the detected bounding box, but the canvas underneath is a
 * downscaled, anti-aliased raster — its actual painted edges can bleed a
 * fractional pixel or two past that box. Without this margin, that sliver
 * peeks out from behind the occlusion as a thin line tracing the old shape.
 */
const OCCLUSION_BLEED_PX = 2

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
 * Crops a region's pixels straight out of the already-rendered page canvas,
 * as a data URL, for on-screen display only (not export — see
 * `cropRegionToPng` in `imageRegions.ts` for the rotation-compensated bytes
 * that actually get embedded). Screen-space and export-space differ here on
 * purpose: this crop is drawn back onto the very same rotated canvas the
 * pixels came from, so it must stay in that as-displayed orientation to
 * match, rather than being counter-rotated the way the exported copy is.
 */
function captureRegionPreview(canvas: HTMLCanvasElement, box: Box): string {
  const offscreen = document.createElement('canvas')
  offscreen.width = Math.max(1, Math.round(box.width))
  offscreen.height = Math.max(1, Math.round(box.height))
  const ctx = offscreen.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(canvas, box.left, box.top, box.width, box.height, 0, 0, offscreen.width, offscreen.height)
  return offscreen.toDataURL('image/png')
}

function sameBox(a: Box, b: Box, epsilon = 0.5): boolean {
  return (
    Math.abs(a.left - b.left) <= epsilon &&
    Math.abs(a.top - b.top) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  )
}

/**
 * Draggable/resizable/deletable bounding-box overlay over each detected
 * image on the page, layered atop the already-rendered canvas the same way
 * `TextEditOverlay` is. Box geometry lives in local component state (in raw
 * viewport units, scaled to screen pixels at render time via `displayScale`)
 * while a gesture is in progress, purely for smooth, immediate visual
 * feedback — `onCommit` is what turns a finished gesture into a real,
 * PDF-space edit (see `ImageEditDialog`, which converts the committed box
 * into `PdfRect` coordinates and extracts the image's pixels before
 * dispatching `APPLY_IMAGE_EDIT`).
 */
export function ImageRegionOverlay({
  regions,
  viewport,
  canvas,
  displayScale,
  initialBoxOverrides,
  onCommit,
}: ImageRegionOverlayProps) {
  const [boxes, setBoxes] = useState<Record<string, RegionBoxState>>(() =>
    Object.fromEntries(
      regions.map((region) => {
        const override = initialBoxOverrides[region.id]
        if (override === 'deleted') {
          return [region.id, { left: 0, top: 0, width: 0, height: 0, deleted: true }]
        }
        return [region.id, { ...(override ?? initialBox(region, viewport)), deleted: false }]
      }),
    ),
  )
  // Captured once per region, from its true original spot on the canvas —
  // not the (possibly already-moved) current box — since that original spot
  // is the only place real pixels exist to crop; the captured image is then
  // displayed at whatever box position/size is current, including live
  // while dragging/resizing, so a move or resize shows the actual picture
  // moving instead of an empty dashed outline.
  const [previewSrcByRegionId] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      regions.map((region) => [region.id, captureRegionPreview(canvas, initialBox(region, viewport))]),
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
    const drag = dragRef.current
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null

    const box = boxes[drag.id]
    const region = regions.find((candidate) => candidate.id === drag.id)
    if (!box || !region) return
    const unchanged =
      box.left === drag.start.left &&
      box.top === drag.start.top &&
      box.width === drag.start.width &&
      box.height === drag.start.height
    if (unchanged) return
    onCommit(region, box)
  }

  const handleDelete = (id: string) => {
    setBoxes((current) => ({ ...current, [id]: { ...current[id], deleted: true } }))
    const region = regions.find((candidate) => candidate.id === id)
    if (region) onCommit(region, null)
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {regions.map((region, index) => {
        const box = boxes[region.id]
        if (!box) return null

        // The underlying canvas always shows this region's original pixels
        // at its true original spot, since nothing ever redraws it live —
        // so once the current box has moved/resized away from that spot (or
        // the region was deleted), the original spot needs covering, or the
        // untouched original would show through right next to (or behind)
        // the moved copy.
        const original = initialBox(region, viewport)
        const needsOcclusion = box.deleted || !sameBox(box, original)

        return (
          <div key={region.id}>
            {needsOcclusion && (
              <div
                style={{
                  left: original.left * displayScale - OCCLUSION_BLEED_PX,
                  top: original.top * displayScale - OCCLUSION_BLEED_PX,
                  width: original.width * displayScale + OCCLUSION_BLEED_PX * 2,
                  height: original.height * displayScale + OCCLUSION_BLEED_PX * 2,
                }}
                className="absolute bg-white"
              />
            )}
            {!box.deleted && (
              <div
                onPointerDown={beginDrag(region.id, 'move')}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                style={{
                  left: box.left * displayScale,
                  top: box.top * displayScale,
                  width: box.width * displayScale,
                  height: box.height * displayScale,
                }}
                className="group pointer-events-auto absolute cursor-move touch-none border-2 border-dashed border-teal"
              >
                <img
                  src={previewSrcByRegionId[region.id]}
                  alt=""
                  draggable={false}
                  className="pointer-events-none h-full w-full object-fill"
                />
                <span className="pointer-events-none absolute -top-5 left-0 rounded bg-teal-fill px-1 font-mono text-[10px] font-medium text-white">
                  Image {index + 1}
                </span>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => handleDelete(region.id)}
                  aria-label={`Delete image ${index + 1}`}
                  className="absolute -top-5 right-0 flex h-4 w-4 items-center justify-center rounded bg-danger-fill text-[10px] leading-none font-bold text-white opacity-0 group-hover:opacity-100"
                >
                  ×
                </button>
                <div
                  onPointerDown={beginDrag(region.id, 'resize')}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endDrag}
                  className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-se-resize touch-none rounded-full border border-surface bg-teal-fill"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
