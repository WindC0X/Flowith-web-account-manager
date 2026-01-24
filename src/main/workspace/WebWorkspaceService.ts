import { BrowserView, BrowserWindow, Menu, shell } from "electron";
import type { Rect } from "../../shared/ipc";
import { getAccount, isTokenEncryptionAvailable } from "../accounts/vault";
import { attachDownloadsToSession } from "../downloads/service";
import { applyProxy } from "../network/proxy";
import { resolveUserAgent } from "../network/userAgent";

const FLOWITH_WEB_TARGET_HOSTS = ["flowith.io", "flowith.net", "flo.ing"] as const;
const FLOWITH_URL = "https://flowith.io/blank";

function isTrustedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return FLOWITH_WEB_TARGET_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function partitionForAccount(accountId: string): string {
  const safe = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const persist = isTokenEncryptionAvailable() ? "persist:" : "";
  return `${persist}flowith-web-${safe}`;
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

  listOpenTabs(): string[] {
    return [...this.views.keys()];
  }

  getWebContents(accountId: string) {
    return this.views.get(accountId)?.webContents ?? null;
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
    attachDownloadsToSession(view.webContents.session, accountId, () => this.window);
    void (async () => {
      try {
        const account = getAccount(accountId);
        const proxy = account?.net.proxy ?? { mode: "system" };
        const userAgent = account?.ua ? resolveUserAgent(account.ua) : null;
        if (userAgent) view.webContents.setUserAgent(userAgent);
        await applyProxy(view.webContents.session, proxy);
      } catch {
        void 0;
      }
      await view.webContents.loadURL(FLOWITH_URL);
    })();
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

	    view.webContents.on("context-menu", () => {
	      const menu = Menu.buildFromTemplate([
	        {
	          label: "页面刷新",
	          accelerator: "CmdOrCtrl+R",
	          click: () => {
	            view.webContents.reload();
	          },
	        },
	      ]);
	      menu.popup({ window: this.window });
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
	      width: 0,
	      height: 0,
	    };

    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }
}
