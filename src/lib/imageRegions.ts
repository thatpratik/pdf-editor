import { OPS, Util } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist'
import type { PDFDocumentProxy } from './pdf'
import type { PdfRect } from '../features/workspace/types'

/** One detected image XObject on a page, in PDF user-space coordinates. */
export interface ImageRegion {
  id: string
  boundingBox: PdfRect
}

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/**
 * Detects existing images on a page and their current on-page position/size
 * by walking pdf.js's `getOperatorList()` output. An image XObject is always
 * painted into the unit square (0,0)-(1,1) of whatever coordinate system is
 * in effect at the time — its actual page position/size comes entirely from
 * the accumulated transform matrix (`cm`, `OPS.transform`) built up through
 * `OPS.save`/`OPS.restore` pairs, so this tracks that matrix stack and, at
 * each `OPS.paintImageXObject`, maps the unit square's four corners through
 * the current matrix to get the image's real bounding box.
 *
 * This is a detection-only pass — read-only, no drawing/rendering — meant to
 * be validated against real sample PDFs before any interactive move/resize/
 * delete UI is built on top of it, per the plan's own caution that this is
 * the riskiest, least-proven part of image editing. It only recognizes
 * `paintImageXObject` (external image XObjects); inline images
 * (`paintInlineImageXObject`) and images nested inside Form XObjects are not
 * detected — a known, narrower scope for this first pass.
 */
export async function getPageImageRegions(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<ImageRegion[]> {
  const page = await doc.getPage(pageNumber)
  const { fnArray, argsArray } = await page.getOperatorList()

  const regions: ImageRegion[] = []
  const stack: Matrix[] = []
  let ctm: Matrix = IDENTITY
  let imageIndex = 0

  for (let i = 0; i < fnArray.length; i++) {
    switch (fnArray[i]) {
      case OPS.save:
        stack.push(ctm)
        break
      case OPS.restore:
        ctm = stack.pop() ?? IDENTITY
        break
      case OPS.transform:
        ctm = Util.transform(ctm, argsArray[i] as Matrix) as Matrix
        break
      case OPS.paintImageXObject:
        regions.push({ id: `image-${imageIndex++}`, boundingBox: unitSquareBoundingBox(ctm) })
        break
      default:
        break
    }
  }

  return regions
}

/**
 * Extracts an image region's current pixels as PNG bytes, by cropping the
 * relevant rectangle out of the page's already-rendered canvas rather than
 * reading the PDF's internal image stream directly. pdf-lib's public API can
 * write new image XObjects onto a page, but has no supported way to read a
 * *specific* existing one back out — and even if it did, a raw stream's
 * bytes aren't necessarily valid standalone JPEG/PNG file bytes on their
 * own (that depends on the stream's filter and color space). Cropping the
 * canvas sidesteps both problems: it always yields a normal, self-contained
 * PNG, using exactly the pixels the user has been looking at. The trade-off
 * is a re-rasterization at the canvas's current render resolution rather
 * than the original image's native resolution — an accepted v1
 * simplification, not a bug to chase down.
 */
export async function cropRegionToPng(
  canvas: HTMLCanvasElement,
  region: ImageRegion,
  viewport: PageViewport,
): Promise<Uint8Array> {
  const [x1, y1] = viewport.convertToViewportPoint(region.boundingBox.x, region.boundingBox.y)
  const [x2, y2] = viewport.convertToViewportPoint(
    region.boundingBox.x + region.boundingBox.width,
    region.boundingBox.y + region.boundingBox.height,
  )
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)

  const offscreen = document.createElement('canvas')
  offscreen.width = Math.max(1, Math.round(width))
  offscreen.height = Math.max(1, Math.round(height))
  const ctx = offscreen.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.drawImage(canvas, left, top, width, height, 0, 0, offscreen.width, offscreen.height)

  const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Failed to encode cropped image region')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Maps the unit square (0,0)-(1,1) through `ctm` and returns its axis-aligned bounding box. */
function unitSquareBoundingBox(ctm: Matrix): PdfRect {
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]
  const transformed = corners.map(([x, y]): [number, number] => {
    const p: [number, number] = [x, y]
    Util.applyTransform(p, ctm)
    return p
  })

  const xs = transformed.map((p) => p[0])
  const ys = transformed.map((p) => p[1])
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const bottom = Math.min(...ys)
  const top = Math.max(...ys)
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}
