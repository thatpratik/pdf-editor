import { getPageCount, loadPdfDocument } from '../../lib/pdf'
import type { SourceFile, WorkingPage } from './types'

/**
 * Loads a batch of picked/dropped files into `SourceFile`s and their derived
 * `WorkingPage`s, ready to dispatch as one `ADD_FILES` action. If any file
 * in the batch fails to load (not a valid PDF, corrupted, etc.), the whole
 * batch is rejected — callers fall through to the app's generic load-error
 * state rather than needing to handle partial-batch failure.
 */
export async function loadSourceFiles(
  files: File[],
): Promise<{ sourceFiles: SourceFile[]; pages: WorkingPage[] }> {
  const loaded = await Promise.all(
    files.map(async (file) => {
      const doc = await loadPdfDocument(file)
      const sourceFile: SourceFile = { id: crypto.randomUUID(), name: file.name, file, doc }
      const pages: WorkingPage[] = Array.from({ length: getPageCount(doc) }, (_, index) => ({
        id: crypto.randomUUID(),
        sourceFileId: sourceFile.id,
        sourcePageNumber: index + 1,
        rotation: 0,
        edits: [],
      }))
      return { sourceFile, pages }
    }),
  )

  return {
    sourceFiles: loaded.map((entry) => entry.sourceFile),
    pages: loaded.flatMap((entry) => entry.pages),
  }
}
