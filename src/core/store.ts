/**
 * The store, with no Electron in it at all.
 *
 * Keeping this file free of `import { ... } from "electron"` is a deliberate
 * architectural boundary, not tidiness. It means the state logic can be
 * exercised in a plain Node test process with no windows, no IPC and no
 * display server — and it means the same logic runs unchanged in the main
 * process and (later) inside each renderer's mirror.
 */

export type Listener<S> = (state: S) => void;

export type Reducer<S, A> = (state: S, action: A) => S;

export type Unsubscribe = () => void;

export interface Store<S, A> {
  /** Always synchronous. Never crosses a process boundary. */
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: Listener<S>): Unsubscribe;
}

export function createStore<S, A>(
  reducer: Reducer<S, A>,
  initialState: S,
): Store<S, A> {
  let state = initialState;
  const listeners = new Set<Listener<S>>();

  return {
    getState(): S {
      return state;
    },

    dispatch(action: A): void {
      state = reducer(state, action);

      // Iterate a copy. A listener is allowed to subscribe or unsubscribe
      // while being notified; mutating the live Set mid-iteration would
      // either skip a listener or notify a brand-new one about a change it
      // was never present for.
      for (const listener of [...listeners]) {
        listener(state);
      }
    },

    subscribe(listener: Listener<S>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
