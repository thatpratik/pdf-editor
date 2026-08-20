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
const BLOCK_LINE_GAP_FACTOR = 1.6
const BLOCK_LEFT_ALIGN_TOLERANCE = 12

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
  const lines: PositionedItem[][] = []

  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= LINE_Y_EPSILON)
    if (line) {
      line.push(item)
    } else {
      lines.push([item])
    }
  }

  lines.forEach((line) => line.sort((a, b) => a.x - b.x))
  lines.sort((a, b) => b[0].y - a[0].y)
  return lines
}

interface Block {
  lines: PositionedItem[][]
  boundingBox: PdfRect
}

function groupIntoBlocks(lines: PositionedItem[][]): Block[] {
  const blocks: Block[] = []

  for (const line of lines) {
    const lineLeft = Math.min(...line.map((item) => item.x))
    const lineFontSize = line[0].fontSize
    const lineTop = line[0].y + lineFontSize
    const lineBottom = line[0].y
    const lineRect = lineRectOf(line, lineTop, lineBottom)

    const current = blocks[blocks.length - 1]
    if (current) {
      const previousLine = current.lines[current.lines.length - 1]
      const previousLeft = Math.min(...previousLine.map((item) => item.x))
      const previousBottom = previousLine[0].y
      const gap = previousBottom - lineTop
      const sameBlock =
        gap <= lineFontSize * BLOCK_LINE_GAP_FACTOR &&
        Math.abs(previousLeft - lineLeft) <= BLOCK_LEFT_ALIGN_TOLERANCE

      if (sameBlock) {
        current.lines.push(line)
        current.boundingBox = unionRect(current.boundingBox, lineRect)
        continue
      }
    }

    blocks.push({ lines: [line], boundingBox: lineRect })
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
