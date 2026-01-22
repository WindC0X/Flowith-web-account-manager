import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";
import { FlowithLoginBootstrapService } from "./workspace/FlowithLoginBootstrapService";
import { WebWorkspaceService } from "./workspace/WebWorkspaceService";

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  const mainWindow = createWindow();
  const workspace = new WebWorkspaceService(mainWindow);
  const loginBootstrap = new FlowithLoginBootstrapService(workspace);
  registerIpcHandlers({ workspace, loginBootstrap });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      workspace.setWindow(w);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
