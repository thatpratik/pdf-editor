import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { initialWorkspaceState, workspaceReducer } from './workspaceReducer'
import { WorkspaceContext } from './useWorkspace'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState)
  return <WorkspaceContext.Provider value={{ state, dispatch }}>{children}</WorkspaceContext.Provider>
}
