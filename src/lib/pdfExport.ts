import { PDFDocument, degrees } from '@pdfme/pdf-lib'
import type { SourceFile, WorkingPage } from '../features/workspace/types'
import { downloadBlob } from './download'

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
    outputDoc.addPage(copiedPage)
  }

  return outputDoc.save()
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
