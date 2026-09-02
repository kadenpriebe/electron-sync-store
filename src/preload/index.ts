import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { BRIDGE_KEY, CHANNELS } from "../shared/protocol";

/**
 * The bridge. This is the only code that can see both worlds.
 *
 * A preload script runs in the renderer, but before the page's own JavaScript,
 * and with access to `ipcRenderer`. `contextBridge` copies a narrow, explicit
 * API onto the page's `window` — the page never receives `ipcRenderer` itself,
 * so a compromised page cannot invent its own channels or reach the main
 * process in ways the library did not intend.
 */
/**
 * The one blocking call in the entire library, made deliberately.
 *
 * `sendSync` freezes the renderer until main replies, which is why the docs
 * warn against it and why `@electron/remote` — which made every property read
 * a sync IPC call — was deprecated and removed. That reasoning does not apply
 * here. This runs in the preload, before the page's own JavaScript and before
 * anything has painted, so there is no UI to freeze and no user to make wait.
 * It happens exactly once per window, and it costs one IPC hop.
 *
 * What it buys: the mirror is already populated when renderer code starts, so
 * `getState()` is synchronous from the very first line and no consumer needs a
 * loading state that only exists because of how the library boots.
 */
const initialState: unknown = ipcRenderer.sendSync(CHANNELS.snapshotSync);

const bridge = {
  /** Already fetched, before the page existed. */
  initialState,

  snapshot(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.snapshot);
  },

  dispatch(action: unknown): void {
    ipcRenderer.send(CHANNELS.dispatch, action);
  },

  onUpdate(callback: (state: unknown) => void): () => void {
    const handler = (_event: IpcRendererEvent, state: unknown): void => {
      callback(state);
    };
    ipcRenderer.on(CHANNELS.update, handler);
    return () => {
      ipcRenderer.off(CHANNELS.update, handler);
    };
  },
};

export type SyncStoreBridge = typeof bridge;

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
