/**
 * A stand-in for the main process that never leaves the test's own process.
 *
 * It implements the bridge the renderer store talks to, holds the truth the
 * way main does, and gives the test control over timing: nothing a renderer
 * proposes is answered until the test says so, and any broadcast can be
 * lost on purpose. That control is the whole point — the interesting
 * behaviour of an optimistic store is what it shows between sending and
 * hearing back.
 */
import type { Reducer } from "../src/core/store";
import type {
  DispatchEnvelope,
  DispatchReply,
  Origin,
  Snapshot,
  SyncStoreBridge,
  Update,
} from "../src/shared/protocol";

type InFlight<A> = {
  envelope: DispatchEnvelope<A>;
  resolve: (reply: DispatchReply) => void;
  reject: (error: Error) => void;
};

export function fakeMain<S, A>(reducer: Reducer<S, A>, initialState: S) {
  let state = initialState;
  let seq = 0;
  /** The last change announced. A dropped broadcast still counts as sent. */
  let sent = 0;
  let dropBroadcasts = 0;
  let rejectNextWith: string | undefined;
  const listeners = new Set<(update: unknown) => void>();
  const inbox: InFlight<A>[] = [];

  /** Announce everything applied since the last broadcast, in one message. */
  function broadcast(origins?: Origin[]): void {
    const since = sent;
    sent = seq;
    if (dropBroadcasts > 0) {
      dropBroadcasts -= 1;
      return;
    }
    const update: Update<S> = { state, seq, since };
    if (origins) update.origins = origins;
    for (const listener of listeners) listener(update);
  }

  function take(): InFlight<A> {
    const next = inbox.shift();
    if (!next) throw new Error("nothing is in flight");
    return next;
  }

  const bridge: SyncStoreBridge = {
    initialState: { state, seq } satisfies Snapshot<S>,
    snapshot: () => Promise.resolve({ state, seq } satisfies Snapshot<S>),
    dispatch: (envelope) =>
      new Promise<unknown>((resolve, reject) => {
        inbox.push({ envelope: envelope as DispatchEnvelope<A>, resolve, reject });
      }),
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };

  return {
    bridge,
    get state(): S {
      return state;
    },
    get seq(): number {
      return seq;
    },
    get inFlight(): number {
      return inbox.length;
    },

    /** Handle the oldest proposal exactly as main does: reduce, broadcast, reply. */
    answer(): void {
      const { envelope, resolve } = take();
      if (rejectNextWith !== undefined) {
        const reason = rejectNextWith;
        rejectNextWith = undefined;
        resolve({ status: "rejected", reason });
        return;
      }
      try {
        state = reducer(state, envelope.action);
      } catch (error) {
        resolve({ status: "rejected", reason: (error as Error).message });
        return;
      }
      seq += 1;
      broadcast([envelope.origin]);
      resolve({ status: "confirmed", seq });
    },

    /**
     * Answer everything waiting, then announce it once — main under load, where
     * a tick's worth of proposals all land before any listener runs.
     */
    answerAll(): void {
      const replies: Array<{ resolve: (reply: DispatchReply) => void; at: number }> = [];
      const origins: Origin[] = [];
      while (inbox.length > 0) {
        const { envelope, resolve } = take();
        state = reducer(state, envelope.action);
        seq += 1;
        origins.push(envelope.origin);
        replies.push({ resolve, at: seq });
      }
      broadcast(origins);
      for (const { resolve, at } of replies) resolve({ status: "confirmed", seq: at });
    },

    /** Refuse the next proposal without running the reducer, as a rule only main knows would. */
    rejectNext(reason: string): void {
      rejectNextWith = reason;
    },

    /** The oldest proposal fails in transit: no verdict, just an error. */
    fail(message: string): void {
      take().reject(new Error(message));
    },

    /** A change made somewhere else: another window, or main-process code. */
    change(action: A): void {
      state = reducer(state, action);
      seq += 1;
      broadcast();
    },

    /** Several changes elsewhere in one tick: applied in order, announced once. */
    batch(actions: A[]): void {
      for (const action of actions) {
        state = reducer(state, action);
        seq += 1;
      }
      broadcast();
    },

    /** Lose the next broadcast in transit. */
    dropNextBroadcast(): void {
      dropBroadcasts += 1;
    },
  };
}
