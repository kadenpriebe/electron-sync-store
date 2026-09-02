import { app, BrowserWindow } from "electron";
import path from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      // Both of these are already the defaults in modern Electron.
      // They are stated explicitly because the whole architecture of
      // this library depends on them: the renderer cannot reach Node,
      // so a preload script + contextBridge is the only way across.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  // macOS: clicking the dock icon with no windows open reopens one.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Windows/Linux: closing every window quits. macOS apps traditionally stay
// running, which is why this is platform-conditional.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
