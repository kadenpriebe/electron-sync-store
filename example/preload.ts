/**
 * The example's preload entry. Importing the library's preload module is all
 * that is required — the import itself performs the contextBridge exposure.
 */
import "../src/preload";

import { contextBridge, ipcRenderer } from "electron";
import { DEMO } from "./demo-protocol";

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
