import { app, BrowserWindow, ipcMain, WebContentsView } from "electron";
import path from "node:path";
import { createMainStore } from "../src/main";
import type { RendererTraceEvent } from "../src/shared/trace";
import {
  DEMO,
  type FeedBody,
  type PaneLabel,
  type Rect,
  type Slots,
} from "./demo-protocol";
import { initialState, reducer, type AppAction, type AppState } from "./state";

/**
 * One window, three renderer processes.
 *
 * The inspector is a BrowserWindow whose page draws the architecture. The two
 * app renderers are WebContentsViews embedded inside it — each a genuine,
 * separate renderer process with its own preload and its own mirror, exactly
 * as two top-level windows would be. Nothing about the library changes for
 * this; it neither knows nor cares that its renderers share a window frame.
 */

const rendererPreferences = {
  // Both are already the modern defaults. They are stated explicitly because
  // the entire architecture depends on them: the renderer cannot reach Node,
  // so the preload bridge is the only way across.
  contextIsolation: true,
  nodeIntegration: false,
};

function round(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

app.whenReady().then(() => {
  const inspector = new BrowserWindow({
    width: 1380,
    height: 940,
    minWidth: 1180,
    minHeight: 780,
    title: "electron-sync-store — live architecture",
    webPreferences: {
      ...rendererPreferences,
      preload: path.join(__dirname, "inspector-preload.js"),
      // The inspector animates from timers. Chromium throttles timers to once
      // a second in a window it considers occluded, which turns the playback
      // into a crawl if this window is behind another one.
      backgroundThrottling: false,
    },
  });

  function feed(body: FeedBody & { at?: number }): void {
    if (inspector.isDestroyed()) return;
    inspector.webContents.send(DEMO.feed, { at: Date.now(), ...body });
  }

  /**
   * The chaos switch. When armed, the next proposal is refused no matter
   * what it is. It lives here, in main, outside the state on purpose: a
   * renderer cannot predict it, so its guess will be wrong, and the demo
   * shows what the library does when a guess is wrong. In an application
   * this is any rule only main can check — a permission, a quota, a value
   * that changed under the user's feet.
   */
  let rejectNext = false;

  function armReject(armed: boolean): void {
    rejectNext = armed;
    feed({ side: "meta", event: { kind: "reject-armed", armed } });
  }

  /**
   * What one ask costs main. Real work here is a fraction of a millisecond,
   * which hides the thing this demo is about: main is single threaded, so
   * asks are answered one after another. Give it a pile and the last one
   * waits for all the others. Twelve milliseconds is nothing for one click
   * and half a second for fifty, which is exactly the shape of the problem
   * optimistic updates exist to solve.
   */
  const WORK_PER_ASK_MS = 12;
  const idle = new Int32Array(new SharedArrayBuffer(4));

  function work(ms: number): void {
    Atomics.wait(idle, 0, 0, ms);
  }

  const guarded = (state: AppState, action: AppAction): AppState => {
    work(WORK_PER_ASK_MS);
    if (rejectNext) {
      armReject(false);
      throw new Error("refused on purpose");
    }
    return reducer(state, action);
  };

  // The store lives in main and is created once, before any renderer exists.
  // Main's side of every decision goes straight to the inspector.
  createMainStore<AppState, AppAction>(guarded, initialState, {
    trace: (event) => feed({ side: "main", event }),
  });

  // Each renderer's side arrives over the demo channel and is forwarded with
  // the sender's identity attached, so the inspector knows which pane spoke.
  ipcMain.on(
    DEMO.trace,
    (
      event,
      stamped: { at: number; event: RendererTraceEvent<AppState, AppAction> },
    ) => {
      // The renderer's own timestamp, not this moment: main may have been
      // busy for a while before getting here, and that would be a lie about
      // when the renderer did the thing.
      feed({
        side: "renderer",
        from: event.sender.id,
        event: stamped.event,
        at: stamped.at,
      });
    },
  );

  const panes = new Map<PaneLabel, WebContentsView>();

  /** Artificial IPC latency, chosen in the inspector, applied in each pane's preload. */
  let latency = 0;

  function createPane(label: PaneLabel, bounds: Rect): void {
    const pane = new WebContentsView({
      webPreferences: {
        ...rendererPreferences,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    inspector.contentView.addChildView(pane);
    pane.setBounds(round(bounds));
    panes.set(label, pane);

    // The preload registers its listener before the page loads, so by
    // did-finish-load it is ready to hear the current setting. Fires again
    // on every reload, which is exactly when the setting would be lost.
    pane.webContents.on("did-finish-load", () => {
      pane.webContents.send(DEMO.latency, latency);
    });

    // Announce the pane before it loads, so the inspector can attribute the
    // very first trace event (the bootstrap) to the right box.
    feed({
      side: "meta",
      event: { kind: "pane-created", id: pane.webContents.id, label },
    });
    // Window A is the vanilla page, window B the React one. Same library, same
    // preload, same state; only the way the page is written differs.
    const page = label === "b" ? "index-react.html" : "index.html";
    void pane.webContents.loadFile(path.join(__dirname, page));
  }

  function place(slots: Slots): void {
    for (const label of ["a", "b"] as const) {
      const pane = panes.get(label);
      if (pane) {
        pane.setBounds(round(slots[label]));
      } else {
        createPane(label, slots[label]);
      }
    }
  }

  // The renderers are created only once the inspector page is up and has said
  // where they go. That way their bootstrap traffic is the first thing on
  // screen instead of something that happened before anyone was watching.
  ipcMain.on(DEMO.ready, (_event, slots: Slots) => {
    // If the inspector itself was reloaded, re-announce the existing panes.
    for (const [label, pane] of panes) {
      feed({
        side: "meta",
        event: { kind: "pane-created", id: pane.webContents.id, label },
      });
    }
    place(slots);
  });

  ipcMain.on(DEMO.slots, (_event, slots: Slots) => {
    place(slots);
  });

  ipcMain.on(DEMO.reload, (_event, label: PaneLabel) => {
    panes.get(label)?.webContents.reload();
  });

  ipcMain.on(DEMO.latency, (_event, ms: number) => {
    latency = ms;
    for (const pane of panes.values()) {
      pane.webContents.send(DEMO.latency, latency);
    }
  });

  ipcMain.on(DEMO.rejectNext, (_event, armed: boolean) => {
    armReject(armed);
  });

  ipcMain.on(DEMO.rush, (_event, each: number) => {
    for (const pane of panes.values()) {
      pane.webContents.send(DEMO.rush, each);
    }
  });

  void inspector.loadFile(path.join(__dirname, "inspector.html"));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.relaunch();
      app.quit();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
