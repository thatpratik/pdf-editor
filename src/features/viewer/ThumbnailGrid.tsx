import { useMemo } from 'react'
import type { PDFDocumentProxy } from '../../lib/pdf'
import { PageThumbnail } from './PageThumbnail'

interface ThumbnailGridProps {
  doc: PDFDocumentProxy
  pageCount: number
  selectedPage: number | null
  onSelect: (pageNumber: number) => void
}

/** Grid of one thumbnail per page, in page order. Clicking a thumbnail selects it. */
export function ThumbnailGrid({ doc, pageCount, selectedPage, onSelect }: ThumbnailGridProps) {
  const pageNumbers = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount])

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {pageNumbers.map((pageNumber) => (
        <PageThumbnail
          key={pageNumber}
          doc={doc}
          pageNumber={pageNumber}
          isSelected={pageNumber === selectedPage}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
