/**
 * Shared pdf.js wrapper.
 *
 * pdf.js does its parsing/rendering work on a web worker. Vite needs an
 * explicit, bundler-resolvable URL for that worker script — pointing
 * `GlobalWorkerOptions.workerSrc` at a bare package path (as pdf.js's own
 * docs do for plain <script> usage) does not work once the app is bundled.
 *
 * The `?url` suffix is Vite's built-in way to import an asset as a final
 * URL string instead of inlining it: in dev it resolves to the file served
 * by the dev server, and in a production build Vite copies the worker file
 * into the output directory (content-hashed) and rewrites the string to
 * point at it. This keeps the worker version locked to whatever version of
 * pdfjs-dist is installed, with no manual copying or CDN dependency.
 *
 * Everything in this app that needs pdf.js should import it from here
 * rather than importing `pdfjs-dist` directly, so the worker is always
 * configured before it's used.
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { PageViewport, PDFDocumentProxy as PDFJSDocumentProxy, RenderTask } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc

/**
 * The document handle returned by {@link loadPdfDocument}.
 *
 * As of pdfjs-dist 6.x, `.destroy()` lives on the `PDFDocumentLoadingTask`
 * that `getDocument()` returns *before* it resolves — the resolved
 * `PDFDocumentProxy` itself has no `destroy` method (this is a real change
 * from older pdf.js versions/examples, not just a typings gap; calling
 * `.destroy()` on a bare `PDFDocumentProxy` throws at runtime). It's easy to
 * hold onto the proxy and lose the loading task, silently leaking the
 * worker-side document. `loadPdfDocument` keeps the loading task alive in
 * closure and attaches its `destroy()` onto the resolved proxy, so callers
 * get one object that both renders pages and disposes of itself.
 */
export type PDFDocumentProxy = PDFJSDocumentProxy & {
  /** Releases worker-side resources (parsed document, cached pages, etc.) for this document. */
  destroy: () => Promise<void>
}

/**
 * Anything a loaded PDF can come from in the browser: a file picker's
 * `<input type="file">` (`File`, which itself extends `Blob`) or a
 * drag-and-drop drop event's payload.
 */
export type PdfSource = Blob

/**
 * Loads a PDF into a pdf.js document handle.
 *
 * The handle holds worker-side resources (the parsed document, cached
 * pages, etc.) for as long as it's kept around. When it's no longer needed
 * — the file is replaced or removed — call `.destroy()` on it, which is
 * part of the returned `PDFDocumentProxy` itself; no extra helper needed.
 */
export async function loadPdfDocument(source: PdfSource): Promise<PDFDocumentProxy> {
  const data = await source.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data })
  const doc = await loadingTask.promise
  return Object.assign(doc, { destroy: () => loadingTask.destroy() })
}

/** Returns the number of pages in a loaded PDF document. */
export function getPageCount(doc: PDFDocumentProxy): number {
  return doc.numPages
}

/**
 * Handle for an in-flight (or already-settled) page render, returned by
 * {@link renderPageToCanvas}.
 */
export interface PageRenderHandle {
  /**
   * Resolves once the page has finished drawing to the canvas. If
   * `cancel()` is called — before the page has even loaded, or mid-render —
   * this resolves rather than rejecting, so callers that just want to await
   * "the latest render" don't need to special-case cancellation. A genuine
   * rendering error (anything other than cancellation) still rejects.
   */
  promise: Promise<void>
  /**
   * Cancels the render. Safe to call at any point: before the page has
   * loaded, mid-render, or after it has already settled (a no-op then).
   * Call this when a newer render supersedes this one, or when whatever
   * requested it unmounts — otherwise pdf.js keeps drawing onto a canvas
   * nobody's watching, and rapid re-renders onto the same canvas throw
   * ("Cannot use the same canvas during multiple render() operations").
   */
  cancel: () => void
}

/**
 * Renders one page of a loaded PDF document onto an existing canvas at the
 * given scale (1 = pdf.js's default size, 72 CSS pixels per PDF point;
 * pass a larger value — e.g. folding in `window.devicePixelRatio` — for a
 * sharper result on HiDPI screens). The canvas's backing-store
 * `width`/`height` are set to match the rendered page.
 *
 * `pageNumber` is 1-based, matching pdf.js convention.
 *
 * Only one render may run on a given canvas at a time — if a previous
 * render on this canvas is still in flight, `cancel()` it before calling
 * this again.
 *
 * `additionalRotation` is added on top of the page's own baked-in rotation
 * (`page.rotate`), not a replacement for it — this is what lets a page that
 * already has some rotation in the source file, plus a further rotation
 * applied in this session, render correctly as their sum.
 */
/**
 * Resolves the viewport a page would render at for the given scale and
 * additional rotation — the same computation `renderPageToCanvas` uses
 * internally. Exposed separately so callers that need to convert PDF-space
 * coordinates into on-screen pixels (e.g. positioning a text-edit overlay
 * atop the rendered canvas) use the exact same transform the canvas itself
 * was drawn with, rather than re-deriving it.
 */
export async function getPageViewport(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  additionalRotation: 0 | 90 | 180 | 270 = 0,
): Promise<PageViewport> {
  const page = await doc.getPage(pageNumber)
  return page.getViewport({ scale, rotation: (page.rotate + additionalRotation) % 360 })
}

export function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  additionalRotation: 0 | 90 | 180 | 270 = 0,
): PageRenderHandle {
  let cancelled = false
  let renderTask: RenderTask | null = null

  const promise = (async () => {
    const page = await doc.getPage(pageNumber)
    if (cancelled) return

    const viewport = page.getViewport({ scale, rotation: (page.rotate + additionalRotation) % 360 })
    canvas.width = viewport.width
    canvas.height = viewport.height

    renderTask = page.render({ canvas, viewport })
    try {
      await renderTask.promise
    } catch (error) {
      // A cancelled render rejects with this; treat it as the expected,
      // silent outcome of cancel() rather than an error callers must
      // handle. Anything else is a real failure and should still surface.
      if (!(error instanceof pdfjsLib.RenderingCancelledException)) {
        throw error
      }
    }
  })()

  return {
    promise,
    cancel: () => {
      cancelled = true
      renderTask?.cancel()
    },
  }
}
