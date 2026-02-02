import { BrowserWindow, Menu, shell, WebContentsView } from "electron";
import type { Rect } from "../../shared/ipc";
import { getAccount } from "../accounts/vault";
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
  return `persist:flowith-web-${safe}`;
}

export class WebWorkspaceService {
  private window: BrowserWindow;
  private views = new Map<string, WebContentsView>();
  private activeAccountId: string | null = null;
  private viewportBounds: Rect | null = null;
  private overlayActive = false;
  private lastAppliedAccountId: string | null = null;
  private lastAppliedBounds: Rect | null = null;
  private boundsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private windowShortcutsAttached = false;
  private readonly handleWindowBeforeInputEvent = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== "keyDown") return;

    const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
    const ctrlOrMeta = Boolean(input.control) || Boolean(input.meta);

    // Prevent reloading the renderer window which can desync UI state from BrowserViews.
    if (ctrlOrMeta && key === "r") {
      event.preventDefault();
      this.reloadActive();
      return;
    }

    // Windows users often press F5 to refresh.
    if (key === "f5") {
      event.preventDefault();
      this.reloadActive();
    }
  };

  constructor(window: BrowserWindow) {
    this.window = window;
    this.attachWindowShortcuts();
  }

  setWindow(window: BrowserWindow) {
    this.detachWindowShortcuts();
    this.window = window;
    this.attachWindowShortcuts();
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
    if (this.activeAccountId === accountId) {
      this.applyBounds(accountId);
      this.applyZOrder(accountId);
      return;
    }
    if (this.activeAccountId) {
      this.detachActive();
    }
    this.activeAccountId = accountId;
    this.attach(accountId);
  }

  setViewportBounds(bounds: Rect) {
    this.viewportBounds = bounds;
    if (this.activeAccountId) this.applyBounds(this.activeAccountId);
  }

  setOverlayActive(active: boolean) {
    this.overlayActive = active;
    if (this.activeAccountId) this.applyZOrder(this.activeAccountId);
  }

  reloadActive() {
    if (!this.activeAccountId) return;
    const view = this.views.get(this.activeAccountId);
    view?.webContents.reload();
  }

  getState(): { openTabIds: string[]; activeTabId: string | null } {
    return { openTabIds: this.listOpenTabs(), activeTabId: this.activeAccountId };
  }

  listOpenTabs(): string[] {
    return [...this.views.keys()];
  }

  getWebContents(accountId: string) {
    return this.views.get(accountId)?.webContents ?? null;
  }

  async captureTabSnapshot(accountId: string): Promise<string | null> {
    const view = this.views.get(accountId);
    if (!view) return null;

    try {
      const image = await view.webContents.capturePage();
      if (image.isEmpty()) return null;

      const size = image.getSize();
      const maxWidth = 840;
      const normalized =
        Number.isFinite(size.width) && size.width > maxWidth ? image.resize({ width: maxWidth, quality: "good" }) : image;

      const jpeg = normalized.toJPEG(70);
      if (!jpeg || jpeg.length === 0) return null;
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    } catch {
      return null;
    }
  }

  private ensureView(accountId: string) {
    if (this.views.has(accountId)) return;

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionForAccount(accountId),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });

    this.hardenWebContents(view);
    this.hardenShortcuts(view);
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

  private attachWindowShortcuts() {
    if (this.windowShortcutsAttached) return;
    this.windowShortcutsAttached = true;
    try {
      this.window.webContents.on("before-input-event", this.handleWindowBeforeInputEvent);
    } catch {
      // ignore
    }
  }

  private detachWindowShortcuts() {
    if (!this.windowShortcutsAttached) return;
    this.windowShortcutsAttached = false;
    try {
      this.window.webContents.removeListener("before-input-event", this.handleWindowBeforeInputEvent);
    } catch {
      // ignore
    }
  }

  private hardenShortcuts(view: WebContentsView) {
    try {
      view.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
        const ctrlOrMeta = Boolean(input.control) || Boolean(input.meta);
        if (ctrlOrMeta && key === "r") {
          event.preventDefault();
          try {
            view.webContents.reload();
          } catch {
            // ignore
          }
          return;
        }
        if (key === "f5") {
          event.preventDefault();
          try {
            view.webContents.reload();
          } catch {
            // ignore
          }
        }
      });
    } catch {
      // ignore
    }
  }

  private hardenWebContents(view: WebContentsView) {
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

    view.webContents.on("context-menu", (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      const srcUrl = typeof params?.srcURL === "string" ? params.srcURL.trim() : "";
      const linkUrl = typeof params?.linkURL === "string" ? params.linkURL.trim() : "";
      const mediaType = typeof params?.mediaType === "string" ? params.mediaType : "none";

      const downloadUrl =
        mediaType !== "none" && srcUrl
          ? srcUrl
          : linkUrl && /^https?:/i.test(linkUrl)
            ? linkUrl
            : "";

      if (downloadUrl) {
        template.push({
          label: "另存为…",
          click: () => {
            try {
              view.webContents.downloadURL(downloadUrl);
            } catch {
              // ignore
            }
          },
        });
        template.push({ type: "separator" });
      }

      const editFlags = params?.editFlags;
      const canCut = Boolean(editFlags?.canCut);
      const canCopy = Boolean(editFlags?.canCopy);
      const canPaste = Boolean(editFlags?.canPaste);
      const canSelectAll = Boolean(editFlags?.canSelectAll);

      template.push(
        { label: "剪切", role: "cut", enabled: canCut },
        { label: "复制", role: "copy", enabled: canCopy },
        { label: "粘贴", role: "paste", enabled: canPaste },
        { label: "全选", role: "selectAll", enabled: canSelectAll },
        { type: "separator" }
      );

      template.push({
        label: "页面刷新",
        accelerator: "CmdOrCtrl+R",
        click: () => {
          view.webContents.reload();
        },
      });

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: this.window });
    });
  }

  private detachActive() {
    if (this.activeAccountId) {
      const view = this.views.get(this.activeAccountId);
      if (view) {
        try {
          this.window.contentView.removeChildView(view);
        } catch {
          // ignore
        }
      }
    }
    if (this.boundsRetryTimer) {
      clearTimeout(this.boundsRetryTimer);
      this.boundsRetryTimer = null;
    }
    this.lastAppliedAccountId = null;
    this.lastAppliedBounds = null;
  }

  private attach(accountId: string) {
    const view = this.views.get(accountId);
    if (!view) return;

    try {
      this.window.contentView.addChildView(view);
    } catch {
      return;
    }
    this.applyBounds(accountId);
    this.applyZOrder(accountId);
  }

  private applyBounds(accountId: string) {
    const view = this.views.get(accountId);
    if (!view) return;

    const bounds = this.viewportBounds ?? { x: 0, y: 0, width: 0, height: 0 };

    const nextBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };

    view.setBounds(nextBounds);

    const viewChanged = this.lastAppliedAccountId !== accountId;
    const prevBounds = this.lastAppliedBounds;
    this.lastAppliedAccountId = accountId;
    this.lastAppliedBounds = nextBounds;

    const becameVisible =
      nextBounds.width > 0 &&
      nextBounds.height > 0 &&
      (viewChanged || !prevBounds || prevBounds.width === 0 || prevBounds.height === 0);

    if (!becameVisible) return;

    if (this.boundsRetryTimer) clearTimeout(this.boundsRetryTimer);
    this.boundsRetryTimer = setTimeout(() => {
      if (this.activeAccountId !== accountId) return;
      const current = this.views.get(accountId);
      if (!current) return;
      current.setBounds(nextBounds);
    }, 30);
  }

  private applyZOrder(accountId: string) {
    const view = this.views.get(accountId);
    if (!view) return;
    try {
      this.window.contentView.removeChildView(view);
      if (this.overlayActive) {
        this.window.contentView.addChildView(view, 0);
      } else {
        this.window.contentView.addChildView(view);
      }
    } catch {
      // ignore
    }
  }
}
