/**
 * Preload for the inspector window. The inspector is an ordinary renderer
 * with no store of its own; it only receives the feed, reports layout, and
 * sets the conditions the demo runs under.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { DEMO, type Feed, type PaneLabel, type Slots } from "./demo-protocol";

const inspector = {
  ready(slots: Slots): void {
    ipcRenderer.send(DEMO.ready, slots);
  },
  slots(slots: Slots): void {
    ipcRenderer.send(DEMO.slots, slots);
  },
  reload(label: PaneLabel): void {
    ipcRenderer.send(DEMO.reload, label);
  },
  latency(ms: number): void {
    ipcRenderer.send(DEMO.latency, ms);
  },
  rejectNext(armed: boolean): void {
    ipcRenderer.send(DEMO.rejectNext, armed);
  },
  rush(each: number): void {
    ipcRenderer.send(DEMO.rush, each);
  },
  onFeed(callback: (entry: Feed) => void): void {
    ipcRenderer.on(DEMO.feed, (_event: IpcRendererEvent, entry: Feed) => {
      callback(entry);
    });
  },
};

export type InspectorBridge = typeof inspector;

contextBridge.exposeInMainWorld("__inspector", inspector);
