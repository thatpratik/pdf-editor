import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { getPageCount, loadPdfDocument } from '../../lib/pdf'
import { UploadDropzone } from './UploadDropzone'
import { ThumbnailGrid } from './ThumbnailGrid'
import { PagePreview } from './PagePreview'
import { Spinner } from './Spinner'

type Status = 'idle' | 'loading' | 'ready' | 'error'

const GENERIC_LOAD_ERROR =
  "This file couldn't be opened. It may not be a valid PDF, or the file may be corrupted."

/**
 * The app's current screen: upload a single PDF, then browse it as a
 * thumbnail grid with a larger preview of whichever page is selected.
 * View-only — no editing, no download.
 */
export function PdfViewer() {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [selectedPage, setSelectedPage] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Guards against a stale load resolving after a newer file was picked, or
  // after reset — holds the doc that's actually "current" for teardown.
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const loadTokenRef = useRef(0)

  const handleFileSelected = useCallback((file: File) => {
    const token = ++loadTokenRef.current
    setStatus('loading')
    setError(null)
    setFileName(file.name)
    setSelectedPage(null)

    loadPdfDocument(file)
      .then((loadedDoc) => {
        if (loadTokenRef.current !== token) {
          // A newer file was picked (or reset happened) while this was in
          // flight — discard it rather than replacing the current doc.
          loadedDoc.destroy()
          return
        }
        docRef.current?.destroy()
        docRef.current = loadedDoc
        setDoc(loadedDoc)
        setPageCount(getPageCount(loadedDoc))
        setSelectedPage(1)
        setStatus('ready')
      })
      .catch(() => {
        if (loadTokenRef.current !== token) return
        setStatus('error')
        setError(GENERIC_LOAD_ERROR)
      })
  }, [])

  const handleReset = useCallback(() => {
    loadTokenRef.current++ // invalidate any load still in flight
    docRef.current?.destroy()
    docRef.current = null
    setDoc(null)
    setPageCount(0)
    setSelectedPage(null)
    setFileName(null)
    setError(null)
    setStatus('idle')
  }, [])

  // Free worker-side resources if the component ever unmounts with a doc loaded.
  useEffect(() => {
    return () => {
      docRef.current?.destroy()
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">PDF Editor</h1>
          {fileName && (
            <p className="text-xs text-slate-500">
              {fileName}
              {status === 'ready' && ` · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
            </p>
          )}
        </div>
        {status !== 'idle' && (
          <button
            type="button"
            onClick={handleReset}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            Upload a different file
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1">
        {status === 'idle' && <UploadDropzone onFileSelected={handleFileSelected} />}

        {status === 'loading' && (
          <div className="flex h-full items-center justify-center gap-3 text-slate-500">
            <Spinner />
            <span>Loading PDF…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md rounded-xl border border-red-200 bg-red-50 px-8 py-10 text-center">
              <p className="text-base font-medium text-red-700">Couldn&apos;t open this file</p>
              <p className="mt-2 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={handleReset}
                className="mt-6 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Try another file
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && doc && (
          <div className="flex h-full">
            <div className="flex-1 overflow-y-auto p-6">
              <ThumbnailGrid
                doc={doc}
                pageCount={pageCount}
                selectedPage={selectedPage}
                onSelect={setSelectedPage}
              />
            </div>
            <aside className="w-[26rem] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-6">
              {selectedPage && (
                <PagePreview doc={doc} pageNumber={selectedPage} pageCount={pageCount} />
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
