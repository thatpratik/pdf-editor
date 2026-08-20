import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { renderPageToCanvas } from '../../lib/pdf'
import type { WorkingPage } from './types'
import { Spinner } from './Spinner'

/** Scale (before device-pixel-ratio) used for the larger single-page preview. */
const PREVIEW_SCALE = 1.4

interface PagePreviewProps {
  doc: PDFDocumentProxy
  page: WorkingPage
  /** 1-based position of this page within the current working set. */
  position: number
  totalPages: number
}

/** Larger canvas render of the selected working page, shown in the side panel. */
export function PagePreview({ doc, page, position, totalPages }: PagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    setStatus('loading')
    const scale = PREVIEW_SCALE * (window.devicePixelRatio || 1)
    const handle = renderPageToCanvas(doc, page.sourcePageNumber, canvas, scale, page.rotation)

    handle.promise.then(() => setStatus('ready')).catch(() => setStatus('error'))

    return () => handle.cancel()
  }, [doc, page.sourcePageNumber, page.rotation])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-slate-700">
        Page {position} of {totalPages}
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
