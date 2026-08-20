import { PDFDocument, StandardFonts, degrees, rgb } from '@pdfme/pdf-lib'
import type { PDFFont } from '@pdfme/pdf-lib'
import type { PageEdit, SourceFile, WorkingPage } from '../features/workspace/types'
import { downloadBlob } from './download'

/**
 * Maps pdf.js's best-guess font family hint to the closest pdf-lib standard
 * font. A real v1 simplification, not full font fidelity: true font reuse
 * would mean extracting and re-embedding the original embedded font
 * program, which is real work the PRD doesn't ask for here — edited text
 * may not visually match the surrounding original text's exact typeface.
 */
export function matchStandardFont(fontFamilyHint: string): StandardFonts {
  const hint = fontFamilyHint.toLowerCase()
  const isBold = hint.includes('bold')
  const isItalic = hint.includes('italic') || hint.includes('oblique')
  const isSerif = /times|serif|georgia|garamond|cambria|minion/.test(hint) && !hint.includes('sans')

  if (isSerif) {
    if (isBold && isItalic) return StandardFonts.TimesRomanBoldItalic
    if (isBold) return StandardFonts.TimesRomanBold
    if (isItalic) return StandardFonts.TimesRomanItalic
    return StandardFonts.TimesRoman
  }
  if (isBold && isItalic) return StandardFonts.HelveticaBoldOblique
  if (isBold) return StandardFonts.HelveticaBold
  if (isItalic) return StandardFonts.HelveticaOblique
  return StandardFonts.Helvetica
}

/**
 * Greedy word-wrap of `text` to fit within `maxWidth`, using the font's own
 * metrics — this is what makes the redrawn text stay confined to its
 * original block's box, per the PRD's "reflow contained to the local
 * block" decision. A single word wider than `maxWidth` is kept on its own
 * line rather than split, since pdf-lib has no sub-word break primitive.
 */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let currentLine = ''

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word
      if (!currentLine || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        currentLine = candidate
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }
    lines.push(currentLine)
  }

  return lines
}

/**
 * A `SourceFile`'s raw bytes, read lazily via `File.arrayBuffer()` and kept
 * here (keyed by `SourceFile.id`, not on the object itself) so a session
 * that downloads, then extracts, then splits the same file only reads it
 * off disk once.
 */
const rawBytesCache = new Map<string, Promise<ArrayBuffer>>()

function getRawBytes(sourceFile: SourceFile): Promise<ArrayBuffer> {
  let bytes = rawBytesCache.get(sourceFile.id)
  if (!bytes) {
    bytes = sourceFile.file.arrayBuffer()
    rawBytesCache.set(sourceFile.id, bytes)
  }
  return bytes
}

/**
 * Builds one output PDF from the current working set, in `pages` order.
 * Always reads from `sourceFiles`' original, untouched bytes, so calling
 * this repeatedly (download, extract, split) at any point in a session
 * reflects the current state exactly, with no separate save step.
 */
export async function buildPdf(
  sourceFiles: SourceFile[],
  pages: WorkingPage[],
): Promise<Uint8Array> {
  const outputDoc = await PDFDocument.create()
  const sourceFilesById = new Map(sourceFiles.map((sourceFile) => [sourceFile.id, sourceFile]))
  // Scoped to this call only — a fresh pdf-lib parse per buildPdf, reusing
  // already-fetched raw bytes across calls via `rawBytesCache` above.
  const loadedDocsById = new Map<string, PDFDocument>()
  // Also scoped to this call — a font is only ever embedded once per
  // buildPdf even if several edits (on the same or different pages) use it.
  const embeddedFontsByKey = new Map<StandardFonts, PDFFont>()

  for (const workingPage of pages) {
    const sourceFile = sourceFilesById.get(workingPage.sourceFileId)
    if (!sourceFile) continue

    let sourceDoc = loadedDocsById.get(workingPage.sourceFileId)
    if (!sourceDoc) {
      const bytes = await getRawBytes(sourceFile)
      sourceDoc = await PDFDocument.load(bytes)
      loadedDocsById.set(workingPage.sourceFileId, sourceDoc)
    }

    const [copiedPage] = await outputDoc.copyPages(sourceDoc, [workingPage.sourcePageNumber - 1])
    if (workingPage.rotation !== 0) {
      const currentAngle = copiedPage.getRotation().angle
      copiedPage.setRotation(degrees((currentAngle + workingPage.rotation) % 360))
    }

    for (const edit of workingPage.edits) {
      await applyEdit(outputDoc, copiedPage, edit, embeddedFontsByKey)
    }

    outputDoc.addPage(copiedPage)
  }

  return outputDoc.save()
}

/**
 * Draws one edit onto an already-copied page. Edits are data, not live
 * document mutations, so this — not the moment a user finishes typing — is
 * the only place any edit actually touches a pdf-lib document. This means
 * the original content underneath an edit's occluding rectangle is never
 * truly removed from the file, only visually covered — see the in-app
 * disclosure surfaced wherever text/image editing is offered.
 */
async function applyEdit(
  outputDoc: PDFDocument,
  page: Awaited<ReturnType<PDFDocument['copyPages']>>[number],
  edit: PageEdit,
  embeddedFontsByKey: Map<StandardFonts, PDFFont>,
): Promise<void> {
  if (edit.type !== 'text') return // image edits land in Phase 8

  const { x, y, width, height } = edit.boundingBox

  const fontKey = edit.fontKey as StandardFonts
  let font = embeddedFontsByKey.get(fontKey)
  if (!font) {
    font = await outputDoc.embedFont(fontKey)
    embeddedFontsByKey.set(fontKey, font)
  }

  const lineHeight = edit.fontSize * 1.15
  const lines = wrapText(edit.newText, font, edit.fontSize, width)

  // If the edited text needs more vertical space than the original block
  // had, grow the occlusion+redraw box downward (keeping its top edge
  // fixed) rather than clipping — an edit that makes a sentence longer
  // should still be fully visible, just wrapped, per the PRD.
  const neededHeight = Math.max(height, lines.length * lineHeight)
  const boxTop = y + height
  const boxY = boxTop - neededHeight

  page.drawRectangle({ x, y: boxY, width, height: neededHeight, color: rgb(1, 1, 1) })

  lines.forEach((line, index) => {
    const lineY = boxTop - edit.fontSize - index * lineHeight
    page.drawText(line, { x, y: lineY, size: edit.fontSize, font })
  })
}

/** Triggers a browser download of already-built PDF bytes. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename)
}

/**
 * Partitions `pages` into contiguous groups at the given split points — a
 * split lands right after the page whose id is in `splitAfterPageIds`. Pure
 * slicing only: no page-order or content changes. A split marked after the
 * very last page produces no trailing empty group.
 */
export function splitIntoRanges(
  pages: WorkingPage[],
  splitAfterPageIds: Set<string>,
): WorkingPage[][] {
  const ranges: WorkingPage[][] = []
  let current: WorkingPage[] = []

  for (const page of pages) {
    current.push(page)
    if (splitAfterPageIds.has(page.id)) {
      ranges.push(current)
      current = []
    }
  }
  if (current.length > 0) ranges.push(current)

  return ranges
}
