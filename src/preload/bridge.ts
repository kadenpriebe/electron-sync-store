import { ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, type SyncStoreBridge } from "../shared/protocol";

/**
 * Builds the bridge: the object the page is allowed to use.
 *
 * Separated from the exposure in ./index.ts so a host can wrap the bridge
 * before exposing it (the example does, to add artificial latency). An
 * application that wants the default behaviour only imports ./index.ts.
 */
export function createBridge(): SyncStoreBridge {
  /**
   * The one blocking call in the entire library, made deliberately.
   *
   * `sendSync` freezes the renderer until main replies, which is why the docs
   * warn against it and why `@electron/remote` — which made every property
   * read a sync IPC call — was deprecated and removed. That reasoning does not
   * apply here. This runs in the preload, before the page's own JavaScript
   * and before anything has painted, so there is no UI to freeze and no user
   * to make wait. It happens exactly once per window, and it costs one IPC
   * hop.
   *
   * What it buys: the mirror is already populated when renderer code starts,
   * so `getState()` is synchronous from the very first line and no consumer
   * needs a loading state that only exists because of how the library boots.
   */
  const initialState: unknown = ipcRenderer.sendSync(CHANNELS.snapshotSync);

  return {
    initialState,

    snapshot(): Promise<unknown> {
      return ipcRenderer.invoke(CHANNELS.snapshot);
    },

    dispatch(envelope: unknown): Promise<unknown> {
      return ipcRenderer.invoke(CHANNELS.dispatch, envelope);
    },

    onUpdate(callback: (update: unknown) => void): () => void {
      const handler = (_event: IpcRendererEvent, update: unknown): void => {
        callback(update);
      };
      ipcRenderer.on(CHANNELS.update, handler);
      return () => {
        ipcRenderer.off(CHANNELS.update, handler);
      };
    },
  };
}
