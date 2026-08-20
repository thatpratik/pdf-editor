import { createContext, useContext } from 'react'
import type { Dispatch } from 'react'
import type { WorkspaceAction } from './workspaceReducer'
import type { WorkspaceState } from './types'

export interface WorkspaceContextValue {
  state: WorkspaceState
  dispatch: Dispatch<WorkspaceAction>
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return context
}
