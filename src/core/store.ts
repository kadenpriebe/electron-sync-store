/**
 * The store, with no Electron in it at all.
 *
 * Keeping this file free of `import { ... } from "electron"` is a deliberate
 * architectural boundary, not tidiness. It means the state logic can be
 * exercised in a plain Node test process with no windows, no IPC and no
 * display server — and it means the same logic runs unchanged in the main
 * process and inside each renderer's mirror.
 */

export type Listener<S> = (state: S) => void;

/** A pure read of one slice of the state. Must be cheap; it runs on every flush. */
export type Selector<S, T> = (state: S) => T;

export type Reducer<S, A> = (state: S, action: A) => S;

export type Unsubscribe = () => void;

/**
 * Watch the whole state, or one slice of it.
 *
 * The slice form is not sugar. A listener that only cares about `count` should
 * not be woken because `user` changed, and in a renderer that difference is a
 * re-render that never happens.
 */
export interface Subscribe<S> {
  (listener: Listener<S>): Unsubscribe;
  <T>(selector: Selector<S, T>, listener: (slice: T) => void): Unsubscribe;
}

export interface Store<S, A> {
  /** Always synchronous. Never crosses a process boundary. */
  getState(): S;
  dispatch(action: A): void;
  subscribe: Subscribe<S>;
}

/** A listener's failure is its own problem; it must not poison the flush. */
function rethrowLater(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

type Entry<S> = {
  select: (state: S) => unknown;
  notify: (slice: unknown) => void;
  last: unknown;
};

export interface Notifier<S> {
  /** Registers a watcher and seeds it with what it can already see. */
  add<T>(select: Selector<S, T>, notify: (slice: T) => void, current: S): Unsubscribe;
  /** The state moved. Schedules one flush for this tick. */
  changed(state: S): void;
  /** Run any scheduled flush now. For tests and for hosts that need the news at once. */
  flush(): void;
}

/**
 * Who gets woken up, and when.
 *
 * Two ideas in one small object, and they are the same idea seen twice:
 *
 *   Batching. A dispatch does not call listeners; it schedules a flush on a
 *   microtask. Ten dispatches in one tick produce one flush, holding the final
 *   state. In main that means one IPC broadcast instead of ten, and in a
 *   renderer one re-render instead of ten. It is deliberately a microtask and
 *   not a timer: everything queued in the same tick is coalesced, and the flush
 *   still happens before the browser can paint, so nothing is ever shown stale.
 *
 *   Slices. Each watcher keeps the last value its selector returned. On a flush
 *   the selector runs again and the watcher is told only if the value actually
 *   changed, by `Object.is`. Watching the whole state is the same mechanism
 *   with the identity selector, where the value changes on every dispatch
 *   because the reducer returns a new object.
 *
 * `last` is seeded when the watcher is added, so a listener that subscribes
 * between a dispatch and the flush is never told about a change it was not
 * present for.
 */
export function createNotifier<S>(): Notifier<S> {
  const entries = new Set<Entry<S>>();
  let scheduled = false;
  let latest: S;
  let dirty = false;

  function flush(): void {
    scheduled = false;
    if (!dirty) return;
    dirty = false;
    const state = latest;
    // Iterate a copy: a listener is allowed to subscribe or unsubscribe while
    // being notified. Unsubscribing during a flush takes effect immediately,
    // which the membership check below honours.
    for (const entry of [...entries]) {
      if (!entries.has(entry)) continue;
      const next = entry.select(state);
      if (Object.is(next, entry.last)) continue;
      entry.last = next;
      try {
        entry.notify(next);
      } catch (error) {
        rethrowLater(error);
      }
    }
  }

  return {
    add<T>(select: Selector<S, T>, notify: (slice: T) => void, current: S): Unsubscribe {
      const entry: Entry<S> = {
        select: select as (state: S) => unknown,
        notify: notify as (slice: unknown) => void,
        last: select(current),
      };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },

    changed(state: S): void {
      latest = state;
      dirty = true;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    },

    flush,
  };
}

const identity = <S,>(state: S): S => state;

export function createStore<S, A>(reducer: Reducer<S, A>, initialState: S): Store<S, A> {
  let state = initialState;
  const notifier = createNotifier<S>();

  function subscribe(listener: Listener<S>): Unsubscribe;
  function subscribe<T>(selector: Selector<S, T>, listener: (slice: T) => void): Unsubscribe;
  function subscribe<T>(
    first: Listener<S> | Selector<S, T>,
    second?: (slice: T) => void,
  ): Unsubscribe {
    if (second) return notifier.add(first as Selector<S, T>, second, state);
    return notifier.add(identity<S>, first as Listener<S>, state);
  }

  return {
    getState(): S {
      return state;
    },

    dispatch(action: A): void {
      // The state moves now. Only the telling of it waits for the microtask,
      // so a caller that dispatches and then reads sees its own change.
      state = reducer(state, action);
      notifier.changed(state);
    },

    subscribe,
  };
}
