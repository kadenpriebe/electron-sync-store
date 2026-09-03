import type { Listener, Reducer, Store, Unsubscribe } from "../core/store";
import type {
  DispatchEnvelope,
  DispatchReply,
  Origin,
  Snapshot,
  SyncStoreBridge,
  Update,
} from "../shared/protocol";
import type { RendererTraceEvent, Trace } from "../shared/trace";

declare global {
  interface Window {
    // Kept in sync by hand with BRIDGE_KEY in ../shared/protocol. An interface
    // member cannot be a computed name, so the literal is repeated here.
    __electronSyncStore: SyncStoreBridge;
  }
}

export type RendererStoreOptions<S, A> = {
  /** See shared/trace.ts. Called synchronously; keep it cheap. */
  trace?: Trace<RendererTraceEvent<S, A>>;
  /**
   * Where messages go. Defaults to the bridge the preload exposed on
   * `window`. Tests pass a fake that never leaves the process.
   */
  bridge?: SyncStoreBridge;
};

/** The outcome of one dispatch, once main has answered. */
export type DispatchResult = DispatchReply;

export interface RendererStore<S, A> extends Store<S, A> {
  /**
   * Applies the action locally at once and sends it to main. The promise
   * settles when main answers, and it always resolves: a rejection by main
   * or a failure of the transport both arrive as `{ status: "rejected" }`,
   * so a caller that only wants fire-and-forget can ignore it safely.
   */
  dispatch(action: A): Promise<DispatchResult>;
}

/**
 * A guess: an action applied locally that main has not yet ruled on.
 * `confirmedAt` is filled in once main says at which seq it applied the
 * action; the guess is dropped as soon as the confirmed state has caught up
 * to that seq, whichever message brings the news first.
 */
type Pending<A> = {
  n: number;
  action: A;
  confirmedAt?: number;
};

/**
 * The mirror: a full local copy of main's state, kept current by broadcast,
 * with this renderer's own unconfirmed changes applied on top.
 *
 * This is what makes reads synchronous. `getState()` never touches IPC — it
 * returns a value already sitting in this renderer's memory.
 *
 * Two states live here. `confirmed` is the last thing main said, and only
 * main can change it. `pending` is the list of actions this renderer has
 * proposed and not yet heard back about. What the page sees is `confirmed`
 * with `pending` replayed on top, through the same reducer main uses. When
 * main confirms a guess, it leaves the list; when main rejects one, it
 * leaves the list and the replay simply no longer includes it — that is the
 * rollback, and it costs nothing to keep track of. When main's state moves
 * for any other reason (another window's change), the guesses are replayed
 * on top of the new truth — a rebase.
 *
 * Creating the store is itself synchronous. The preload has already fetched
 * the first snapshot before this file runs, so there is nothing to await and
 * no window during which the state is unknown.
 */
