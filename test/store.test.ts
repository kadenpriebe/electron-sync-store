/**
 * The core store: who gets woken up, and when.
 *
 * Nothing in here touches IPC or Electron, which is the point of keeping
 * src/core/store.ts free of both.
 */
import { describe, expect, it } from "vitest";
import { createStore, type Reducer } from "../src/core/store";

type State = { count: number; user: string };
type Action = { type: "inc" } | { type: "set-user"; user: string };

const reducer: Reducer<State, Action> = (state, action) =>
  action.type === "inc" ? { ...state, count: state.count + 1 } : { ...state, user: action.user };

const start = (): State => ({ count: 0, user: "ada" });

/** Let the scheduled flush run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("reads", () => {
  it("has the new state on the line after the dispatch", () => {
    const store = createStore(reducer, start());
    store.dispatch({ type: "inc" });
    expect(store.getState().count).toBe(1);
  });
});

describe("who gets woken up", () => {
  it("tells a whole-state listener once per tick, with the final state", async () => {
    const store = createStore(reducer, start());
    const seen: State[] = [];
    store.subscribe((state) => seen.push(state));
    store.dispatch({ type: "inc" });
    store.dispatch({ type: "inc" });
    store.dispatch({ type: "inc" });
    expect(seen).toEqual([]);
    await settle();
    expect(seen).toEqual([{ count: 3, user: "ada" }]);
  });

  it("leaves a slice watcher alone when something else changes", async () => {
    const store = createStore(reducer, start());
    const counts: number[] = [];
    const users: string[] = [];
    store.subscribe(
      (state) => state.count,
      (value) => counts.push(value),
    );
    store.subscribe(
      (state) => state.user,
      (value) => users.push(value),
    );
    store.dispatch({ type: "set-user", user: "grace" });
    await settle();
    expect(users).toEqual(["grace"]);
    expect(counts).toEqual([]);
    store.dispatch({ type: "inc" });
    await settle();
    expect(counts).toEqual([1]);
    expect(users).toEqual(["grace"]);
  });

  it("says nothing when a tick's changes cancel out", async () => {
    const store = createStore(reducer, start());
    const users: string[] = [];
    store.subscribe(
      (state) => state.user,
      (value) => users.push(value),
    );
    store.dispatch({ type: "set-user", user: "grace" });
    store.dispatch({ type: "set-user", user: "ada" });
    await settle();
    expect(users).toEqual([]);
    expect(store.getState().user).toBe("ada");
  });

  it("does not tell a listener about a change it was not present for", async () => {
    const store = createStore(reducer, start());
    const seen: number[] = [];
    store.dispatch({ type: "inc" });
    // Subscribed after the dispatch but before the flush.
    store.subscribe(
      (state) => state.count,
      (value) => seen.push(value),
    );
    await settle();
    expect(seen).toEqual([]);
  });

  it("honours an unsubscribe that happens during the flush", async () => {
    const store = createStore(reducer, start());
    const seen: string[] = [];
    const stopSecond = { current: (): void => {} };
    store.subscribe(() => {
      seen.push("first");
      stopSecond.current();
    });
    stopSecond.current = store.subscribe(() => {
      seen.push("second");
    });
    store.dispatch({ type: "inc" });
    await settle();
    expect(seen).toEqual(["first"]);
  });

  it("keeps going when a listener throws", async () => {
    const store = createStore(reducer, start());
    const seen: string[] = [];
    // The store re-throws on its own microtask; keep that from failing the run.
    const swallow = (): void => {};
    process.on("uncaughtException", swallow);
    try {
      store.subscribe(() => {
        throw new Error("listener blew up");
      });
      store.subscribe(() => seen.push("still called"));
      store.dispatch({ type: "inc" });
      await settle();
      expect(seen).toEqual(["still called"]);
    } finally {
      process.off("uncaughtException", swallow);
    }
  });

  it("uses the scheduler it was given", () => {
    const queued: Array<() => void> = [];
    const store = createStore(reducer, start(), { schedule: (run) => queued.push(run) });
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.count));
    store.dispatch({ type: "inc" });
    store.dispatch({ type: "inc" });
    // One flush was scheduled for two changes, and it has not run yet.
    expect(queued).toHaveLength(1);
    expect(seen).toEqual([]);
    queued[0]?.();
    expect(seen).toEqual([2]);
  });
});
