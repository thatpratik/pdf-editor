import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceProvider } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'
import { loadSourceFiles } from './loadSourceFiles'
import { buildPdf, downloadBytes, splitIntoRanges } from '../../lib/pdfExport'
import { zipPdfs } from '../../lib/zip'
import { downloadBlob } from '../../lib/download'
import { UploadDropzone } from './UploadDropzone'
import { ThumbnailGrid } from './ThumbnailGrid'
import { PagePreview } from './PagePreview'
import { Spinner } from './Spinner'
import { ThemeToggle } from './ThemeToggle'
import { ConfirmDialog } from './ConfirmDialog'

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
  // Pages after which a split boundary is marked — same "transient UI state,
  // not history" reasoning as selectedForExtractIds above.
  const [splitAfterPageIds, setSplitAfterPageIds] = useState<Set<string>>(new Set())
  const [isSplitting, setIsSplitting] = useState(false)
  // Whether the once-per-session edit disclosure (edited/covered text or
  // images aren't truly removed from the file) has been shown yet — shared
  // between TextEditDialog and ImageEditDialog, since it's the same
  // underlying limitation either way.
  const [hasSeenEditCaveat, setHasSeenEditCaveat] = useState(false)
  const [isConfirmingClearAll, setIsConfirmingClearAll] = useState(false)

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

  const performClearAll = useCallback(() => {
    sourceFiles.forEach((sourceFile) => sourceFile.doc.destroy())
    dispatch({ type: 'RESET' })
    setSelectedPageId(null)
    setSelectedForExtractIds(new Set())
    setSplitAfterPageIds(new Set())
    setUploadStatus('idle')
    setUploadError(null)
    setIsConfirmingClearAll(false)
  }, [dispatch, sourceFiles])

  const handleClearAll = useCallback(() => {
    if (pages.length > 0) {
      setIsConfirmingClearAll(true)
      return
    }
    performClearAll()
  }, [pages.length, performClearAll])

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
      setSplitAfterPageIds((current) => {
        const remaining = pages.filter((page) => page.id !== pageId)
        const newLastPageId = remaining[remaining.length - 1]?.id
        // Drop the deleted page's own mark, and drop a mark on whichever
        // page now becomes the last one — splitting after the last page is
        // meaningless (there'd be nothing left to split into a new file).
        if (!current.has(pageId) && !(newLastPageId && current.has(newLastPageId))) return current
        const next = new Set(current)
        next.delete(pageId)
        if (newLastPageId) next.delete(newLastPageId)
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

  const handleToggleSplitAfter = useCallback((pageId: string) => {
    setSplitAfterPageIds((current) => {
      const next = new Set(current)
      if (next.has(pageId)) {
        next.delete(pageId)
      } else {
        next.add(pageId)
      }
      return next
    })
  }, [])

  const handleSplit = useCallback(async () => {
    setIsSplitting(true)
    setDownloadError(null)
    try {
      const ranges = splitIntoRanges(pages, splitAfterPageIds)
      const parts = await Promise.all(
        ranges.map(async (range, index) => ({
          name: `part-${index + 1}.pdf`,
          bytes: await buildPdf(sourceFiles, range),
        })),
      )
      const zipBlob = await zipPdfs(parts)
      downloadBlob(zipBlob, 'split-output.zip')
    } catch {
      setDownloadError(DOWNLOAD_ERROR)
    } finally {
      setIsSplitting(false)
    }
  }, [sourceFiles, pages, splitAfterPageIds])

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

  // Computed from the actual partition rather than `splitAfterPageIds.size + 1`
  // so the label can never overstate the file count (e.g. a stray mark on
  // what's now the last page splits into nothing extra).
  const splitFileCount = splitAfterPageIds.size > 0 ? splitIntoRanges(pages, splitAfterPageIds).length : 0

  const sourceFilesById = new Map(sourceFiles.map((sourceFile) => [sourceFile.id, sourceFile]))
  const selectedIndex = pages.findIndex((page) => page.id === selectedPageId)
  const selectedPage = selectedIndex === -1 ? null : pages[selectedIndex]
  const selectedSourceFile = selectedPage
    ? (sourceFilesById.get(selectedPage.sourceFileId) ?? null)
    : null
  const selectedDoc = selectedSourceFile?.doc ?? null

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex shrink-0 items-center justify-between border-b border-ink/10 bg-surface px-6 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
          <div>
            <h1 className="font-display text-xl tracking-tight text-ink">PDF Editor</h1>
            {pages.length > 0 && (
              <p className="font-mono text-xs text-ink/45">
                {sourceFiles.length} {sourceFiles.length === 1 ? 'file' : 'files'} ·{' '}
                {pages.length} {pages.length === 1 ? 'page' : 'pages'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(canUndo || canRedo) && (
            <div className="mr-2 flex items-center gap-0.5 border-r border-ink/10 pr-2">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Undo"
                title="Undo (Ctrl/Cmd+Z)"
                className="rounded-md px-2 py-1.5 text-sm font-medium text-ink/55 hover:bg-ink/6 hover:text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-ink/25 disabled:hover:bg-transparent"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Redo"
                title="Redo (Ctrl/Cmd+Shift+Z)"
                className="rounded-md px-2 py-1.5 text-sm font-medium text-ink/55 hover:bg-ink/6 hover:text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-ink/25 disabled:hover:bg-transparent"
              >
                Redo
              </button>
            </div>
          )}
          {pages.length > 0 && (
            <>
              {selectedForExtractIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleExtractSelected}
                  disabled={isExtracting}
                  className="rounded-md border border-accent/40 px-3.5 py-2 text-sm font-medium text-accent hover:bg-accent/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:border-ink/15 disabled:text-ink/30 disabled:hover:bg-transparent"
                >
                  {isExtracting
                    ? 'Extracting…'
                    : `Extract selected (${selectedForExtractIds.size})`}
                </button>
              )}
              {splitFileCount > 1 && (
                <button
                  type="button"
                  onClick={handleSplit}
                  disabled={isSplitting}
                  className="rounded-md border border-accent/40 px-3.5 py-2 text-sm font-medium text-accent hover:bg-accent/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:border-ink/15 disabled:text-ink/30 disabled:hover:bg-transparent"
                >
                  {isSplitting ? 'Splitting…' : `Split into ${splitFileCount} files`}
                </button>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={isExporting}
                className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-accent-fill/40"
              >
                {isExporting ? 'Building…' : 'Download'}
              </button>
              <div className="ml-1 flex items-center gap-1 border-l border-ink/10 pl-3">
                <button
                  type="button"
                  onClick={() => addMoreInputRef.current?.click()}
                  disabled={uploadStatus === 'loading'}
                  className="rounded-md px-2 py-1.5 text-sm font-medium text-ink/55 hover:bg-ink/6 hover:text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-ink/25 disabled:hover:bg-transparent"
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
                  className="rounded-md px-2 py-1.5 text-sm font-medium text-ink/55 hover:bg-danger/8 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                >
                  Clear all
                </button>
              </div>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      {pages.length > 0 && uploadStatus === 'loading' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-ink/10 bg-accent/6 px-6 py-2 text-sm text-accent">
          <Spinner className="h-4 w-4" />
          <span>Loading new file(s)…</span>
        </div>
      )}
      {pages.length > 0 && uploadStatus === 'error' && uploadError && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/20 bg-danger/6 px-6 py-2 text-sm text-danger">
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
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/20 bg-danger/6 px-6 py-2 text-sm text-danger">
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
          <div className="flex h-full items-center justify-center gap-3 text-ink/70">
            <Spinner />
            <span className="text-base font-medium">Loading PDF…</span>
          </div>
        )}

        {pages.length === 0 && uploadStatus === 'error' && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md rounded-xl border border-danger/20 bg-danger/5 px-8 py-10 text-center shadow-sm">
              <p className="text-base font-medium text-danger">Couldn&apos;t open this file</p>
              <p className="mt-2 text-sm text-danger/80">{uploadError}</p>
              <button
                type="button"
                onClick={() => setUploadStatus('idle')}
                className="mt-6 rounded-md bg-danger-fill px-4 py-2 text-sm font-medium text-white hover:bg-danger-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
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
                splitAfterPageIds={splitAfterPageIds}
                onToggleSplitAfter={handleToggleSplitAfter}
              />
            </div>
            <aside className="w-[26rem] shrink-0 overflow-y-auto border-l border-ink/10 bg-surface p-6">
              {selectedPage && selectedDoc && selectedSourceFile && (
                <PagePreview
                  doc={selectedDoc}
                  page={selectedPage}
                  sourceFileName={selectedSourceFile.name}
                  position={selectedIndex + 1}
                  totalPages={pages.length}
                  onApplyTextEdit={(edit) =>
                    dispatch({ type: 'APPLY_TEXT_EDIT', pageId: selectedPage.id, edit })
                  }
                  onApplyImageEdit={(edit) =>
                    dispatch({ type: 'APPLY_IMAGE_EDIT', pageId: selectedPage.id, edit })
                  }
                  hasSeenEditCaveat={hasSeenEditCaveat}
                  onDismissEditCaveat={() => setHasSeenEditCaveat(true)}
                />
              )}
            </aside>
          </div>
        )}
      </main>

      {isConfirmingClearAll && (
        <ConfirmDialog
          title="Clear all files and pages?"
          description="This removes everything from the workspace. It can't be undone."
          confirmLabel="Clear all"
          danger
          onConfirm={performClearAll}
          onCancel={() => setIsConfirmingClearAll(false)}
        />
      )}
    </div>
  )
}
