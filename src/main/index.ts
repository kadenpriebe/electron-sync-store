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
 */
export function createMainStore<S, A>(
  reducer: Reducer<S, A>,
  initialState: S,
  options: MainStoreOptions<S, A> = {},
): Store<S, A> {
  const trace: Trace<MainTraceEvent<S, A>> = options.trace ?? (() => {});

  /**
   * True once the reducer has returned for the dispatch in progress. A throw
   * before that point is a rejection; a throw after it came from a listener
   * and the change already happened.
   */
  let reduced = false;

  // The reducer is wrapped rather than the store, so the core store stays
  // unaware that tracing exists.
  const tracedReducer: Reducer<S, A> = (state, action) => {
    const next = reducer(state, action);
    reduced = true;
    trace({ kind: "reducer-ran", action, before: state, after: next });
    return next;
  };

  const store = createStore(tracedReducer, initialState);

  /** How many changes have been applied, ever. Stamped on every message. */
  let seq = 0;

  /**
   * Set for one renderer's dispatch and consumed by the first broadcast it
   * causes, so that broadcast can name it. Changes made by main-process code
   * directly have no origin, and neither does a change a host listener makes
   * in reaction to a renderer's dispatch: the origin is taken by the first
   * broadcast and cleared before listeners run.
   */
  let dispatching: Origin | undefined;
  /** The seq at which the dispatch in progress was applied. */
  let appliedAt = 0;

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
      dispatching = origin;
      reduced = false;
      try {
        store.dispatch(action);
        return { status: "confirmed", seq: appliedAt };
      } catch (error) {
        if (reduced) {
          // A host listener threw after the change was applied and
          // broadcast. That is the host's bug, not a rejection: surface it,
          // but tell the proposer the truth.
          queueMicrotask(() => {
            throw error;
          });
          return { status: "confirmed", seq: appliedAt };
        }
        const reason = error instanceof Error ? error.message : String(error);
        trace({ kind: "dispatch-rejected", from: event.sender.id, origin, reason });
        return { status: "rejected", reason };
      } finally {
        dispatching = undefined;
      }
    },
  );

  // Fan out every change to every subscribed renderer.
  store.subscribe((state) => {
    seq += 1;
    const origin = dispatching;
    dispatching = undefined;
    const payload: Update<S> = { state, seq };
    if (origin) {
      payload.origin = origin;
      appliedAt = seq;
    }
    const to: number[] = [];

    for (const target of subscribers) {
      // A renderer can be torn down between this loop starting and reaching
      // it, before its "destroyed" listener has run; sending to destroyed
      // webContents throws.
      if (target.isDestroyed()) continue;
      target.send(CHANNELS.update, payload);
      to.push(target.id);
    }

    trace({ kind: "broadcast", seq, origin: payload.origin, to });
  });

  return store;
}
