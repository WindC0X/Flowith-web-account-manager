import { app, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";
import { FlowithLoginBootstrapService } from "./workspace/FlowithLoginBootstrapService";
import { WebWorkspaceService } from "./workspace/WebWorkspaceService";

function resolveAppIconPath(): string | null {
  const fileNames = ["TrayIcon.png", "TrayIconLight.png"];
  const candidatePaths: string[] = [];

  if (app.isPackaged) {
    for (const fileName of fileNames) {
      candidatePaths.push(join(app.getAppPath(), fileName));
    }
  } else {
    for (const fileName of fileNames) {
      candidatePaths.push(join(process.cwd(), fileName));
      candidatePaths.push(join(app.getAppPath(), fileName));
    }
  }

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function createWindow(): BrowserWindow {
  const iconPath = resolveAppIconPath();
  const mainWindow = new BrowserWindow({
    ...(iconPath ? { icon: iconPath } : {}),
    width: 1280,
    height: 800,
    show: false,
    ...(process.platform === "win32" ? { frame: false } : {}),
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
