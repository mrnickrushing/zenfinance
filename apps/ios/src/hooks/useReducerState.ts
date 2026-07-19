import { useReducer, type Dispatch, type SetStateAction } from 'react';

/** A reducer-backed drop-in for independent local values during App modularization. */
export function useReducerState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, dispatch] = useReducer(
    (current: T, action: SetStateAction<T>): T =>
      typeof action === 'function' ? (action as (previous: T) => T)(current) : action,
    initialState,
    (initial) => typeof initial === 'function' ? (initial as () => T)() : initial,
  );
  return [state, dispatch];
}
