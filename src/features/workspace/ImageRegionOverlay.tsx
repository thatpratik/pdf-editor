import type { PageViewport } from 'pdfjs-dist'
import type { ImageRegion } from '../../lib/imageRegions'

interface ImageRegionOverlayProps {
  regions: ImageRegion[]
  viewport: PageViewport
  /** Backing-store-pixels-to-displayed-CSS-pixels ratio for the canvas underneath this overlay. */
  displayScale: number
}

/**
 * Read-only bounding-box overlay over each detected image on the page,
 * layered atop the already-rendered canvas the same way `TextEditOverlay`
 * is. This is deliberately non-interactive — it exists to visually confirm
 * that `getPageImageRegions`'s detected boxes actually line up with the
 * real images on a real page before any drag/resize/delete UI is built on
 * top of it.
 */
export function ImageRegionOverlay({ regions, viewport, displayScale }: ImageRegionOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {regions.map((region, index) => {
        const [x1, y1] = viewport.convertToViewportPoint(
          region.boundingBox.x,
          region.boundingBox.y,
        )
        const [x2, y2] = viewport.convertToViewportPoint(
          region.boundingBox.x + region.boundingBox.width,
          region.boundingBox.y + region.boundingBox.height,
        )
        const left = Math.min(x1, x2) * displayScale
        const top = Math.min(y1, y2) * displayScale
        const width = Math.abs(x2 - x1) * displayScale
        const height = Math.abs(y2 - y1) * displayScale

        return (
          <div
            key={region.id}
            style={{ left, top, width, height }}
            className="absolute border-2 border-dashed border-emerald-500 bg-emerald-400/10"
          >
            <span className="absolute -top-5 left-0 rounded bg-emerald-600 px-1 text-[10px] font-medium text-white">
              Image {index + 1}
            </span>
          </div>
        )
      })}
    </div>
  )
}
