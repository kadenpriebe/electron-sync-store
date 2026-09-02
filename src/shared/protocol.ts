/**
 * The wire protocol: the only names both processes agree on.
 *
 * One file, imported by main, preload and renderer alike, so a channel name
 * can never drift out of sync between the two sides of the boundary. The
 * names are namespaced because these channels live in the host application's
 * global IPC namespace alongside whatever else it registers.
 */

export const CHANNELS = {
  /**
   * Bootstrap only. The preload script blocks on this exactly once, before
   * the page's own JavaScript runs, so that the first read is already local.
   */
  snapshotSync: "electron-sync-store:snapshot-sync",
  /** Renderer asks main for the current state. Request/response. */
  snapshot: "electron-sync-store:snapshot",
  /** Renderer proposes a change. Fire and forget; main is the only writer. */
  dispatch: "electron-sync-store:dispatch",
  /** Main announces a new state to every renderer. */
  update: "electron-sync-store:update",
} as const;

/** The key the preload bridge is exposed under on `window`. */
export const BRIDGE_KEY = "__electronSyncStore" as const;
