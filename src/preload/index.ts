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
const bridge = {
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
