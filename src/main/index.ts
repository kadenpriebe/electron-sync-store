import { BrowserWindow, ipcMain } from "electron";
import { createStore, type Reducer, type Store } from "../core/store";
import { CHANNELS } from "../shared/protocol";

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

  // Bootstrap. Answered synchronously so a preload can block on it before the
  // page exists. Setting event.returnValue is what unblocks ipcRenderer.sendSync.
  //
  // This handler must be registered before any window is created, or that
  // window's preload will block forever waiting for a reply that no one is
  // listening for. createMainStore() is therefore called during app startup.
  ipcMain.on(CHANNELS.snapshotSync, (event) => {
    event.returnValue = store.getState();
  });

  // Resync. Same data, asynchronously, for callers that are already running.
  ipcMain.handle(CHANNELS.snapshot, () => store.getState());

  // Writes: fire-and-forget from the renderer's point of view, so dispatching
  // never blocks the UI waiting on the main process.
  ipcMain.on(CHANNELS.dispatch, (_event, action: A) => {
    store.dispatch(action);
  });

  // Fan out every change to every live window.
  store.subscribe((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      // A window can be torn down between this loop starting and reaching it;
      // sending to destroyed webContents throws.
      if (win.isDestroyed()) continue;
      win.webContents.send(CHANNELS.update, state);
    }
  });

  return store;
}
