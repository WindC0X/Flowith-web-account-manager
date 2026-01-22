import { BrowserView, BrowserWindow, shell } from "electron";
import type { Rect } from "../../shared/ipc";

const FLOWITH_URL = "https://flowith.io";

function isTrustedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin === "https://flowith.io") return true;
    if (url.hostname.endsWith(".flowith.io")) return true;
    return false;
  } catch {
    return false;
  }
}

function partitionForAccount(accountId: string): string {
  const safe = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `persist:flowith-web-${safe}`;
}

export class WebWorkspaceService {
  private window: BrowserWindow;
  private views = new Map<string, BrowserView>();
  private activeAccountId: string | null = null;
  private viewportBounds: Rect | null = null;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  setWindow(window: BrowserWindow) {
    this.window = window;
    if (this.activeAccountId) {
      this.attach(this.activeAccountId);
    }
  }

  openTab(accountId: string) {
    this.ensureView(accountId);
    this.setActiveTab(accountId);
  }

  closeTab(accountId: string) {
    const view = this.views.get(accountId);
    if (!view) return;

    if (this.activeAccountId === accountId) {
      this.detachActive();
      this.activeAccountId = null;
    }

    view.webContents.close();
    this.views.delete(accountId);
  }

  setActiveTab(accountId: string) {
    this.ensureView(accountId);
    this.activeAccountId = accountId;
    this.attach(accountId);
  }

  setViewportBounds(bounds: Rect) {
    this.viewportBounds = bounds;
    if (this.activeAccountId) this.applyBounds(this.activeAccountId);
  }

  reloadActive() {
    if (!this.activeAccountId) return;
    const view = this.views.get(this.activeAccountId);
    view?.webContents.reload();
  }

  private ensureView(accountId: string) {
    if (this.views.has(accountId)) return;

    const view = new BrowserView({
      webPreferences: {
        partition: partitionForAccount(accountId),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });

    this.hardenWebContents(view);
    void view.webContents.loadURL(FLOWITH_URL);
    this.views.set(accountId, view);
  }

  private hardenWebContents(view: BrowserView) {
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isTrustedUrl(url)) return { action: "allow" };
      void shell.openExternal(url);
      return { action: "deny" };
    });

    view.webContents.on("will-navigate", (event, url) => {
      if (isTrustedUrl(url)) return;
      event.preventDefault();
      void shell.openExternal(url);
    });
  }

  private detachActive() {
    this.window.setBrowserView(null);
  }

  private attach(accountId: string) {
    const view = this.views.get(accountId);
    if (!view) return;

    this.window.setBrowserView(view);
    this.applyBounds(accountId);
  }

  private applyBounds(accountId: string) {
    const view = this.views.get(accountId);
    if (!view) return;

    const bounds = this.viewportBounds ?? {
      x: 0,
      y: 0,
      width: Math.max(0, this.window.getContentBounds().width),
      height: Math.max(0, this.window.getContentBounds().height),
    };

    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }
}