export function createRendererStore<S, A>(
  reducer: Reducer<S, A>,
  options: RendererStoreOptions<S, A> = {},
): RendererStore<S, A> {
  const bridge = options.bridge ?? window.__electronSyncStore;
  const trace: Trace<RendererTraceEvent<S, A>> = options.trace ?? (() => {});

  const bootstrap = bridge.initialState as Snapshot<S>;

  /** Random per store instance, so two mirrors can never claim each other's guesses. */
  const client = crypto.randomUUID();
  let counter = 0;

  let confirmed = bootstrap.state;
  let lastSeq = bootstrap.seq;
  const pending: Pending<A>[] = [];
  /** `confirmed` with `pending` replayed on top. The only thing the page reads. */
  let visible = confirmed;
  let resyncInFlight = false;

  trace({ kind: "bootstrap-applied", seq: lastSeq, state: confirmed });

  const listeners = new Set<Listener<S>>();

  /**
   * A listener that throws must not poison the store or the dispatch
   * promise. The error is re-thrown on its own microtask, so it still
   * surfaces as an uncaught error where the host can see it.
   */
  function rethrowLater(error: unknown): void {
    queueMicrotask(() => {
      throw error;
    });
  }

  /**
   * Recompute what the page sees and tell it. A guess the local reducer
   * throws on is skipped here but was still sent: main's reducer is the
   * authority, and it may accept what this copy of the reducer refused.
   */
  function rebase(): void {
    let state = confirmed;
    for (const guess of pending) {
      try {
        state = reducer(state, guess.action);
      } catch {
        // Skipped locally; main will confirm or reject it like any other.
      }
    }
    visible = state;
    trace({ kind: "mirror-changed", state: visible, pending: pending.length });
    for (const listener of [...listeners]) {
      try {
        listener(visible);
      } catch (error) {
        rethrowLater(error);
      }
    }
  }

  /** Drop every guess the confirmed state now includes. True if any went. */
  function prune(): boolean {
    let dropped = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const guess = pending[i];
      if (guess && guess.confirmedAt !== undefined && guess.confirmedAt <= lastSeq) {
        pending.splice(i, 1);
        dropped = true;
      }
    }
    return dropped;
  }

  /** The confirmed state moved; take the news, then re-derive the picture. */
  function advance(snapshot: Snapshot<S>, origin?: Origin): void {
    lastSeq = snapshot.seq;
    confirmed = snapshot.state;
    if (origin && origin.client === client) {
      const mine = pending.find((guess) => guess.n === origin.n);
      if (mine) mine.confirmedAt = snapshot.seq;
    }
    prune();
    rebase();
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
    trace({ kind: "resync-started" });
    try {
      const snapshot = (await bridge.snapshot()) as Snapshot<S>;
      const applied = snapshot.seq > lastSeq;
      if (applied) advance(snapshot);
      trace({ kind: "resync-finished", seq: snapshot.seq, applied });
    } finally {
      resyncInFlight = false;
    }
  }

  bridge.onUpdate((payload) => {
    const update = payload as Update<S>;
    const { seq, origin } = update;

    // Already seen, or arrived out of order behind something newer.
    if (seq <= lastSeq) {
      trace({ kind: "update-received", seq, origin, verdict: "stale" });
      return;
    }

    // A hole: at least one change never reached this window. Applying this
    // update would leave the mirror describing a history that never happened.
    if (seq !== lastSeq + 1) {
      trace({ kind: "update-received", seq, origin, verdict: "gap" });
      void resync();
      return;
    }

    trace({ kind: "update-received", seq, origin, verdict: "applied" });
    advance(update, origin);
  });

  /** Main has ruled on a guess. */
  function settle(guess: Pending<A>, origin: Origin, reply: DispatchReply): DispatchResult {
    if (reply.status === "rejected") {
      const index = pending.indexOf(guess);
      if (index !== -1) pending.splice(index, 1);
      trace({ kind: "dispatch-rejected", origin, reason: reply.reason });
      rebase();
      return reply;
    }
    // Confirmed. Usually the broadcast carrying this seq arrived first and the
    // guess is already gone; if the reply overtook it, keep the guess until
    // the confirmed state catches up, so the count never dips and comes back.
    guess.confirmedAt = reply.seq;
    trace({ kind: "dispatch-confirmed", origin, seq: reply.seq });
    if (prune()) rebase();
    return reply;
  }

  return {
    getState(): S {
      return visible;
    },

    dispatch(action: A): Promise<DispatchResult> {
      counter += 1;
      const origin: Origin = { client, n: counter };
      const guess: Pending<A> = { n: origin.n, action };
      pending.push(guess);
      rebase();
      trace({ kind: "dispatch-sent", origin, action });

      const envelope: DispatchEnvelope<A> = { origin, action };
      // A bridge that throws synchronously (the real one cannot; a custom
      // one might) is treated exactly like one whose promise rejected.
      let sent: Promise<unknown>;
      try {
        sent = bridge.dispatch(envelope);
      } catch (error) {
        sent = Promise.reject(error);
      }
      return sent.then(
        (reply) => settle(guess, origin, reply as DispatchReply),
        (error: unknown) =>
          settle(guess, origin, {
            status: "rejected",
            reason: error instanceof Error ? error.message : String(error),
          }),
      );
    },

    subscribe(listener: Listener<S>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
