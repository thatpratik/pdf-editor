import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { PDFDocumentProxy } from '../../lib/pdf'
import type { PageEdit, WorkingPage } from './types'
import { PagePreview } from './PagePreview'

type TextEdit = Extract<PageEdit, { type: 'text' }>
type ImageEdit = Extract<PageEdit, { type: 'image' }>

interface PagePreviewListProps {
  pages: WorkingPage[]
  docsBySourceFileId: Map<string, PDFDocumentProxy>
  sourceFileNamesById: Map<string, string>
  selectedPageId: string | null
  onSelect: (pageId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onApplyTextEdit: (pageId: string, edit: TextEdit) => void
  onApplyImageEdit: (pageId: string, edit: ImageEdit) => void
  hasSeenEditCaveat: boolean
  onDismissEditCaveat: () => void
}

/**
 * Full-file preview: every working page rendered at readable size in one
 * scrollable column, each draggable to reorder — the same
 * `REORDER_PAGES` action `ThumbnailGrid` dispatches, so reordering works
 * from whichever view is more convenient at the time, not just the compact
 * grid on the left.
 */
export function PagePreviewList({
  pages,
  docsBySourceFileId,
  sourceFileNamesById,
  selectedPageId,
  onSelect,
  onReorder,
  onApplyTextEdit,
  onApplyImageEdit,
  hasSeenEditCaveat,
  onDismissEditCaveat,
}: PagePreviewListProps) {
  // A small drag-activation distance lets a plain click still select/edit a
  // page instead of every click being interpreted as a drag start.
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
      <SortableContext items={pages.map((page) => page.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-6">
          {pages.map((page, index) => {
            const doc = docsBySourceFileId.get(page.sourceFileId)
            if (!doc) return null
            return (
              <PagePreview
                key={page.id}
                doc={doc}
                page={page}
                sourceFileName={sourceFileNamesById.get(page.sourceFileId) ?? ''}
                position={index + 1}
                totalPages={pages.length}
                isSelected={page.id === selectedPageId}
                onSelect={onSelect}
                onApplyTextEdit={(edit) => onApplyTextEdit(page.id, edit)}
                onApplyImageEdit={(edit) => onApplyImageEdit(page.id, edit)}
                hasSeenEditCaveat={hasSeenEditCaveat}
                onDismissEditCaveat={onDismissEditCaveat}
              />
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
