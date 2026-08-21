import { useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { CornerMarks } from './CornerMarks'

interface UploadDropzoneProps {
  onFilesSelected: (files: File[]) => void
}

/**
 * The empty/prompt state shown before any file is loaded: a click-to-browse
 * and drag-and-drop target for picking one or more PDFs from disk.
 */
export function UploadDropzone({ onFilesSelected }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const openPicker = () => inputRef.current?.click()

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragActive(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFilesSelected(files)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-8">
      <div className="relative flex min-w-0 w-full max-w-xl flex-col items-center text-center">
        <h2 className="font-display text-3xl font-semibold tracking-[0.04em] text-ink uppercase md:text-4xl">
          Merge, split, reorder, edit
        </h2>
        <p className="mt-2 max-w-md text-base text-ink/60">
          Everything happens right here in your browser — your files are never uploaded
          anywhere.
        </p>

        <div
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragActive(true)
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={handleDrop}
          className={`lock-on relative mt-8 flex w-full cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed px-10 py-14 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
            isDragActive
              ? 'scale-[1.01] border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent),0_0_32px_-8px_var(--color-accent)]'
              : 'border-ink/20 bg-surface shadow-sm hover:border-accent/40 hover:bg-accent/[0.03]'
          }`}
        >
          {isDragActive && <CornerMarks />}
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-200 ${
              isDragActive ? 'bg-accent/15' : 'bg-accent/8'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-6 w-6 text-accent transition-colors duration-200"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
              />
            </svg>
          </div>
          <div>
            <p className="text-base font-medium text-ink/80">
              Drop PDFs here, or click to choose files
            </p>
            <p className="mt-1 text-sm text-ink/50">PDF files only, any number at once</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length > 0) onFilesSelected(files)
            }}
          />
        </div>
      </div>
    </div>
  )
}
