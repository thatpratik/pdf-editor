import type { SourceFile, WorkingPage, WorkspaceState } from './types'

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
          ? { ...page, rotation: (((page.rotation + action.delta + 360) % 360) as 0 | 90 | 180 | 270) }
          : page,
      )
    default:
      return pages
  }
}
