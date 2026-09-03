/**
 * The example's preload entry.
 *
 * An application would `import "../src/preload"` and be done. The example
 * instead builds the library's bridge itself and wraps it, so that every
 * message can be held for a chosen number of milliseconds before crossing.
 * Real IPC is sub-millisecond, which makes the interesting moment of an
 * optimistic update (the guess, shown while main has not yet answered) too
 * short to see. The wrapper is the only difference; the library is unaware.
 */
import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "../src/preload/bridge";
import { BRIDGE_KEY, type SyncStoreBridge } from "../src/shared/protocol";
import { DEMO } from "./demo-protocol";

const real = createBridge();

/** Set by the inspector, via main. Zero until told otherwise. */
let latency = 0;
ipcRenderer.on(DEMO.latency, (_event, ms: number) => {
  latency = ms;
});

function later<T>(produce: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(produce()), latency);
  });
}

/**
 * Same shape, every crossing delayed. Delays are equal in both directions,
 * and timers fire in order, so while the setting is constant the relative
 * order of messages is exactly what the real transport gives. Changing the
 * setting while messages are in flight can reorder them (a 1.5 s timer
 * already running against a new 0 ms one); the mirror treats that like any
 * other gap and resyncs. The bootstrap is untouched: it happened before the
 * page existed and there is nothing to slow down.
 */
const slow: SyncStoreBridge = {
  initialState: real.initialState,
  snapshot: () => later(() => real.snapshot()).then((snapshot) => later(() => snapshot)),
  dispatch: (envelope) =>
    later(() => real.dispatch(envelope)).then((reply) => later(() => reply)),
  onUpdate: (callback) =>
    real.onUpdate((update) => {
      setTimeout(() => callback(update), latency);
    }),
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, slow);

/**
 * Demo-only side channel. The page hands the library a `trace` callback, and
 * this is how those events reach the inspector window. Deliberately separate
 * from the library's own bridge so the library's surface stays what it is.
 */
const demo = {
  /**
   * Stamped here rather than where main forwards it. Main is single threaded:
   * while it is working through a pile of asks it cannot forward anything, so
   * its own arrival time would say more about main's backlog than about when
   * this actually happened.
   */
  trace(event: unknown): void {
    ipcRenderer.send(DEMO.trace, { at: Date.now(), event });
  },
  /** The inspector's "50 clicks at once" button, relayed through main. */
  onRush(callback: (each: number) => void): void {
    ipcRenderer.on(DEMO.rush, (_event, each: number) => {
      callback(each);
    });
  },
};

export type DemoBridge = typeof demo;

contextBridge.exposeInMainWorld("__demo", demo);
