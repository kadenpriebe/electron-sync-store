/**
 * Staying current: the coverage rule, the gap, and the resync.
 *
 * These read the store's own trace hook rather than guessing from the outside,
 * which is what the hook was added for — the demo and the tests watch the same
 * decisions.
 *
 * The bridge here is deliberately hand-driven rather than the fake main used
 * elsewhere: every one of these tests is about a message arriving in the wrong
 * order, or not arriving at all, and that needs the test to hold the wire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reducer } from "../src/core/store";
import { createRendererStore } from "../src/renderer";
import type { Snapshot, SyncStoreBridge, Update } from "../src/shared/protocol";
import type { RendererTraceEvent } from "../src/shared/trace";

type State = { count: number; user: string };
type Action = { type: "inc" };

const reducer: Reducer<State, Action> = (state) => ({ ...state, count: state.count + 1 });

type Event = RendererTraceEvent<State, Action>;

function at(count: number, seq: number): Snapshot<State> {
  return { state: { count, user: "ada" }, seq };
}

/** A mirror with the test holding both ends of its wire. */
function wire(start: Snapshot<State>, failSnapshot?: () => Promise<never>) {
  let deliver: (update: unknown) => void = () => {};
  let fresh = start;
  let asked = 0;
  const events: Event[] = [];

  const bridge: SyncStoreBridge = {
    initialState: start,
    snapshot: () => {
      asked += 1;
      return failSnapshot ? failSnapshot() : Promise.resolve(fresh);
    },
    // Nothing in this file proposes anything; the mirror is a listener here.
    dispatch: () => new Promise<never>(() => {}),
    onUpdate: (callback) => {
      deliver = callback;
      return () => {};
    },
  };

  const store = createRendererStore<State, Action>(reducer, {
    bridge,
    trace: (event) => events.push(event),
  });

  return {
    store,
    events,
    get asked(): number {
      return asked;
    },
    /** What the next fresh copy will say. */
    answersWith(snapshot: Snapshot<State>): void {
      fresh = snapshot;
    },
    send(update: Update<State>): void {
      deliver(update);
    },
    verdicts(): string[] {
      return events
        .filter((event): event is Extract<Event, { kind: "update-received" }> =>
          event.kind === "update-received",
        )
        .map((event) => event.verdict);
    },
    kinds(): string[] {
      return events.map((event) => event.kind);
    },
  };
}

/** Let the resync round trip finish. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("naming a mirror", () => {
  it("still gives each one its own name where randomUUID refuses to run", () => {
    // http:// on a LAN address is not a secure context, and randomUUID throws
    // there rather than being absent.
    vi.stubGlobal("crypto", {
      randomUUID(): string {
        throw new Error("not a secure context");
      },
    });
    const names = [wire(at(0, 0)), wire(at(0, 0))].map((w) => {
      void w.store.dispatch({ type: "inc" });
      const sent = w.events.find((event) => event.kind === "dispatch-sent");
      return sent?.kind === "dispatch-sent" ? sent.origin.client : "";
    });
    expect(names[0]).toBeTruthy();
    expect(names[1]).toBeTruthy();
    expect(names[0]).not.toBe(names[1]);
  });
});

describe("a fresh copy that cannot be had", () => {
  it("is reported, and the gap is left to be found again", async () => {
    const w = wire(at(0, 0), () => Promise.reject(new Error("main is gone")));
    w.send({ ...at(5, 5), since: 4 });
    await settle();
    expect(w.events).toContainEqual({ kind: "resync-failed", reason: "main is gone" });
    expect(w.store.getState().count).toBe(0);
    // Not stuck: the next message exposing the same hole asks again.
    w.send({ ...at(6, 6), since: 5 });
    await settle();
    expect(w.asked).toBe(2);
  });
});

describe("the first read", () => {
  it("is answered from the bootstrap snapshot, with nothing to await", () => {
    const w = wire(at(7, 3));
    // No await between creating the store and reading it. That is the claim.
    expect(w.store.getState()).toEqual({ count: 7, user: "ada" });
    expect(w.kinds()).toEqual(["bootstrap-applied"]);
  });
});

describe("a message arriving", () => {
  it("is taken when it starts where this mirror left off", () => {
    const w = wire(at(0, 0));
    w.send({ ...at(1, 1), since: 0 });
    expect(w.store.getState().count).toBe(1);
    expect(w.verdicts()).toEqual(["applied"]);
  });

  it("is taken whole when it covers several changes at once", () => {
    const w = wire(at(0, 0));
    w.send({ ...at(50, 50), since: 0 });
    expect(w.store.getState().count).toBe(50);
    expect(w.verdicts()).toEqual(["applied"]);
    expect(w.asked).toBe(0);
  });

  it("is ignored when it is older than what this mirror already has", () => {
    const w = wire(at(0, 0));
    w.send({ ...at(2, 2), since: 0 });
    w.send({ ...at(1, 1), since: 0 });
    expect(w.store.getState().count).toBe(2);
    expect(w.verdicts()).toEqual(["applied", "stale"]);
    expect(w.asked).toBe(0);
  });
});

describe("a message that never arrived", () => {
  it("is noticed, and the mirror asks for a fresh copy and comes back level", async () => {
    const w = wire(at(0, 0));
    w.send({ ...at(1, 1), since: 0 });
    // Change 2 was lost on the way here. Change 3 says so by starting at 2.
    w.answersWith(at(3, 3));
    w.send({ ...at(3, 3), since: 2 });
    expect(w.verdicts()).toEqual(["applied", "gap"]);
    expect(w.store.getState().count).toBe(1);
    await settle();
    expect(w.store.getState().count).toBe(3);
    expect(w.kinds()).toContain("resync-started");
    expect(w.events).toContainEqual({ kind: "resync-finished", seq: 3, applied: true });
    expect(w.asked).toBe(1);
  });

  it("asks once, however many messages go missing while it waits", async () => {
    const w = wire(at(0, 0));
    w.answersWith(at(9, 9));
    w.send({ ...at(5, 5), since: 4 });
    w.send({ ...at(7, 7), since: 6 });
    w.send({ ...at(9, 9), since: 8 });
    expect(w.verdicts()).toEqual(["gap", "gap", "gap"]);
    await settle();
    // Three holes, one request: the second and third found one already in
    // flight and left it alone.
    expect(w.asked).toBe(1);
    expect(w.store.getState().count).toBe(9);
  });

  it("ignores a fresh copy that turns out to be older than what it has", async () => {
    const w = wire(at(0, 0));
    w.send({ ...at(3, 3), since: 0 });
    // The answer to the coming request was prepared before change 3 existed.
    w.answersWith(at(0, 0));
    w.send({ ...at(5, 5), since: 4 });
    await settle();
    expect(w.store.getState().count).toBe(3);
    expect(w.events).toContainEqual({ kind: "resync-finished", seq: 0, applied: false });
  });
});
