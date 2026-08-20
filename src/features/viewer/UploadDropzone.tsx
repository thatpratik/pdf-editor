import { useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

interface UploadDropzoneProps {
  onFileSelected: (file: File) => void
}

/**
 * The empty/prompt state shown before any file is loaded: a click-to-browse
 * and drag-and-drop target for picking a single PDF from disk.
 */
export function UploadDropzone({ onFileSelected }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const openPicker = () => inputRef.current?.click()

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragActive(false)
    const file = event.dataTransfer.files[0]
    if (file) onFileSelected(file)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
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
        className={`flex w-full max-w-lg cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-10 py-16 text-center transition ${
          isDragActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-10 w-10 text-slate-400"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
          />
        </svg>
        <p className="text-base font-medium text-slate-700">
          Drop a PDF here, or click to choose a file
        </p>
        <p className="text-sm text-slate-400">
          Your file stays in this browser — nothing is uploaded.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onFileSelected(file)
          }}
        />
      </div>
    </div>
  )
}
