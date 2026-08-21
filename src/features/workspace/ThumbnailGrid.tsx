import { useMemo } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import type { SourceFile, WorkingPage } from './types'
import { PageThumbnail } from './PageThumbnail'

interface ThumbnailGridProps {
  sourceFiles: SourceFile[]
  pages: WorkingPage[]
  selectedPageId: string | null
  onSelect: (pageId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onRotate: (pageId: string) => void
  onDelete: (pageId: string) => void
  selectedForExtractIds: Set<string>
  onToggleExtract: (pageId: string) => void
  splitAfterPageIds: Set<string>
  onToggleSplitAfter: (pageId: string) => void
}

/**
 * Grid of one thumbnail per working page, in current working-set order.
 * Pages can be dragged into any order, including across the source files
 * they originally came from — the flat `pages` array makes that a plain
 * array move, with no cross-file special case.
 */
export function ThumbnailGrid({
  sourceFiles,
  pages,
  selectedPageId,
  onSelect,
  onReorder,
  onRotate,
  onDelete,
  selectedForExtractIds,
  onToggleExtract,
  splitAfterPageIds,
  onToggleSplitAfter,
}: ThumbnailGridProps) {
  const docsBySourceFileId = useMemo(
    () => new Map(sourceFiles.map((sourceFile) => [sourceFile.id, sourceFile.doc])),
    [sourceFiles],
  )

  // A small drag-activation distance lets a plain click still select the
  // thumbnail instead of every click being interpreted as a drag start.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const fromIndex = pages.findIndex((page) => page.id === active.id)
    const toIndex = pages.findIndex((page) => page.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return

    onReorder(fromIndex, toIndex)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {pages.map((page, index) => {
            const doc = docsBySourceFileId.get(page.sourceFileId)
            if (!doc) return null
            return (
              <PageThumbnail
                key={page.id}
                page={page}
                doc={doc}
                isSelected={page.id === selectedPageId}
                onSelect={onSelect}
                onRotate={onRotate}
                onDelete={onDelete}
                isSelectedForExtract={selectedForExtractIds.has(page.id)}
                onToggleExtract={onToggleExtract}
                isSplitAfter={splitAfterPageIds.has(page.id)}
                onToggleSplitAfter={onToggleSplitAfter}
                isLastPage={index === pages.length - 1}
              />
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
