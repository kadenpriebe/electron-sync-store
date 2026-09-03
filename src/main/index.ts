import { ipcMain, type WebContents } from "electron";
import { createStore, type Reducer, type Store } from "../core/store";
import {
  CHANNELS,
  type DispatchEnvelope,
  type DispatchReply,
  type Origin,
  type Snapshot,
  type Update,
} from "../shared/protocol";
import type { Serializable } from "../shared/serializable";
import type { MainTraceEvent, Trace } from "../shared/trace";

export type MainStoreOptions<S, A> = {
  /** See shared/trace.ts. Called synchronously; keep it cheap. */
  trace?: Trace<MainTraceEvent<S, A>>;
};

/**
 * Installs the store in the main process and wires it to IPC.
 *
 * Main is the single writer. Renderers never mutate anything; they *propose*
 * actions, and main decides. That is what gives every change a total order
 * for free — arrival order at a single owner IS the order of truth, with no
 * clocks to skew and no conflicts to resolve.
 *
 * This is the one place the application's state type enters the library, so it
 * is where the crossing is enforced. `S & Serializable<S>` rather than
 * `Serializable<S>` alone: the bare conditional type is not an inference site,
 * so `S` would come out `unknown`; the intersection keeps inference working and
 * reports the error on the offending property rather than on the whole type.
 */
export function createMainStore<S, A>(
  reducer: Reducer<S, A>,
  initialState: S & Serializable<S>,
  options: MainStoreOptions<S, A> = {},
): Store<S, A> {
  const trace: Trace<MainTraceEvent<S, A>> = options.trace ?? (() => {});

  /** How many changes have been applied, ever. Stamped on every message. */
  let seq = 0;

  // The reducer is wrapped rather than the store, so the core store stays
  // unaware that tracing exists — and so that `seq` moves at the moment the
  // change is applied. It cannot move in the subscriber any more: listeners
  // are batched onto a microtask, and the reply to a proposal has to name the
  // change's number while the handler is still running.
  const tracedReducer: Reducer<S, A> = (state, action) => {
    const next = reducer(state, action);
    // An action the reducer answers with the state it was given changed
    // nothing, so it gets no number and causes no broadcast.
    if (!Object.is(next, state)) seq += 1;
    trace({ kind: "reducer-ran", action, before: state, after: next });
    return next;
  };

  const store = createStore(tracedReducer, initialState, {
    // See StoreOptions.schedule: main's changes arrive as separate I/O
    // callbacks, and this is the first moment after a batch of them is done.
    schedule: (run) => {
      setImmediate(run);
    },
  });

  /** The last change already announced. Every broadcast covers `(sent, seq]`. */
  let sent = 0;

  /**
   * Proposals applied since the last broadcast, so the next one can name them
   * and each mirror can find its own guesses in it. Changes made by
   * main-process code have no origin and appear in the same message unnamed.
   */
  let answering: Origin[] = [];

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
    trace({ kind: "bootstrap-served", to: event.sender.id, seq });
  });

  // Resync. Same data, asynchronously, for a mirror that is already running
  // and has discovered a hole in its history.
  ipcMain.handle(CHANNELS.snapshot, (event) => {
    trace({ kind: "snapshot-served", to: event.sender.id, seq });
    return currentSnapshot();
  });

  // Writes. Request/response: every proposal gets a verdict, addressed to the
  // proposer alone. The renderer has already applied the action as a guess,
  // and this reply is what tells it whether the guess held. A reducer that
  // throws is the rejection path — the state is untouched, nothing is
  // broadcast, and the reason travels back. The reply is a value in both
  // cases; the handler itself never throws, because an invoke that rejects
  // arrives as a transport error and this is not one.
  ipcMain.handle(
    CHANNELS.dispatch,
    (event, envelope: DispatchEnvelope<A>): DispatchReply => {
      const { origin, action } = envelope;
      trace({ kind: "dispatch-received", from: event.sender.id, origin, action });
      try {
        store.dispatch(action);
      } catch (error) {
        // Only the reducer can throw in here now. Listeners are called from a
        // microtask, so a host listener's bug can no longer be mistaken for a
        // rejection — it surfaces as its own uncaught error, where it belongs.
        const reason = error instanceof Error ? error.message : String(error);
        trace({ kind: "dispatch-rejected", from: event.sender.id, origin, reason });
        return { status: "rejected", reason };
      }
      // Answered while the handler is still on the stack, before the broadcast
      // this change will ride in. The proposer learns the number its change
      // landed at either way, whichever message reaches it first.
      answering.push(origin);
      return { status: "confirmed", seq };
    },
  );

  // Fan out to every subscribed renderer. One message per tick, however many
  // changes happened in it: the store batches its listeners, and this is one.
  store.subscribe((state) => {
    const since = sent;
    const origins = answering.length > 0 ? answering : undefined;
    answering = [];
    sent = seq;

    const payload: Update<S> = { state, seq, since };
    if (origins) payload.origins = origins;
    const to: number[] = [];

    for (const target of subscribers) {
      // A renderer can be torn down between this loop starting and reaching
      // it, before its "destroyed" listener has run; sending to destroyed
      // webContents throws.
      if (target.isDestroyed()) continue;
      target.send(CHANNELS.update, payload);
      to.push(target.id);
    }

    trace({ kind: "broadcast", seq, since, origins, to });
  });

  return store;
}
