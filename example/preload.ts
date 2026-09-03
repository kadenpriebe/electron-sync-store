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
 * and timers fire in order, so the relative order of messages is preserved
 * exactly as the real transport preserves it. The bootstrap is untouched:
 * it happened before the page existed and there is nothing to slow down.
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
  trace(event: unknown): void {
    ipcRenderer.send(DEMO.trace, event);
  },
};

export type DemoBridge = typeof demo;

contextBridge.exposeInMainWorld("__demo", demo);
