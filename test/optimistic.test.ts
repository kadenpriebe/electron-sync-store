import { describe, expect, it } from "vitest";
import type { Reducer } from "../src/core/store";
import { createRendererStore } from "../src/renderer";
import { fakeMain } from "./fake-main";

type State = { count: number };
type Action = { type: "inc" } | { type: "boom" };

const inc: Action = { type: "inc" };
const boom: Action = { type: "boom" };

const reducer: Reducer<State, Action> = (state, action) => {
  switch (action.type) {
    case "inc":
      return { count: state.count + 1 };
    case "boom":
      throw new Error("boom");
  }
};

/** Let promise callbacks and the resync round trip run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(local: Reducer<State, Action> = reducer, remote: Reducer<State, Action> = reducer) {
  const main = fakeMain(remote, { count: 0 });
  const store = createRendererStore(local, { bridge: main.bridge });
  return { main, store, count: () => store.getState().count };
}

describe("optimistic dispatch", () => {
  it("applies the action locally before main has answered", () => {
    const { main, store, count } = setup();
    void store.dispatch(inc);
    expect(count()).toBe(1);
    expect(main.state.count).toBe(0);
    expect(main.inFlight).toBe(1);
  });

  it("after main confirms, the mirror equals main's state with nothing left pending", async () => {
    const { main, store } = setup();
    const reply = store.dispatch(inc);
    main.answer();
    await expect(reply).resolves.toEqual({ status: "confirmed", seq: 1 });
    expect(store.getState()).toEqual(main.state);
    // A guess that lingered would be replayed on top of the next truth.
    main.change(inc);
    expect(store.getState()).toEqual(main.state);
  });

  it("shows the change once, never twice, between the broadcast and the reply", async () => {
    const { main, store } = setup();
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.count));
    const reply = store.dispatch(inc);
    main.answer();
    await reply;
    expect(Math.max(...seen)).toBe(1);
  });

  it("rolls back to the confirmed state when main rejects, and says why", async () => {
    const { main, store, count } = setup();
    main.rejectNext("not allowed");
    const reply = store.dispatch(inc);
    expect(count()).toBe(1);
    main.answer();
    await expect(reply).resolves.toEqual({ status: "rejected", reason: "not allowed" });
    expect(count()).toBe(0);
  });

  it("a rejection does not discard a newer guess still in flight", async () => {
    const { main, store, count } = setup();
    main.rejectNext("not allowed");
    const first = store.dispatch(inc);
    const second = store.dispatch(inc);
    expect(count()).toBe(2);
    main.answer();
    await first;
    expect(count()).toBe(1);
    main.answer();
    await second;
    expect(count()).toBe(1);
    expect(main.state.count).toBe(1);
  });

  it("another window's change arriving mid-flight lands underneath the guess", async () => {
    const { main, store, count } = setup();
    const reply = store.dispatch(inc);
    main.change(inc);
    expect(count()).toBe(2);
    main.answer();
    await reply;
    expect(count()).toBe(2);
    expect(main.state.count).toBe(2);
  });

  it("an action the local reducer throws on is still sent, and skipped in the replay", async () => {
    // Main's reducer is the authority; this copy of it happens to be stricter.
    const lenient: Reducer<State, Action> = (state, action) =>
      action.type === "boom" ? { count: state.count + 10 } : reducer(state, action);
    const { main, store, count } = setup(reducer, lenient);
    const reply = store.dispatch(boom);
    expect(count()).toBe(0);
    expect(main.inFlight).toBe(1);
    main.answer();
    await expect(reply).resolves.toEqual({ status: "confirmed", seq: 1 });
    expect(count()).toBe(10);
  });

  it("the dispatch promise never rejects, even when the transport fails", async () => {
    const { main, store, count } = setup();
    const reply = store.dispatch(inc);
    main.fail("no handler registered");
    await expect(reply).resolves.toEqual({ status: "rejected", reason: "no handler registered" });
    expect(count()).toBe(0);
  });

  it("a guess confirmed during a missed broadcast is cleared by the resync", async () => {
    const { main, store, count } = setup();
    const reply = store.dispatch(inc);
    main.dropNextBroadcast();
    main.answer();
    await reply;
    // Main said yes, but the confirmed state never heard: the guess stays visible.
    expect(count()).toBe(1);
    // The next broadcast exposes the gap, and the resync brings seq 1 along.
    main.change(inc);
    await settle();
    expect(store.getState()).toEqual(main.state);
    expect(count()).toBe(2);
  });
});
