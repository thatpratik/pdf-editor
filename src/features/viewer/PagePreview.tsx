import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { renderPageToCanvas } from '../../lib/pdf'
import { Spinner } from './Spinner'

/** Scale (before device-pixel-ratio) used for the larger single-page preview. */
const PREVIEW_SCALE = 1.4

interface PagePreviewProps {
  doc: PDFDocumentProxy
  pageNumber: number
  pageCount: number
}

/** Larger canvas render of one selected page, shown in the side panel. */
export function PagePreview({ doc, pageNumber, pageCount }: PagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    const scale = PREVIEW_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, pageNumber, canvas, scale)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))

    return () => handle.cancel()
  }, [doc, pageNumber])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-slate-700">
        Page {pageNumber} of {pageCount}
      </h2>
      <div className="relative flex min-h-96 items-center justify-center rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <canvas ref={canvasRef} className="max-h-[75vh] max-w-full rounded object-contain" />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
            <Spinner />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/90 px-6 text-center text-sm text-red-500">
            Couldn&apos;t render this page.
          </div>
        )}
      </div>
    </div>
  )
}
