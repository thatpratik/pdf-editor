import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceProvider } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'
import { loadSourceFiles } from './loadSourceFiles'
import { buildPdf, downloadBytes } from '../../lib/pdfExport'
import { UploadDropzone } from './UploadDropzone'
import { ThumbnailGrid } from './ThumbnailGrid'
import { PagePreview } from './PagePreview'
import { Spinner } from './Spinner'

type UploadStatus = 'idle' | 'loading' | 'error'

const GENERIC_LOAD_ERROR =
  "One of these files couldn't be opened. It may not be a valid PDF, or the file may be corrupted."
const DOWNLOAD_ERROR = "Couldn't build the PDF. Please try again."

/**
 * The app's current screen: upload one or more PDFs, then browse their
 * pooled pages as one thumbnail grid — reorderable by drag, including
 * across the files they came from — with a larger preview of whichever
 * page is selected. Uploading is additive; no editing or export yet.
 */
export function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceScreen />
    </WorkspaceProvider>
  )
}

function WorkspaceScreen() {
  const { state, dispatch, undo, redo, canUndo, canRedo } = useWorkspace()
  const { sourceFiles, pages } = state

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // Which pages are checked for extraction — transient UI state, not part of
  // WorkspaceState/history: it isn't something a user needs to undo.
  const [selectedForExtractIds, setSelectedForExtractIds] = useState<Set<string>>(new Set())
  const [isExtracting, setIsExtracting] = useState(false)

  const addMoreInputRef = useRef<HTMLInputElement>(null)

  // Keeps the latest source files reachable from the unmount cleanup below
  // without making that effect re-run every time files are added.
  const sourceFilesRef = useRef(sourceFiles)
  useEffect(() => {
    sourceFilesRef.current = sourceFiles
  }, [sourceFiles])

  useEffect(() => {
    return () => {
      sourceFilesRef.current.forEach((sourceFile) => sourceFile.doc.destroy())
    }
  }, [])

  // Cmd/Ctrl+Z to undo, Cmd/Ctrl+Shift+Z to redo — scoped to this screen for
  // as long as it's mounted.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.metaKey || event.ctrlKey
      if (!isModifierPressed || event.key.toLowerCase() !== 'z') return

      event.preventDefault()
      if (event.shiftKey) {
        redo()
      } else {
        undo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      setUploadStatus('loading')
      setUploadError(null)

      loadSourceFiles(files)
        .then(({ sourceFiles: newSourceFiles, pages: newPages }) => {
          dispatch({ type: 'ADD_FILES', files: newSourceFiles, pages: newPages })
          setSelectedPageId((current) => current ?? newPages[0]?.id ?? current)
          setUploadStatus('idle')
        })
        .catch(() => {
          setUploadStatus('error')
          setUploadError(GENERIC_LOAD_ERROR)
        })
    },
    [dispatch],
  )

  const handleClearAll = useCallback(() => {
    if (pages.length > 0 && !window.confirm('Clear all files and pages? This can’t be undone.')) {
      return
    }
    sourceFiles.forEach((sourceFile) => sourceFile.doc.destroy())
    dispatch({ type: 'RESET' })
    setSelectedPageId(null)
    setSelectedForExtractIds(new Set())
    setUploadStatus('idle')
    setUploadError(null)
  }, [dispatch, pages.length, sourceFiles])

  const handleRotatePage = useCallback(
    (pageId: string) => {
      dispatch({ type: 'ROTATE_PAGE', pageId, delta: 90 })
    },
    [dispatch],
  )

  const handleDeletePage = useCallback(
    (pageId: string) => {
      dispatch({ type: 'DELETE_PAGE', pageId })
      setSelectedPageId((current) => {
        if (current !== pageId) return current
        const index = pages.findIndex((page) => page.id === pageId)
        const remaining = pages.filter((page) => page.id !== pageId)
        return remaining.length === 0 ? null : remaining[Math.min(index, remaining.length - 1)].id
      })
      setSelectedForExtractIds((current) => {
        if (!current.has(pageId)) return current
        const next = new Set(current)
        next.delete(pageId)
        return next
      })
    },
    [dispatch, pages],
  )

  const handleToggleExtract = useCallback((pageId: string) => {
    setSelectedForExtractIds((current) => {
      const next = new Set(current)
      if (next.has(pageId)) {
        next.delete(pageId)
      } else {
        next.add(pageId)
      }
      return next
    })
  }, [])

  const handleExtractSelected = useCallback(async () => {
    setIsExtracting(true)
    setDownloadError(null)
    try {
      const selectedPages = pages.filter((page) => selectedForExtractIds.has(page.id))
      const bytes = await buildPdf(sourceFiles, selectedPages)
      downloadBytes(bytes, 'extracted.pdf')
    } catch {
      setDownloadError(DOWNLOAD_ERROR)
    } finally {
      setIsExtracting(false)
    }
  }, [sourceFiles, pages, selectedForExtractIds])

  const handleDownload = useCallback(async () => {
    setIsExporting(true)
    setDownloadError(null)
    try {
      const bytes = await buildPdf(sourceFiles, pages)
      downloadBytes(bytes, 'merged.pdf')
    } catch {
      setDownloadError(DOWNLOAD_ERROR)
    } finally {
      setIsExporting(false)
    }
  }, [sourceFiles, pages])

  const docsBySourceFileId = new Map(
    sourceFiles.map((sourceFile) => [sourceFile.id, sourceFile.doc]),
  )
  const selectedIndex = pages.findIndex((page) => page.id === selectedPageId)
  const selectedPage = selectedIndex === -1 ? null : pages[selectedIndex]
  const selectedDoc = selectedPage
    ? (docsBySourceFileId.get(selectedPage.sourceFileId) ?? null)
    : null

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">PDF Editor</h1>
          {pages.length > 0 && (
            <p className="text-xs text-slate-500">
              {sourceFiles.length} {sourceFiles.length === 1 ? 'file' : 'files'} · {pages.length}{' '}
              {pages.length === 1 ? 'page' : 'pages'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {(canUndo || canRedo) && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Undo"
                title="Undo (Ctrl/Cmd+Z)"
                className="rounded px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Redo"
                title="Redo (Ctrl/Cmd+Shift+Z)"
                className="rounded px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
              >
                Redo
              </button>
            </div>
          )}
          {pages.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isExporting}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {isExporting ? 'Building…' : 'Download'}
              </button>
              {selectedForExtractIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleExtractSelected}
                  disabled={isExtracting}
                  className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-blue-300 disabled:text-blue-300 disabled:hover:bg-transparent"
                >
                  {isExtracting
                    ? 'Extracting…'
                    : `Extract selected (${selectedForExtractIds.size})`}
                </button>
              )}
              <button
                type="button"
                onClick={() => addMoreInputRef.current?.click()}
                disabled={uploadStatus === 'loading'}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                Add more files
              </button>
              <input
                ref={addMoreInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  if (files.length > 0) handleFilesSelected(files)
                }}
              />
              <button
                type="button"
                onClick={handleClearAll}
                className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      </header>

      {pages.length > 0 && uploadStatus === 'loading' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-blue-50 px-6 py-2 text-sm text-blue-700">
          <Spinner className="h-4 w-4" />
          <span>Loading new file(s)…</span>
        </div>
      )}
      {pages.length > 0 && uploadStatus === 'error' && uploadError && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadStatus('idle')}
            className="font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {downloadError && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          <span>{downloadError}</span>
          <button
            type="button"
            onClick={() => setDownloadError(null)}
            className="font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1">
        {pages.length === 0 && uploadStatus !== 'loading' && uploadStatus !== 'error' && (
          <UploadDropzone onFilesSelected={handleFilesSelected} />
        )}

        {pages.length === 0 && uploadStatus === 'loading' && (
          <div className="flex h-full items-center justify-center gap-3 text-slate-500">
            <Spinner />
            <span>Loading PDF…</span>
          </div>
        )}

        {pages.length === 0 && uploadStatus === 'error' && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md rounded-xl border border-red-200 bg-red-50 px-8 py-10 text-center">
              <p className="text-base font-medium text-red-700">Couldn&apos;t open this file</p>
              <p className="mt-2 text-sm text-red-600">{uploadError}</p>
              <button
                type="button"
                onClick={() => setUploadStatus('idle')}
                className="mt-6 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Try another file
              </button>
            </div>
          </div>
        )}

        {pages.length > 0 && (
          <div className="flex h-full">
            <div className="flex-1 overflow-y-auto p-6">
              <ThumbnailGrid
                sourceFiles={sourceFiles}
                pages={pages}
                selectedPageId={selectedPageId}
                onSelect={setSelectedPageId}
                onReorder={(fromIndex, toIndex) =>
                  dispatch({ type: 'REORDER_PAGES', fromIndex, toIndex })
                }
                onRotate={handleRotatePage}
                onDelete={handleDeletePage}
                selectedForExtractIds={selectedForExtractIds}
                onToggleExtract={handleToggleExtract}
              />
            </div>
            <aside className="w-[26rem] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-6">
              {selectedPage && selectedDoc && (
                <PagePreview
                  doc={selectedDoc}
                  page={selectedPage}
                  position={selectedIndex + 1}
                  totalPages={pages.length}
                />
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
