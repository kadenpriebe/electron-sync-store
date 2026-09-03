/**
 * The wire protocol: the only names and shapes both processes agree on.
 *
 * One file, imported by main, preload and renderer alike, so a channel name
 * or a message shape can never drift out of sync between the two sides of
 * the boundary. The names are namespaced because these channels live in the
 * host application's global IPC namespace alongside whatever else it
 * registers.
 */

export const CHANNELS = {
  /**
   * Bootstrap only. The preload script blocks on this exactly once, before
   * the page's own JavaScript runs, so that the first read is already local.
   */
  snapshotSync: "electron-sync-store:snapshot-sync",
  /** Renderer asks main for the current state. Request/response. */
  snapshot: "electron-sync-store:snapshot",
  /**
   * Renderer proposes a change. Request/response: main answers every
   * proposal with a verdict, addressed to the proposer alone.
   */
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

/**
 * Names one proposal from one mirror: which mirror (`client`, chosen at
 * random when the mirror is created) and which of its proposals (`n`, its own
 * count). Main echoes it on the broadcast the proposal caused, so the mirror
 * that guessed can tell its own change apart from everyone else's.
 */
export type Origin = {
  client: string;
  n: number;
};

/** What a renderer sends when it proposes a change. */
export type DispatchEnvelope<A> = {
  origin: Origin;
  action: A;
};

/**
 * Main's answer to one proposal. `confirmed` carries the seq at which the
 * change was applied; `rejected` means the reducer threw, nothing changed,
 * and no broadcast was sent.
 */
export type DispatchReply =
  | { status: "confirmed"; seq: number }
  | { status: "rejected"; reason: string };

/**
 * A broadcast. One update can carry several changes at once: main coalesces
 * everything applied in a single tick into one message.
 *
 * `since` is what keeps that honest. It names the last change this update
 * builds on, so an update covers `(since, seq]`. A mirror holding exactly
 * `since` can take it; a mirror holding anything else knows something never
 * reached it and asks for a full copy instead. Without `since`, a batch that
 * jumped from 7 to 12 would be indistinguishable from four lost messages.
 *
 * `origins` names every proposal this update answers, so each mirror can find
 * its own guesses in a batch that also carries other windows' changes.
 */
export type Update<S> = Snapshot<S> & {
  since: number;
  origins?: Origin[];
};

/**
 * What the preload exposes to the page, and what the renderer store consumes.
 *
 * Typed loosely on purpose: the preload is generic over the application's
 * state, so it cannot name S or A. The renderer store, which can, narrows
 * every value at the point of use. Anything that implements this shape can
 * stand in for the real bridge, which is how the store is tested without a
 * renderer process.
 */
export interface SyncStoreBridge {
  /** A Snapshot, fetched before the page existed. */
  readonly initialState: unknown;
  /** Resolves to a Snapshot. */
  snapshot(): Promise<unknown>;
  /** Takes a DispatchEnvelope; resolves to a DispatchReply. */
  dispatch(envelope: unknown): Promise<unknown>;
  /** Called with an Update on every broadcast. Returns an unsubscribe. */
  onUpdate(callback: (update: unknown) => void): () => void;
}
