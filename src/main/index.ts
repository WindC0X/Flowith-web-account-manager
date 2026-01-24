import { app, BrowserWindow, nativeImage, nativeTheme } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater/service";
import { FlowithLoginBootstrapService } from "./workspace/FlowithLoginBootstrapService";
import { WebWorkspaceService } from "./workspace/WebWorkspaceService";

type IconCandidate = { path: string; image: Electron.NativeImage; luma: number };

function averageLuma(image: Electron.NativeImage): number {
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return 0;
  const bitmap = image.toBitmap();
  if (bitmap.length < 4) return 0;

  let sum = 0;
  let count = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const alpha = bitmap[i + 3] ?? 0;
    if (alpha < 16) continue;
    const r = bitmap[i] ?? 0;
    const g = bitmap[i + 1] ?? 0;
    const b = bitmap[i + 2] ?? 0;
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count++;
  }

  return count > 0 ? sum / count : 0;
}

function resolveAppIcon(): Electron.NativeImage | null {
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

  const unique = [...new Set(candidatePaths)];
  const candidates: IconCandidate[] = [];

  for (const candidatePath of unique) {
    if (!existsSync(candidatePath)) continue;
    const image = nativeImage.createFromPath(candidatePath);
    if (image.isEmpty()) continue;
    candidates.push({ path: candidatePath, image, luma: averageLuma(image) });
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.image;

  const preferLightIcon = nativeTheme.shouldUseDarkColors;
  candidates.sort((a, b) => a.luma - b.luma);
  return preferLightIcon ? candidates[candidates.length - 1]!.image : candidates[0]!.image;
}

function createWindow(): BrowserWindow {
  const icon = resolveAppIcon();
  const mainWindow = new BrowserWindow({
    ...(icon ? { icon } : {}),
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
  let activeWindow = mainWindow;
  initUpdater(() => activeWindow);
  const workspace = new WebWorkspaceService(mainWindow);
  const loginBootstrap = new FlowithLoginBootstrapService(workspace);
  registerIpcHandlers({ workspace, loginBootstrap });

  let flushingBeforeQuit = false;
  app.on("before-quit", (event) => {
    if (flushingBeforeQuit) return;
    flushingBeforeQuit = true;
    event.preventDefault();
    void (async () => {
      try {
        await loginBootstrap.syncOpenTabsBeforeQuit({ totalTimeoutMs: 2000, perTabTimeoutMs: 800 });
      } catch {
        // best-effort
      }
      app.quit();
    })();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      activeWindow = w;
      workspace.setWindow(w);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
