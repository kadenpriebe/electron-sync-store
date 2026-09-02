import type { Listener, Store, Unsubscribe } from "../core/store";
import type { SyncStoreBridge } from "../preload";

declare global {
  interface Window {
    // Kept in sync by hand with BRIDGE_KEY in ../shared/protocol. An interface
    // member cannot be a computed name, so the literal is repeated here.
    __electronSyncStore: SyncStoreBridge;
  }
}

/**
 * The mirror: a full local copy of main's state, kept current by broadcast.
 *
 * This is what makes reads synchronous. `getState()` never touches IPC — it
 * returns a value already sitting in this renderer's memory. The cost is that
 * the copy is briefly stale: for roughly one IPC hop after a change, this
 * mirror still reports the previous value.
 *
 * Creating the store is itself synchronous. The preload has already fetched
 * the first snapshot before this file runs, so there is nothing to await and
 * no window during which the state is unknown.
 */
export function createRendererStore<S, A>(): Store<S, A> {
  const bridge = window.__electronSyncStore;

  let mirror = bridge.initialState as S;
  const listeners = new Set<Listener<S>>();

  bridge.onUpdate((state) => {
    mirror = state as S;
    for (const listener of [...listeners]) {
      listener(mirror);
    }
  });

  return {
    getState(): S {
      return mirror;
    },

    dispatch(action: A): void {
      bridge.dispatch(action);
    },

    subscribe(listener: Listener<S>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
