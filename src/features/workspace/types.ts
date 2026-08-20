import type { PDFDocumentProxy } from '../../lib/pdf'

/** One uploaded PDF for this session. Append-only — nothing in the app removes a whole file. */
export interface SourceFile {
  id: string
  name: string
  /** Kept for re-reading raw bytes on export (pdf-lib needs bytes, not the pdf.js handle). */
  file: File
  /** pdf.js handle, used only for rendering (thumbnails/preview). */
  doc: PDFDocumentProxy
}

export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A text/image edit applied on top of a page's original content. Data, not a
 * live document mutation — added in Phase 7/8; unused until then.
 */
export type PageEdit =
  | { type: 'text'; boundingBox: PdfRect; newText: string; fontKey: string; fontSize: number }
  | {
      type: 'image'
      originalBoundingBox: PdfRect
      newBoundingBox: PdfRect | null
      imageBytes: Uint8Array
      imageFormat: 'jpg' | 'png'
    }

/** One page in the working set — the unit that the thumbnail grid, reorder, and export all operate on. */
export interface WorkingPage {
  /** Stable across reorders — used as the React key and the dnd-kit sortable id. */
  id: string
  sourceFileId: string
  /** 1-based page number within that source file; never changes. */
  sourcePageNumber: number
  /** Rotation added in this session, on top of whatever rotation the page already had. */
  rotation: 0 | 90 | 180 | 270
  edits: PageEdit[]
}

export interface WorkspaceState {
  sourceFiles: SourceFile[]
  pages: WorkingPage[]
}
