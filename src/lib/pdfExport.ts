import { PDFDocument, degrees } from '@pdfme/pdf-lib'
import type { SourceFile, WorkingPage } from '../features/workspace/types'

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
export async function buildPdf(sourceFiles: SourceFile[], pages: WorkingPage[]): Promise<Uint8Array> {
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
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  setTimeout(() => URL.revokeObjectURL(url), 0)
}
