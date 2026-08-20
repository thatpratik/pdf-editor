import { useCallback, useReducer } from 'react'

interface HistoryState<S> {
  past: S[]
  present: S
  future: S[]
}

type HistoryAction<S, A> =
  | { type: '__ACTION__'; action: A }
  | { type: '__UNDO__' }
  | { type: '__REDO__' }
  | { type: '__RESET__'; state: S }

export interface UseHistoryReducerResult<S, A> {
  state: S
  dispatch: (action: A) => void
  /** Replaces the current state with a fresh one, clearing all history — for hard resets that shouldn't be undoable. */
  reset: (state: S) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

function historyReducer<S, A>(
  reducer: (state: S, action: A) => S,
  history: HistoryState<S>,
  action: HistoryAction<S, A>,
): HistoryState<S> {
  switch (action.type) {
    case '__ACTION__': {
      const nextPresent = reducer(history.present, action.action)
      if (nextPresent === history.present) return history
      return { past: [...history.past, history.present], present: nextPresent, future: [] }
    }
    case '__UNDO__': {
      if (history.past.length === 0) return history
      const previous = history.past[history.past.length - 1]
      return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    }
    case '__REDO__': {
      if (history.future.length === 0) return history
      const [next, ...rest] = history.future
      return { past: [...history.past, history.present], present: next, future: rest }
    }
    case '__RESET__':
      return { past: [], present: action.state, future: [] }
    default:
      return history
  }
}

/**
 * Wraps a plain `(state, action) => state` reducer with a flat past/future
 * snapshot history — basic undo/redo, not a command pattern with per-action
 * inverses, per the PRD's "nothing more than that" scope for v1.
 */
export function useHistoryReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
): UseHistoryReducerResult<S, A> {
  const [history, dispatchHistory] = useReducer(
    (history: HistoryState<S>, action: HistoryAction<S, A>) => historyReducer(reducer, history, action),
    { past: [], present: initial, future: [] },
  )

  const dispatch = useCallback((action: A) => dispatchHistory({ type: '__ACTION__', action }), [])
  const reset = useCallback((state: S) => dispatchHistory({ type: '__RESET__', state }), [])
  const undo = useCallback(() => dispatchHistory({ type: '__UNDO__' }), [])
  const redo = useCallback(() => dispatchHistory({ type: '__REDO__' }), [])

  return {
    state: history.present,
    dispatch,
    reset,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}
