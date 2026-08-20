import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { pagesReducer } from './workspaceReducer'
import type { WorkspaceAction } from './workspaceReducer'
import type { SourceFile, WorkingPage, WorkspaceState } from './types'
import { useHistoryReducer } from './useHistoryReducer'
import { WorkspaceContext } from './useWorkspace'

/**
 * Owns `WorkspaceState`, split into two independently-managed pieces:
 * `sourceFiles` (plain state, append-only, never undoable) and `pages`
 * (wrapped in `useHistoryReducer` for undo/redo). `dispatch` still accepts
 * the same `WorkspaceAction` shape the rest of the app already dispatches —
 * this component is the only place that knows the state is actually split.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([])
  const {
    state: pages,
    dispatch: dispatchPages,
    reset: resetPages,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistoryReducer(pagesReducer, [] as WorkingPage[])

  const dispatch = useCallback(
    (action: WorkspaceAction) => {
      switch (action.type) {
        case 'ADD_FILES':
          setSourceFiles((current) => [...current, ...action.files])
          dispatchPages({ type: 'ADD_PAGES', pages: action.pages })
          break
        case 'RESET':
          setSourceFiles([])
          resetPages([])
          break
        default:
          dispatchPages(action)
          break
      }
    },
    [dispatchPages, resetPages],
  )

  const state: WorkspaceState = { sourceFiles, pages }

  return (
    <WorkspaceContext.Provider value={{ state, dispatch, undo, redo, canUndo, canRedo }}>
      {children}
    </WorkspaceContext.Provider>
  )
}
