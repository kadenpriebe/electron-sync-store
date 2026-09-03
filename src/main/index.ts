import { ipcMain, type WebContents } from "electron";
import { createStore, type Reducer, type Store } from "../core/store";
import { CHANNELS, type Snapshot } from "../shared/protocol";

/**
 * Installs the store in the main process and wires it to IPC.
 *
 * Main is the single writer. Renderers never mutate anything; they *propose*
 * actions, and main decides. That is what gives every change a total order
 * for free — arrival order at a single owner IS the order of truth, with no
 * clocks to skew and no conflicts to resolve.
 */
export function createMainStore<S, A>(
  reducer: Reducer<S, A>,
  initialState: S,
): Store<S, A> {
  const store = createStore(reducer, initialState);

  /** How many changes have been applied, ever. Stamped on every message. */
  let seq = 0;

  /**
   * Every renderer that has bootstrapped. This, not the list of open windows,
   * is who receives broadcasts: a window that never asked for the state has no
   * mirror to keep current, and a renderer that is not a window at all (a
   * WebContentsView, a webview) still needs one. A reload re-bootstraps the
   * same webContents, which the Set absorbs.
   */
  const subscribers = new Set<WebContents>();

  function subscribe(sender: WebContents): void {
    if (subscribers.has(sender)) return;
    subscribers.add(sender);
    sender.once("destroyed", () => {
      subscribers.delete(sender);
    });
  }

  const currentSnapshot = (): Snapshot<S> => ({
    state: store.getState(),
    seq,
  });

  // Bootstrap. Answered synchronously so a preload can block on it before the
  // page exists. Setting event.returnValue is what unblocks ipcRenderer.sendSync.
  //
  // This handler must be registered before any window is created, or that
  // window's preload will block forever waiting for a reply that no one is
  // listening for. createMainStore() is therefore called during app startup.
  ipcMain.on(CHANNELS.snapshotSync, (event) => {
    subscribe(event.sender);
    event.returnValue = currentSnapshot();
  });

  // Resync. Same data, asynchronously, for a mirror that is already running
  // and has discovered a hole in its history.
  ipcMain.handle(CHANNELS.snapshot, () => currentSnapshot());

  // Writes: fire-and-forget from the renderer's point of view, so dispatching
  // never blocks the UI waiting on the main process.
  ipcMain.on(CHANNELS.dispatch, (_event, action: A) => {
    store.dispatch(action);
  });

  // Fan out every change to every subscribed renderer.
  store.subscribe((state) => {
    seq += 1;
    const payload: Snapshot<S> = { state, seq };

    for (const target of subscribers) {
      // A renderer can be torn down between this loop starting and reaching
      // it, before its "destroyed" listener has run; sending to destroyed
      // webContents throws.
      if (target.isDestroyed()) continue;
      target.send(CHANNELS.update, payload);
    }
  });

  return store;
}
