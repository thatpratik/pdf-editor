import type { PDFDocumentProxy } from './pdf'
import type { PdfRect } from '../features/workspace/types'

/** The subset of pdf.js's `TextItem` shape this module actually reads. */
interface RawTextItem {
  str: string
  transform: number[]
  width: number
  fontName: string
}

/**
 * One detected logical text block (paragraph) on a page, in PDF user-space
 * coordinates. `fontFamilyHint` is pdf.js's best guess at the block's font
 * family (from `TextContent.styles`), used later to pick the closest
 * pdf-lib standard font — see `matchStandardFont` in `pdfExport.ts`.
 */
export interface TextBlock {
  id: string
  boundingBox: PdfRect
  text: string
  fontFamilyHint: string
  fontSize: number
}

// Heuristic thresholds for clustering pdf.js's flat TextItem list into
// lines and lines into blocks — this is not a PDF-spec concept, and these
// numbers were tuned against hand-built sample documents, not derived
// analytically. Expect to retune against real-world documents.
const LINE_Y_EPSILON = 2
// A normal word-space is roughly 0.2-0.3x the font size. Anything much wider
// than that on the same baseline (a form label next to a far-right value, an
// item name next to its price) is two unrelated pieces of text, not one
// line — joining them would collapse the true gap to a single space and
// re-render the second piece flush against the first one's left edge.
const LINE_SEGMENT_GAP_FACTOR = 2.5
const BLOCK_LINE_GAP_FACTOR = 1.6
const BLOCK_LEFT_ALIGN_TOLERANCE = 12
// Two lines only belong to the same wrapped paragraph if they're roughly the
// same font size (a size change usually means a new heading/field, not a
// continuation) and the previous line ran nearly all the way to the block's
// established right margin — i.e. it looks like it was cut off by wrapping,
// not a short, complete line on its own (a field label, a table row, a form
// value). Without the second check, a stack of short same-font same-left
// lines — extremely common in forms and reports — all get merged into one
// giant block just because the gaps between them are small and uniform.
const BLOCK_FONT_SIZE_TOLERANCE = 0.5
const BLOCK_WRAP_FILL_TOLERANCE_FACTOR = 4

interface PositionedItem {
  str: string
  x: number
  y: number
  width: number
  fontSize: number
  fontFamilyHint: string
}

/**
 * Detects logical text blocks (paragraphs) on a page by clustering pdf.js's
 * flat `TextItem` list into lines (items sharing a baseline) and then lines
 * into blocks (adjacent lines with a small vertical gap and roughly-aligned
 * left edges).
 */
export async function getTextBlocks(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<TextBlock[]> {
  const page = await doc.getPage(pageNumber)
  const textContent = await page.getTextContent()

  const items: PositionedItem[] = textContent.items
    .filter((item) => 'str' in item && item.str.trim().length > 0)
    .map((item) => {
      const raw = item as unknown as RawTextItem
      const transform = raw.transform
      const fontSize =
        Math.hypot(transform[2], transform[3]) || Math.hypot(transform[0], transform[1])
      return {
        str: raw.str,
        x: transform[4],
        y: transform[5],
        width: raw.width,
        fontSize,
        fontFamilyHint: textContent.styles[raw.fontName]?.fontFamily ?? raw.fontName,
      }
    })

  if (items.length === 0) return []

  const lines = groupIntoLines(items)
  const blocks = groupIntoBlocks(lines)

  return blocks.map((block, index) => ({
    id: `block-${index}`,
    boundingBox: block.boundingBox,
    text: block.lines.map((line) => line.map((item) => item.str).join(' ')).join('\n'),
    fontFamilyHint: block.lines[0][0].fontFamilyHint,
    fontSize: block.lines[0][0].fontSize,
  }))
}

function groupIntoLines(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: PositionedItem[][] = []

  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= LINE_Y_EPSILON)
    if (row) {
      row.push(item)
    } else {
      rows.push([item])
    }
  }

  // A shared baseline alone doesn't mean two items belong together. Split a
  // same-baseline row into separate segments wherever the gap between
  // adjacent items is far wider than a normal word space, so each visually
  // distinct piece of text (a label vs. its right-aligned value, an item
  // name vs. its price) keeps its own true position instead of being fused
  // into one line anchored at the leftmost item's x.
  const lines: PositionedItem[][] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let segment: PositionedItem[] = [row[0]]
    for (let i = 1; i < row.length; i++) {
      const previous = segment[segment.length - 1]
      const gap = row[i].x - (previous.x + previous.width)
      if (gap > previous.fontSize * LINE_SEGMENT_GAP_FACTOR) {
        lines.push(segment)
        segment = [row[i]]
      } else {
        segment.push(row[i])
      }
    }
    lines.push(segment)
  }

  lines.sort((a, b) => b[0].y - a[0].y || a[0].x - b[0].x)
  return lines
}

interface Block {
  lines: PositionedItem[][]
  boundingBox: PdfRect
  /** Rightmost edge reached by any line in this block so far — the block's
   *  apparent wrap margin, used to tell "this line was cut off by wrapping"
   *  from "this line just ended because it's a short, complete line." */
  maxLineRight: number
}

function groupIntoBlocks(lines: PositionedItem[][]): Block[] {
  const blocks: Block[] = []

  for (const line of lines) {
    const lineLeft = Math.min(...line.map((item) => item.x))
    const lineRight = Math.max(...line.map((item) => item.x + item.width))
    const lineFontSize = line[0].fontSize
    const lineTop = line[0].y + lineFontSize
    const lineBottom = line[0].y
    const lineRect = lineRectOf(line, lineTop, lineBottom)

    const current = blocks[blocks.length - 1]
    if (current) {
      const previousLine = current.lines[current.lines.length - 1]
      const previousLeft = Math.min(...previousLine.map((item) => item.x))
      const previousRight = Math.max(...previousLine.map((item) => item.x + item.width))
      const previousFontSize = previousLine[0].fontSize
      const previousBottom = previousLine[0].y
      const gap = previousBottom - lineTop
      const previousLineWasWrapped =
        previousRight >= current.maxLineRight - lineFontSize * BLOCK_WRAP_FILL_TOLERANCE_FACTOR
      const sameBlock =
        gap <= lineFontSize * BLOCK_LINE_GAP_FACTOR &&
        Math.abs(previousLeft - lineLeft) <= BLOCK_LEFT_ALIGN_TOLERANCE &&
        Math.abs(previousFontSize - lineFontSize) <= BLOCK_FONT_SIZE_TOLERANCE &&
        previousLineWasWrapped

      if (sameBlock) {
        current.lines.push(line)
        current.boundingBox = unionRect(current.boundingBox, lineRect)
        current.maxLineRight = Math.max(current.maxLineRight, lineRight)
        continue
      }
    }

    blocks.push({ lines: [line], boundingBox: lineRect, maxLineRight: lineRight })
  }

  return blocks
}

function lineRectOf(line: PositionedItem[], top: number, bottom: number): PdfRect {
  const left = Math.min(...line.map((item) => item.x))
  const right = Math.max(...line.map((item) => item.x + item.width))
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}

function unionRect(a: PdfRect, b: PdfRect): PdfRect {
  const left = Math.min(a.x, b.x)
  const bottom = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const top = Math.max(a.y + a.height, b.y + b.height)
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}
