import type { Listener, Store, Unsubscribe } from "../core/store";
import type { SyncStoreBridge } from "../preload";
import type { Snapshot } from "../shared/protocol";

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

  const bootstrap = bridge.initialState as Snapshot<S>;

  let mirror = bootstrap.state;
  let lastSeq = bootstrap.seq;
  let resyncInFlight = false;

  const listeners = new Set<Listener<S>>();

  function notify(): void {
    for (const listener of [...listeners]) {
      listener(mirror);
    }
  }

  /**
   * Recover from a hole in history by asking main for the truth.
   *
   * Guarded against overlapping runs, and the result is only applied if it is
   * actually newer than what arrived while it was in flight — otherwise a slow
   * snapshot could overwrite fresher state with staler state.
   */
  async function resync(): Promise<void> {
    if (resyncInFlight) return;
    resyncInFlight = true;
    try {
      const snapshot = (await bridge.snapshot()) as Snapshot<S>;
      if (snapshot.seq > lastSeq) {
        lastSeq = snapshot.seq;
        mirror = snapshot.state;
        notify();
      }
    } finally {
      resyncInFlight = false;
    }
  }

  bridge.onUpdate((payload) => {
    const { state, seq } = payload as Snapshot<S>;

    // Already seen, or arrived out of order behind something newer.
    if (seq <= lastSeq) return;

    // A hole: at least one change never reached this window. Applying this
    // update would leave the mirror describing a history that never happened.
    if (seq !== lastSeq + 1) {
      void resync();
      return;
    }

    lastSeq = seq;
    mirror = state;
    notify();
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
