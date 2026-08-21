import type { PageEdit, PdfRect, SourceFile, WorkingPage, WorkspaceState } from './types'

type TextEdit = Extract<PageEdit, { type: 'text' }>
type ImageEdit = Extract<PageEdit, { type: 'image' }>

/**
 * The dispatch-facing action type consumed by the rest of the app (via
 * `useWorkspace().dispatch`) — unchanged in shape across Phase 4's history
 * refactor, so call sites in `Workspace.tsx` needed no changes.
 */
export type WorkspaceAction =
  | { type: 'ADD_FILES'; files: SourceFile[]; pages: WorkingPage[] }
  | { type: 'REORDER_PAGES'; fromIndex: number; toIndex: number }
  | { type: 'DELETE_PAGE'; pageId: string }
  | { type: 'ROTATE_PAGE'; pageId: string; delta: 90 | -90 }
  | { type: 'APPLY_TEXT_EDIT'; pageId: string; edit: TextEdit }
  | { type: 'APPLY_IMAGE_EDIT'; pageId: string; edit: ImageEdit }
  | { type: 'RESET' }

export const initialWorkspaceState: WorkspaceState = {
  sourceFiles: [],
  pages: [],
}

/**
 * The subset of `WorkspaceAction` that only ever touches `pages` — this is
 * what's wrapped in undo/redo history by `useHistoryReducer`. `sourceFiles`
 * is intentionally not part of this slice (see `WorkspaceContext.tsx`):
 * uploading more files is additive and isn't something users asked to
 * undo, and undoing past a file being added would orphan pages referencing
 * it for no real benefit.
 */
export type PagesAction =
  | { type: 'ADD_PAGES'; pages: WorkingPage[] }
  | { type: 'REORDER_PAGES'; fromIndex: number; toIndex: number }
  | { type: 'DELETE_PAGE'; pageId: string }
  | { type: 'ROTATE_PAGE'; pageId: string; delta: 90 | -90 }
  | { type: 'APPLY_TEXT_EDIT'; pageId: string; edit: TextEdit }
  | { type: 'APPLY_IMAGE_EDIT'; pageId: string; edit: ImageEdit }

function sameRect(a: PdfRect, b: PdfRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Adds an image edit, or — if this page already has an edit for the same
 * original image (matched by `originalBoundingBox`, which stays constant
 * across repeated interactions with one image) — replaces it instead of
 * stacking a second one. Without this, dragging an image and then resizing
 * it would produce two edits: the drag's, which draws the image at its
 * dragged position, and the resize's, which only occludes the image's
 * *original* spot (since that's what `originalBoundingBox` always refers
 * to) — leaving the drag's now-stale copy still drawn underneath. Replacing
 * in place means there's always at most one edit per original image, so
 * `buildPdf` only ever draws its current, final state.
 */
function upsertImageEdit(edits: PageEdit[], edit: ImageEdit): PageEdit[] {
  const existingIndex = edits.findIndex(
    (existing) => existing.type === 'image' && sameRect(existing.originalBoundingBox, edit.originalBoundingBox),
  )
  if (existingIndex === -1) return [...edits, edit]
  const next = edits.slice()
  next[existingIndex] = edit
  return next
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = items.slice()
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export function pagesReducer(pages: WorkingPage[], action: PagesAction): WorkingPage[] {
  switch (action.type) {
    case 'ADD_PAGES':
      return [...pages, ...action.pages]
    case 'REORDER_PAGES':
      return moveItem(pages, action.fromIndex, action.toIndex)
    case 'DELETE_PAGE':
      return pages.filter((page) => page.id !== action.pageId)
    case 'ROTATE_PAGE':
      return pages.map((page) =>
        page.id === action.pageId
          ? {
              ...page,
              rotation: ((page.rotation + action.delta + 360) % 360) as 0 | 90 | 180 | 270,
            }
          : page,
      )
    case 'APPLY_TEXT_EDIT':
      return pages.map((page) =>
        page.id === action.pageId ? { ...page, edits: [...page.edits, action.edit] } : page,
      )
    case 'APPLY_IMAGE_EDIT':
      return pages.map((page) =>
        page.id === action.pageId
          ? { ...page, edits: upsertImageEdit(page.edits, action.edit) }
          : page,
      )
    default:
      return pages
  }
}
