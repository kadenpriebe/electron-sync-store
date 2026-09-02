import { app, BrowserWindow } from "electron";
import path from "node:path";
import { createMainStore } from "../src/main";
import { initialState, reducer, type AppAction, type AppState } from "./state";

function createWindow(offsetX: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 520,
    x: 120 + offsetX,
    y: 120,
    webPreferences: {
      // Both are already the modern defaults. They are stated explicitly
      // because the entire architecture depends on them: the renderer cannot
      // reach Node, so the preload bridge is the only way across.
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  void win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

app.whenReady().then(() => {
  // The store lives in main and is created once, before any window exists.
  createMainStore<AppState, AppAction>(reducer, initialState);

  // Two windows, so that state sharing is visible rather than claimed.
  createWindow(0);
  createWindow(500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(0);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
