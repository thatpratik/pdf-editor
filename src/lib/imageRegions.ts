import { OPS, Util } from 'pdfjs-dist'
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
