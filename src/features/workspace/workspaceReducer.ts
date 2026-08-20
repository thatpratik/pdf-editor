import type { SourceFile, WorkingPage, WorkspaceState } from './types'

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

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = items.slice()
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'ADD_FILES':
      return {
        sourceFiles: [...state.sourceFiles, ...action.files],
        pages: [...state.pages, ...action.pages],
      }
    case 'REORDER_PAGES':
      return {
        ...state,
        pages: moveItem(state.pages, action.fromIndex, action.toIndex),
      }
    case 'DELETE_PAGE':
      return {
        ...state,
        pages: state.pages.filter((page) => page.id !== action.pageId),
      }
    case 'ROTATE_PAGE':
      return {
        ...state,
        pages: state.pages.map((page) =>
          page.id === action.pageId
            ? { ...page, rotation: (((page.rotation + action.delta + 360) % 360) as 0 | 90 | 180 | 270) }
            : page,
        ),
      }
    case 'RESET':
      return initialWorkspaceState
    default:
      return state
  }
}
