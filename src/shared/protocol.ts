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

/**
 * Everything that crosses the boundary carries a sequence number.
 *
 * `seq` is main's count of how many changes have been applied, ever. A mirror
 * that receives seq n while holding n-1 knows it is exactly one change behind
 * and can apply the update directly. Any other relationship means its view of
 * history has a hole in it, and it must ask for a full snapshot instead.
 */
export type Snapshot<S> = {
  state: S;
  seq: number;
};
