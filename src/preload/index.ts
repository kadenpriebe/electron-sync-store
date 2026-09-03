import { contextBridge } from "electron";
import { BRIDGE_KEY } from "../shared/protocol";
import { createBridge } from "./bridge";

/**
 * The bridge. This is the only code that can see both worlds.
 *
 * A preload script runs in the renderer, but before the page's own JavaScript,
 * and with access to `ipcRenderer`. `contextBridge` copies a narrow, explicit
 * API onto the page's `window` — the page never receives `ipcRenderer` itself,
 * so a compromised page cannot invent its own channels or reach the main
 * process in ways the library did not intend.
 *
 * Importing this module is the whole installation. To wrap the bridge before
 * exposing it, import `createBridge` from ./bridge instead.
 */
contextBridge.exposeInMainWorld(BRIDGE_KEY, createBridge());
