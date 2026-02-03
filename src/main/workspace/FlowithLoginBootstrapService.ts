import type {
  BeforeSendResponse,
  Cookie,
  OnBeforeSendHeadersListenerDetails,
  OnCompletedListenerDetails,
  WebContents,
  Session as ElectronSession,
} from "electron";
import type { Session } from "@supabase/supabase-js";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { isKnownUsedRefreshToken, refreshFlowithSessionForAccount } from "../flowith/sessionRefresh";
import { redactSensitive } from "../security/redact";
import type { WebWorkspaceService } from "./WebWorkspaceService";
import { extractSupabaseSessionSnapshotFromStorageValue, type SupabaseSessionSnapshot } from "./supabaseAuthStorage";
import crypto from "node:crypto";

const FLOWITH_WEB_TARGET_HOSTS = ["flowith.io", "flowith.net", "flo.ing"] as const;
const FLOWITH_EDGE_HOST = "edge.flowith.net";

function isFlowithUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return FLOWITH_WEB_TARGET_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function storageKeysFromSupabaseUrl(): string[] {
  const { projectRef } = resolveFlowithSupabaseConfig();
  return [
    `sb-${projectRef}-auth-token`,
    `sb-${projectRef}-all-auth-token`,
    "supabase.auth.token",
  ];
}

function storageKeysForInjection(): string[] {
  // Prefer canonical supabase-js storage keys, but also write to "sb-server-auth-token" for compatibility:
  // Flowith Web keeps its live session under this key in some builds. Without injecting it, imported
  // accounts may open as logged-out even though we have a valid session.
  const keys = storageKeysFromSupabaseUrl();
  keys.push("sb-server-auth-token");
  return [...new Set(keys)];
}

function isStandardSupabaseAuthKey(key: string): boolean {
  const { projectRef } = resolveFlowithSupabaseConfig();
  const normalized = key.trim();
  return (
    normalized === `sb-${projectRef}-auth-token` ||
    normalized === `sb-${projectRef}-all-auth-token` ||
    normalized === "supabase.auth.token"
  );
}

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function safeDecodeCookieValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates: string[] = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded && decoded !== trimmed) candidates.push(decoded);
  } catch {
    // ignore
  }

  const pushDecoded = (decoded: string) => {
    const value = decoded.trim();
    if (!value) return;
    if (value.startsWith("{") || value.startsWith("[") || value.includes("access_token") || value.includes("refresh_token")) {
      candidates.push(value);
    }
  };

  if (/^[A-Za-z0-9+/=]{32,}$/.test(trimmed)) {
    try {
      pushDecoded(Buffer.from(trimmed, "base64").toString("utf-8"));
    } catch {
      // ignore
    }
  }

  if (/^[A-Za-z0-9_-]{32,}$/.test(trimmed) && !trimmed.includes(".")) {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    try {
      pushDecoded(Buffer.from(padded, "base64").toString("utf-8"));
    } catch {
      // ignore
    }
  }

  return [...new Set(candidates)];
}

function supabaseHostFromConfig(): string {
  const { url } = resolveFlowithSupabaseConfig();
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error("Invalid FLOWITH_SUPABASE_URL.");
  }
}

async function waitForFlowithReady(webContents: WebContents, timeoutMs: number) {
  const isDocumentOnFlowith = async (): Promise<boolean> => {
    try {
      const href = (await webContents.executeJavaScript("location.href", true)) as unknown;
      if (typeof href !== "string") return false;
      return isFlowithUrl(href);
    } catch {
      return false;
    }
  };

  if (await isDocumentOnFlowith()) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for Flowith Web to load."));
    }, timeoutMs);

    const onFinish = () => {
      void (async () => {
        if (!(await isDocumentOnFlowith())) return;
        cleanup();
        resolve();
      })();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      webContents.removeListener("did-finish-load", onFinish);
    };

    webContents.on("did-finish-load", onFinish);
  });
}

async function injectSupabaseSession(webContents: WebContents, session: Session) {
  const keys = storageKeysForInjection();
  // Flowith Web may use different supabase-js/auth-js storage shapes depending on build/version.
  // To maximize compatibility we inject a superset payload that contains:
  // - top-level access_token/refresh_token (newer formats)
  // - currentSession/session/data.session wrappers (older formats)
  // - expiresAt (ms) alongside expires_at (seconds)
  const expiresAtMs =
    typeof session.expires_at === "number" && Number.isFinite(session.expires_at) && session.expires_at > 0
      ? Math.round(session.expires_at * 1000)
      : null;
  const value = JSON.stringify({
    ...session,
    currentSession: session,
    session,
    data: { session },
    ...(expiresAtMs ? { expiresAt: expiresAtMs } : {}),
  });

  const script = `
	    (() => {
	      const keys = ${JSON.stringify(keys)};
	      const payload = ${JSON.stringify(value)};
	      const report = { local: {}, session: {}, meta: {} };
	      try {
	        report.meta = {
	          href: location && typeof location.href === "string" ? location.href.split("?")[0] : "",
	          readyState: document && typeof document.readyState === "string" ? document.readyState : "",
	        };
	      } catch {
	        report.meta = {};
	      }
	      try {
	        for (const k of keys) {
	          try {
	            localStorage.setItem(k, payload);
	            report.local[k] = localStorage.getItem(k) === payload;
	          } catch {
            report.local[k] = false;
          }
          try {
            sessionStorage.setItem(k, payload);
            report.session[k] = sessionStorage.getItem(k) === payload;
          } catch {
            report.session[k] = false;
          }
        }
	        try { localStorage.removeItem("userHasLoggedOut"); } catch {}
	        try { sessionStorage.removeItem("userHasLoggedOut"); } catch {}
	        return { ok: true, report };
	      } catch (e) {
	        return { ok: false, error: e && e.message ? String(e.message) : String(e) };
      }
    })();
  `;

  const result = (await webContents.executeJavaScript(script, true)) as
    | {
        ok: true;
        report?: {
          local: Record<string, boolean>;
          session: Record<string, boolean>;
          meta?: { href?: string; readyState?: string };
        };
      }
    | { ok: false; error?: string }
    | undefined;

  if (!result || result.ok !== true) {
    throw new Error(`Failed to inject session: ${redactSensitive(result?.error ?? "unknown")}`);
  }

  const report = result.report;
  const anyOk =
    !!report &&
    (Object.values(report.local ?? {}).some(Boolean) || Object.values(report.session ?? {}).some(Boolean));
  if (!anyOk) {
    const meta = report?.meta;
    const hint =
      meta?.href || meta?.readyState ? ` (href=${meta?.href ?? ""} readyState=${meta?.readyState ?? ""})` : "";
    throw new Error(`Failed to inject session: storage write failed.${hint}`);
  }
}

function isAlreadyUsedError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return /already used/i.test(error);
  if (error instanceof Error) return /already used/i.test(error.message);
  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return /already used/i.test(message);
  }
  return false;
}

export class FlowithLoginBootstrapService {
  private workspace: WebWorkspaceService;
  private headerInjection = new Map<string, { setAccessToken: (token: string) => void }>();
  private tokenSync = new Map<string, { stop: () => void }>();
  private refreshTokenWriteDeadlines = new Map<string, number>();

  constructor(workspace: WebWorkspaceService) {
    this.workspace = workspace;
  }

  private fingerprintToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
  }

  private async collectAuthValues(
    webContents: WebContents,
    options?: { includeIndexedDb?: boolean }
  ): Promise<Array<{ storage: "local" | "session" | "cookie" | "idb"; key: string; value: string }>> {
    const storageValues = (await this.readSupabaseAuthStorageValues(webContents)) ?? [];
    const cookieValues = (await this.readSupabaseAuthCookieValues(webContents.session)) ?? [];
    const indexedDbValues = options?.includeIndexedDb ? (await this.readSupabaseAuthIndexedDbValues(webContents)) ?? [] : [];
    return [...storageValues, ...cookieValues, ...indexedDbValues];
  }

  private async readSupabaseAuthIndexedDbValues(
    webContents: WebContents
  ): Promise<Array<{ storage: "idb"; key: string; value: string }> | null> {
    if (webContents.isDestroyed()) return null;

    let href: unknown;
    try {
      href = await webContents.executeJavaScript("location.href", true);
    } catch {
      return null;
    }
    if (typeof href !== "string" || !isFlowithUrl(href)) return null;

    const script = `
      (async () => {
        const deadline = Date.now() + 1200;
        const maxValues = 80;
        const maxValueLength = 24_000;
        const results = [];

        const push = (key, raw) => {
          if (results.length >= maxValues) return;
          try {
            if (typeof raw === "string") {
              const value = raw.length > maxValueLength ? raw.slice(0, maxValueLength) : raw;
              results.push({ storage: "idb", key, value });
              return;
            }
            if (raw && typeof raw === "object") {
              const json = JSON.stringify(raw);
              if (typeof json !== "string" || !json) return;
              const value = json.length > maxValueLength ? json.slice(0, maxValueLength) : json;
              results.push({ storage: "idb", key, value });
            }
          } catch {
            // ignore
          }
        };

        const openDb = (name) => new Promise((resolve, reject) => {
          try {
            const req = indexedDB.open(name);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("open failed"));
            req.onblocked = () => reject(new Error("blocked"));
          } catch (e) {
            reject(e);
          }
        });

        let dbNames = [];
        try {
          if (typeof indexedDB.databases === "function") {
            const dbs = await indexedDB.databases();
            if (Array.isArray(dbs)) {
              for (const entry of dbs) {
                if (!entry || typeof entry !== "object") continue;
                const name = entry.name;
                if (typeof name === "string" && name.trim()) dbNames.push(name.trim());
              }
            }
          }
        } catch {
          // ignore
        }

        const fallbackNames = [
          "localforage",
          "keyval-store",
          "keyval",
          "localforage2",
          "firebaseLocalStorageDb",
          "supabase",
          "supabase-auth",
          "supabase-auth-token",
        ];
        for (const name of fallbackNames) if (!dbNames.includes(name)) dbNames.push(name);

        dbNames = [...new Set(dbNames)].filter(Boolean).slice(0, 12);

        for (const name of dbNames) {
          if (Date.now() > deadline || results.length >= maxValues) break;
          let db;
          try {
            db = await openDb(name);
          } catch {
            continue;
          }

          try {
            const storeNames = Array.from(db.objectStoreNames || []).slice(0, 20);
            for (const storeName of storeNames) {
              if (Date.now() > deadline || results.length >= maxValues) break;
              let tx;
              try {
                tx = db.transaction(storeName, "readonly");
              } catch {
                continue;
              }
              let store;
              try {
                store = tx.objectStore(storeName);
              } catch {
                continue;
              }

              const request = store.openCursor();
              await new Promise((resolve) => {
                request.onsuccess = () => {
                  const cursor = request.result;
                  if (!cursor) {
                    resolve();
                    return;
                  }

                  let keyStr = "";
                  try {
                    const k = cursor.key;
                    if (typeof k === "string") keyStr = k;
                    else keyStr = JSON.stringify(k);
                  } catch {
                    keyStr = String(cursor.key);
                  }

                  push(name + "/" + storeName + "/" + keyStr, cursor.value);
                  if (Date.now() > deadline || results.length >= maxValues) {
                    resolve();
                    return;
                  }
                  try {
                    cursor.continue();
                  } catch {
                    resolve();
                  }
                };
                request.onerror = () => resolve();
              });
            }
          } finally {
            try {
              db.close();
            } catch {
              // ignore
            }
          }
        }

        return { ok: true, values: results };
      })();
    `;

    const result = (await webContents.executeJavaScript(script, true)) as
      | { ok: true; values?: Array<{ storage: "idb"; key: string; value: string }> }
      | { ok: false; error?: string }
      | undefined;

    if (!result || result.ok !== true || !Array.isArray(result.values)) return null;
    return result.values;
  }

	  private async readSupabaseAuthStorageValues(
	    webContents: WebContents
	  ): Promise<Array<{ storage: "local" | "session"; key: string; value: string }> | null> {
    if (webContents.isDestroyed()) return null;

    let href: unknown;
    try {
      href = await webContents.executeJavaScript("location.href", true);
    } catch {
      return null;
    }
    if (typeof href !== "string" || !isFlowithUrl(href)) return null;

    const keys = storageKeysFromSupabaseUrl();
    const { projectRef } = resolveFlowithSupabaseConfig();
    const script = `
		  (() => {
		    const keys = ${JSON.stringify(keys)};
        const projectRefLower = ${JSON.stringify(projectRef.toLowerCase())};
		    const values = [];
        const seen = new Set();
        const push = (storageName, key, value) => {
          const sig = storageName + ":" + key;
          if (seen.has(sig)) return;
          seen.add(sig);
          values.push({ storage: storageName, key, value });
        };
        const looksRelevantKey = (rawKey) => {
          if (!rawKey || typeof rawKey !== "string") return false;
          const lower = rawKey.toLowerCase();
          return (
            keys.includes(rawKey) ||
            lower.includes(projectRefLower) ||
            lower.startsWith("sb-") ||
            lower.includes("supabase")
          );
        };
        const looksLikeAuthPayload = (rawValue) => {
          if (!rawValue || typeof rawValue !== "string") return false;
          const value = rawValue.trim();
          if (!value) return false;
          if (value.includes("refresh_token") || value.includes("access_token")) return true;
          if (value.includes("refreshToken") || value.includes("accessToken")) return true;
          return false;
        };
		    const read = (storage, name) => {
		      for (const k of keys) {
		        try {
		          const v = storage.getItem(k);
		          if (typeof v === "string" && v.trim()) push(name, k, v);
		        } catch {
		          // ignore
		        }
		      }
		    };
        const readAll = (storage, name) => {
          try {
            const chunkGroups = new Map();
            for (let i = 0; i < storage.length; i++) {
              const k = storage.key(i);
              if (!k) continue;
              let v = "";
              try {
                v = storage.getItem(k) || "";
              } catch {
                continue;
              }
              if (!v || !v.trim()) continue;
              const relevantKey = looksRelevantKey(k);
              // Always keep potentially relevant keys; additionally allow unknown keys if they look like auth payloads.
              if (!relevantKey && !looksLikeAuthPayload(v)) continue;
              push(name, k, v);

              const match = k.match(/^(.*)\\.(\\d{1,4})$/);
              if (!match) continue;
              const base = match[1];
              const index = Number.parseInt(match[2], 10);
              if (!base || !Number.isFinite(index)) continue;

              const groupKey = name + ":" + base;
              const existing = chunkGroups.get(groupKey) || [];
              existing.push({ index, value: v });
              chunkGroups.set(groupKey, existing);
            }

            for (const [groupKey, parts] of chunkGroups.entries()) {
              if (!Array.isArray(parts) || parts.length < 2) continue;
              parts.sort((a, b) => a.index - b.index);
              const joined = parts.map((p) => p.value || "").join("");
              if (!joined || !joined.trim()) continue;
              const base = groupKey.slice(groupKey.indexOf(":") + 1);
              // Mark as synthetic so we don't collide with a real key.
              push(name, base + ".__joined__", joined);
            }
          } catch {
            // ignore
          }
        };
		    try { read(localStorage, "local"); } catch {}
        try { readAll(localStorage, "local"); } catch {}
		    try { read(sessionStorage, "session"); } catch {}
        try { readAll(sessionStorage, "session"); } catch {}
		    return { ok: true, values };
		  })();
		`;

    const result = (await webContents.executeJavaScript(script, true)) as
      | { ok: true; values?: Array<{ storage: "local" | "session"; key: string; value: string }> }
      | { ok: false; error?: string }
      | undefined;

	    if (!result || result.ok !== true || !Array.isArray(result.values)) return null;
	    return result.values;
	  }

  private async readSupabaseAuthCookieValues(
    session: ElectronSession
  ): Promise<Array<{ storage: "cookie"; key: string; value: string }> | null> {
    const keys = storageKeysFromSupabaseUrl();
    const { projectRef } = resolveFlowithSupabaseConfig();
    let supabaseHost = "";
    try {
      supabaseHost = supabaseHostFromConfig().toLowerCase();
    } catch {
      supabaseHost = "";
    }

    let all: Cookie[] = [];
    try {
      const byUrl: Cookie[] = [];
      const hosts = [
        ...FLOWITH_WEB_TARGET_HOSTS,
        FLOWITH_EDGE_HOST,
        ...(supabaseHost ? [supabaseHost] : []),
      ];
      for (const host of hosts) {
        try {
          byUrl.push(...(await session.cookies.get({ url: `https://${host}` })));
        } catch {
          // ignore
        }
      }
      all = byUrl;
    } catch {
      return null;
    }

    if (!Array.isArray(all) || all.length === 0) return null;

    const acceptedDomains = [
      ...FLOWITH_WEB_TARGET_HOSTS,
      FLOWITH_EDGE_HOST,
      ...(supabaseHost ? [supabaseHost] : []),
    ] as readonly string[];
    const values: Array<{ storage: "cookie"; key: string; value: string }> = [];
    const chunked = new Map<string, Array<{ index: number; value: string }>>();

    for (const cookie of all) {
      const domain = typeof cookie.domain === "string" ? cookie.domain.toLowerCase() : "";
      const name = typeof cookie.name === "string" ? cookie.name.trim() : "";
      const value = typeof cookie.value === "string" ? cookie.value : "";
      if (!name || !value) continue;

      const normalizedDomain = domain.startsWith(".") ? domain.slice(1) : domain;
      if (!acceptedDomains.some((host) => normalizedDomain === host || normalizedDomain.endsWith(`.${host}`))) continue;

      const lowerName = name.toLowerCase();
      const projectRefLower = projectRef.toLowerCase();
      const chunkMatch = name.match(/^(.*)\.(\d{1,4})$/);
      if (chunkMatch) {
        const base = chunkMatch[1];
        const rawIndex = chunkMatch[2] ?? "";
        const index = Number.parseInt(rawIndex, 10);
        if (base && Number.isFinite(index)) {
          const existing = chunked.get(base) ?? [];
          existing.push({ index, value });
          chunked.set(base, existing);
          continue;
        }
      }

      const decodedCandidates = safeDecodeCookieValue(value);
      const looksRelevant =
        keys.includes(name) ||
        lowerName.includes(projectRefLower) ||
        lowerName.startsWith("sb-") ||
        lowerName.includes("supabase");

      if (looksRelevant) {
        for (const decoded of decodedCandidates) values.push({ storage: "cookie", key: name, value: decoded });
        continue;
      }

      // Some deployments store auth JSON under generic cookie names. Only keep those that can be parsed.
      for (const decoded of decodedCandidates) {
        const snapshot = extractSupabaseSessionSnapshotFromStorageValue(decoded);
        if (snapshot?.accessToken || snapshot?.refreshToken) {
          values.push({ storage: "cookie", key: name, value: decoded });
          break;
        }
      }
    }

    // Join chunked cookies (e.g. sb-xxx-auth-token.0/.1) before decoding/parsing.
    for (const [base, parts] of chunked.entries()) {
      if (!Array.isArray(parts) || parts.length === 0) continue;
      parts.sort((a, b) => a.index - b.index);
      const joined = parts.map((p) => p.value || "").join("");
      if (!joined || !joined.trim()) continue;
      const decodedCandidates = safeDecodeCookieValue(joined);
      const lowerBase = base.toLowerCase();
      const projectRefLower = projectRef.toLowerCase();
      const looksRelevant =
        keys.includes(base) ||
        lowerBase.includes(projectRefLower) ||
        lowerBase.startsWith("sb-") ||
        lowerBase.includes("supabase");

      if (looksRelevant) {
        for (const decoded of decodedCandidates) {
          values.push({ storage: "cookie", key: `${base}.__joined__`, value: decoded });
        }
        continue;
      }

      for (const decoded of decodedCandidates) {
        const snapshot = extractSupabaseSessionSnapshotFromStorageValue(decoded);
        if (snapshot?.accessToken || snapshot?.refreshToken) {
          values.push({ storage: "cookie", key: `${base}.__joined__`, value: decoded });
          break;
        }
      }
    }

    if (values.length === 0) return null;

    // Some deployments store access/refresh tokens in separate cookies (not JSON).
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    for (const entry of values) {
      const lower = entry.key.toLowerCase();
      const v = entry.value.trim();
      if (!v) continue;
      if (!accessToken && lower.includes("access") && JWT_PATTERN.test(v)) accessToken = v;
      if (!refreshToken && lower.includes("refresh") && v.length >= 24) refreshToken = v;
    }

    if (accessToken || refreshToken) {
      const synthesized = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken });
      values.unshift({ storage: "cookie", key: "__synthetic__", value: synthesized });
    }

    return values;
  }

		  private pickBestSupabaseSnapshot(
		    values: Array<{ storage?: "local" | "session" | "cookie" | "idb"; key?: string; value: string }>
		  ): SupabaseSessionSnapshot | null {
    const { projectRef } = resolveFlowithSupabaseConfig();
    const preferredKeys = [
      `sb-${projectRef}-auth-token`,
      `sb-${projectRef}-all-auth-token`,
      "supabase.auth.token",
    ] as const;

    type Candidate = {
      snapshot: SupabaseSessionSnapshot;
      storage: "local" | "session" | "cookie" | "idb" | "unknown";
      key: string;
    };

    const candidates: Candidate[] = [];
    for (const entry of values) {
      const extracted = extractSupabaseSessionSnapshotFromStorageValue(entry.value);
      if (!extracted) continue;
      if (!extracted.accessToken && !extracted.refreshToken) continue;
      candidates.push({
        snapshot: extracted,
        storage: entry.storage ?? "unknown",
        key: entry.key ?? "",
      });
    }
    if (candidates.length === 0) return null;

    const tokenRank = (snapshot: SupabaseSessionSnapshot): number => {
      if (snapshot.accessToken && snapshot.refreshToken) return 3;
      if (snapshot.accessToken) return 2;
      if (snapshot.refreshToken) return 1;
      return 0;
    };

    const storageRank = (storage: Candidate["storage"]): number => {
      if (storage === "local") return 4;
      if (storage === "session") return 3;
      if (storage === "idb") return 2;
      if (storage === "cookie") return 1;
      return 0;
    };

    const keyRank = (key: string): number => {
      const normalized = key.trim();
      if (normalized === `sb-${projectRef}-auth-token`) return 4;
      if (normalized === `sb-${projectRef}-all-auth-token`) return 3;
      if (normalized === "supabase.auth.token") return 2;
      if (normalized === "sb-server-auth-token") return 0;
      return normalized.includes("auth-token") ? 1 : 0;
    };

    const isActiveAccess = (snapshot: SupabaseSessionSnapshot): boolean => {
      if (!snapshot.accessToken) return false;
      return this.isLikelyActiveAccessToken(snapshot.expiresAt);
    };

    const compare = (a: Candidate, b: Candidate): number => {
      const aa = isActiveAccess(a.snapshot) ? 1 : 0;
      const ba = isActiveAccess(b.snapshot) ? 1 : 0;
      if (aa !== ba) return ba - aa;

      const ae = a.snapshot.expiresAt ?? 0;
      const be = b.snapshot.expiresAt ?? 0;
      if (ae !== be) return be - ae;

      const ar = tokenRank(a.snapshot);
      const br = tokenRank(b.snapshot);
      if (ar !== br) return br - ar;

      const ak = keyRank(a.key);
      const bk = keyRank(b.key);
      if (ak !== bk) return bk - ak;

      const as = storageRank(a.storage);
      const bs = storageRank(b.storage);
      if (as !== bs) return bs - as;

      return 0;
    };

	    // Prefer active access tokens from canonical supabase-js keys first.
	    const activeAccessCandidates = candidates.filter((c) => c.snapshot.accessToken && isActiveAccess(c.snapshot));
	    // Flowith Web keeps its live session under "sb-server-auth-token" in some builds.
	    // Prefer that snapshot when it has an active access token to avoid exporting stale refresh tokens
	    // from duplicated canonical keys.
	    const activeAccessFromServerKey = activeAccessCandidates.filter((c) => c.key.trim() === "sb-server-auth-token");
	    if (activeAccessFromServerKey.length > 0) {
	      activeAccessFromServerKey.sort(compare);
	      return activeAccessFromServerKey[0]?.snapshot ?? null;
	    }
		    const activeAccessFromPreferred = activeAccessCandidates.filter((c) =>
		      preferredKeys.includes(c.key.trim() as (typeof preferredKeys)[number])
		    );
	    if (activeAccessFromPreferred.length > 0) {
	      activeAccessFromPreferred.sort(compare);
	      return activeAccessFromPreferred[0]?.snapshot ?? null;
	    }
    if (activeAccessCandidates.length > 0) {
      activeAccessCandidates.sort(compare);
      return activeAccessCandidates[0]?.snapshot ?? null;
    }

    // If we can't find an active access token, prefer canonical supabase-js keys next.
    for (const key of preferredKeys) {
      const sameKey = candidates.filter((c) => c.key === key);
      if (sameKey.length === 0) continue;
      sameKey.sort(compare);
      return sameKey[0]?.snapshot ?? null;
    }

    // Final fallback: best overall snapshot.
    candidates.sort(compare);
    return candidates[0]?.snapshot ?? null;
	  }

  private pickBestRefreshTokenCandidate(
    values: Array<{ storage?: "local" | "session" | "cookie" | "idb"; key?: string; value: string }>
  ): { refreshToken: string; expiresAt: number | null; source: string; key: string } | null {
    const { projectRef } = resolveFlowithSupabaseConfig();
    const preferredKeys = new Set([
      `sb-${projectRef}-auth-token`,
      `sb-${projectRef}-all-auth-token`,
      "sb-server-auth-token",
      "supabase.auth.token",
    ]);

    type Candidate = { refreshToken: string; expiresAt: number | null; source: string; key: string };

    const normalizeKey = (key: string) => key.trim();
    const normalizeSource = (source: string) => source.trim();
    const keyRank = (key: string): number => {
      const k = normalizeKey(key);
      if (k === `sb-${projectRef}-auth-token`) return 4;
      if (k === `sb-${projectRef}-all-auth-token`) return 3;
      if (k === "supabase.auth.token") return 2;
      if (k === "sb-server-auth-token") return 0;
      if (preferredKeys.has(k)) return 1;
      return k.includes("auth-token") ? 1 : 0;
    };
    const isStandardKey = (key: string): boolean => {
      const k = normalizeKey(key);
      return (
        k === `sb-${projectRef}-auth-token` ||
        k === `sb-${projectRef}-all-auth-token` ||
        k === "supabase.auth.token"
      );
    };
    const sourceRank = (source: string): number => {
      const s = normalizeSource(source);
      if (s === "local") return 4;
      if (s === "session") return 3;
      if (s === "idb") return 2;
      if (s === "cookie") return 1;
      return 0;
    };

    type Group = {
      refreshToken: string;
      count: number;
      standardCount: number;
      maxExpiresAt: number;
      bestKeyRank: number;
      bestSourceRank: number;
      bestCandidate: Candidate;
    };
    const byToken = new Map<string, Group>();

    for (const entry of values) {
      const snapshot = extractSupabaseSessionSnapshotFromStorageValue(entry.value);
      const refreshToken = snapshot?.refreshToken ?? null;
      if (!refreshToken) continue;
      const candidate: Candidate = {
        refreshToken,
        expiresAt: snapshot?.expiresAt ?? null,
        source: entry.storage ?? "unknown",
        key: entry.key ?? "",
      };
      const tokenKey = refreshToken.trim();
      if (!tokenKey) continue;
      const existing = byToken.get(tokenKey);
      if (!existing) {
        byToken.set(tokenKey, {
          refreshToken: tokenKey,
          count: 1,
          standardCount: isStandardKey(candidate.key) ? 1 : 0,
          maxExpiresAt: candidate.expiresAt ?? -1,
          bestKeyRank: keyRank(candidate.key),
          bestSourceRank: sourceRank(candidate.source),
          bestCandidate: candidate,
        });
        continue;
      }

      existing.count += 1;
      if (isStandardKey(candidate.key)) existing.standardCount += 1;
      const expiresAt = candidate.expiresAt ?? -1;
      if (expiresAt > existing.maxExpiresAt) existing.maxExpiresAt = expiresAt;

      const nextKeyRank = keyRank(candidate.key);
      const nextSourceRank = sourceRank(candidate.source);
      const currentKeyRank = keyRank(existing.bestCandidate.key);
      const currentExpiresAt = existing.bestCandidate.expiresAt ?? -1;
      const currentSourceRank = sourceRank(existing.bestCandidate.source);

      const better =
        nextKeyRank > currentKeyRank ||
        (nextKeyRank === currentKeyRank && expiresAt > currentExpiresAt) ||
        (nextKeyRank === currentKeyRank && expiresAt === currentExpiresAt && nextSourceRank > currentSourceRank);

      if (better) existing.bestCandidate = candidate;
      if (nextKeyRank > existing.bestKeyRank) existing.bestKeyRank = nextKeyRank;
      if (nextSourceRank > existing.bestSourceRank) existing.bestSourceRank = nextSourceRank;
    }

    if (byToken.size === 0) return null;

	    const groups = [...byToken.values()];
	    const hasStandard = groups.some((g) => g.standardCount > 0);
	    groups.sort((a, b) => {
	      const aa = this.isLikelyActiveAccessToken(a.maxExpiresAt > 0 ? a.maxExpiresAt : null) ? 1 : 0;
	      const ba = this.isLikelyActiveAccessToken(b.maxExpiresAt > 0 ? b.maxExpiresAt : null) ? 1 : 0;
	      if (aa !== ba) return ba - aa;

	      // Prefer fresher expiry when comparing the same "activeness".
	      if (a.maxExpiresAt !== b.maxExpiresAt) return b.maxExpiresAt - a.maxExpiresAt;

	      // If both appear active, prefer standard supabase-js keys.
	      if (hasStandard && aa === 1) {
	        const aStd = a.standardCount > 0 ? 1 : 0;
	        const bStd = b.standardCount > 0 ? 1 : 0;
	        if (aStd !== bStd) return bStd - aStd;
	      }

	      if (a.standardCount !== b.standardCount) return b.standardCount - a.standardCount;
	      if (a.count !== b.count) return b.count - a.count;
	      if (a.bestKeyRank !== b.bestKeyRank) return b.bestKeyRank - a.bestKeyRank;
	      if (a.bestSourceRank !== b.bestSourceRank) return b.bestSourceRank - a.bestSourceRank;
      return 0;
    });

    return groups[0]?.bestCandidate ?? null;
  }

  private async readBestSupabaseSnapshotFromCookies(session: ElectronSession): Promise<SupabaseSessionSnapshot | null> {
    const values = await this.readSupabaseAuthCookieValues(session);
    if (!values) return null;
    return this.pickBestSupabaseSnapshot(values);
  }

	  private async readBestSupabaseSnapshotFromWebContents(
	    webContents: WebContents,
	    options?: { includeIndexedDb?: boolean }
	  ): Promise<SupabaseSessionSnapshot | null> {
	    const values = await this.collectAuthValues(webContents, options);
      if (values.length === 0) return null;
      return this.pickBestSupabaseSnapshot(values);
	  }

  private async readBestRefreshTokenCandidateFromWebContents(
    webContents: WebContents,
    options?: { includeIndexedDb?: boolean }
  ): Promise<{ refreshToken: string; expiresAt: number | null; source: string; key: string } | null> {
    const values = await this.collectAuthValues(webContents, options);
    if (values.length === 0) return null;
    return this.pickBestRefreshTokenCandidate(values);
  }

	  private async readBestRefreshTokenFromWebContents(
	    webContents: WebContents,
	    options?: { includeIndexedDb?: boolean }
	  ): Promise<string | null> {
    const best = await this.readBestRefreshTokenCandidateFromWebContents(webContents, options);
    return best?.refreshToken ?? null;
	  }

  private async waitForRefreshTokenCandidateFromWebContents(
    webContents: WebContents,
    timeoutMs: number
  ): Promise<{ refreshToken: string; expiresAt: number | null; source: string; key: string } | null> {
	    const budget = Math.max(0, timeoutMs);
    if (budget <= 0) return await this.readBestRefreshTokenCandidateFromWebContents(webContents, { includeIndexedDb: true });

	    const deadline = Date.now() + budget;
	    while (Date.now() <= deadline) {
	      if (webContents.isDestroyed()) return null;
	      try {
        const candidate = await this.readBestRefreshTokenCandidateFromWebContents(webContents, { includeIndexedDb: true });
        if (candidate?.refreshToken) return candidate;
	      } catch {
	        // ignore
	      }

      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

	    return null;
	  }

	  private async waitForRefreshTokenFromWebContents(webContents: WebContents, timeoutMs: number): Promise<string | null> {
    const candidate = await this.waitForRefreshTokenCandidateFromWebContents(webContents, timeoutMs);
    return candidate?.refreshToken ?? null;
	  }

  private async waitForSupabaseSnapshotFromWebContents(
    webContents: WebContents,
    options?: { timeoutMs?: number; require?: "any" | "refreshToken" }
  ): Promise<SupabaseSessionSnapshot | null> {
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 0);
    if (timeoutMs <= 0) return await this.readBestSupabaseSnapshotFromWebContents(webContents);
    const require = options?.require ?? "any";

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (webContents.isDestroyed()) return null;
      try {
        const snapshot = await this.readBestSupabaseSnapshotFromWebContents(webContents);
        if (!snapshot) {
          // ignore
        } else if (require === "refreshToken") {
          if (snapshot.refreshToken) return snapshot;
        } else {
          if (snapshot.accessToken || snapshot.refreshToken) return snapshot;
        }
      } catch {
        // ignore
      }

      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

    return null;
  }

  private isLikelyActiveAccessToken(expiresAt: number | null): boolean {
    if (!expiresAt || !Number.isFinite(expiresAt)) return true;
    // Give a small buffer to avoid treating near-expiry token as "active".
    return expiresAt > Date.now() + 60_000;
  }

  private async readAccessTokenFromWebContents(webContents: WebContents): Promise<string | null> {
    const snapshot = await this.readBestSupabaseSnapshotFromWebContents(webContents);
    return snapshot?.accessToken ?? null;
  }

  private async waitForAccessTokenFromWebContents(
    webContents: WebContents,
    options?: { timeoutMs?: number }
  ): Promise<string | null> {
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 0);
    if (timeoutMs <= 0) return await this.readAccessTokenFromWebContents(webContents);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (webContents.isDestroyed()) return null;
      try {
        const token = await this.readAccessTokenFromWebContents(webContents);
        if (token) return token;
      } catch {
        // ignore
      }

      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    }
    return null;
  }

  async peekAccessTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;

    const timeoutMs = options?.timeoutMs ?? 0;
    const task = (async () => {
      try {
        return await this.readAccessTokenFromWebContents(webContents);
      } catch {
        return null;
      }
    })();

    if (timeoutMs <= 0) return await task;

    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }

  async peekRefreshTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;

    const timeoutMs = options?.timeoutMs ?? 0;
    const task = (async () => {
      try {
        return await this.readBestRefreshTokenFromWebContents(webContents, { includeIndexedDb: true });
      } catch {
        return null;
      }
    })();

    if (timeoutMs <= 0) return await task;

    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }

  async waitForAccessTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;
    try {
      return await this.waitForAccessTokenFromWebContents(webContents, options);
    } catch {
      return null;
    }
  }

	  async waitForRefreshTokenFromOpenTab(
      accountId: string,
      options?: { timeoutMs?: number; requireActiveAccess?: boolean }
    ): Promise<string | null> {
	    const webContents = this.workspace.getWebContents(accountId);
	    if (!webContents) return null;
	    try {
	      const timeoutMs = Math.max(0, options?.timeoutMs ?? 0);
        const candidate = await this.waitForRefreshTokenCandidateFromWebContents(webContents, timeoutMs);
        if (!candidate?.refreshToken) return null;
        if (options?.requireActiveAccess) {
          // The export path must only accept refresh_token that comes with an active access token
          // from the same storage value; otherwise we risk exporting stale/rotated tokens.
          if (candidate.expiresAt == null) return null;
          if (!this.isLikelyActiveAccessToken(candidate.expiresAt)) return null;
        }
        return candidate.refreshToken;
	    } catch {
	      return null;
	    }
	  }

  async reconcileSessionForOpenTab(
    accountId: string,
    session: Session,
    options?: { timeoutMs?: number; reload?: boolean }
  ): Promise<boolean> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents || webContents.isDestroyed()) return false;

    const timeoutMs = options?.timeoutMs ?? 0;
    if (timeoutMs > 0) {
      try {
        await waitForFlowithReady(webContents, timeoutMs);
      } catch {
        return false;
      }
    } else {
      let href: unknown;
      try {
        href = await webContents.executeJavaScript("location.href", true);
      } catch {
        return false;
      }
      if (typeof href !== "string" || !isFlowithUrl(href)) return false;
    }

    try {
      await injectSupabaseSession(webContents, session);
    } catch {
      return false;
    }

    this.ensureAuthHeaderInjection(accountId, webContents, session.access_token ?? "");
    if (options?.reload ?? true) {
      try {
        webContents.reload();
      } catch {
        // ignore
      }
    }
    this.ensureTokenSync(accountId, webContents);
    return true;
  }

  private async syncTokensFromWebContents(
    accountId: string,
    webContents: WebContents,
    options?: { forceRefreshTokenWrite?: boolean }
  ): Promise<void> {
    if (webContents.isDestroyed()) return;

    const currentVaultRefreshToken = getRefreshToken(accountId);
    const canOverwriteVaultRefreshToken =
      !currentVaultRefreshToken || isKnownUsedRefreshToken(accountId, currentVaultRefreshToken);

    const allowRefreshTokenWrite =
      (this.refreshTokenWriteDeadlines.get(accountId) ?? 0) > Date.now() ||
      (options?.forceRefreshTokenWrite && canOverwriteVaultRefreshToken) ||
      canOverwriteVaultRefreshToken;

    const deepScan =
      (this.refreshTokenWriteDeadlines.get(accountId) ?? 0) > Date.now() || (options?.forceRefreshTokenWrite ?? false);
    const snapshot = await this.readBestSupabaseSnapshotFromWebContents(
      webContents,
      deepScan ? { includeIndexedDb: true } : undefined
    );
    const nextAccessToken = snapshot?.accessToken ?? null;
    const values = await this.collectAuthValues(webContents, deepScan ? { includeIndexedDb: true } : undefined);
    const refreshCandidate = this.pickBestRefreshTokenCandidate(values);
    const accessExpiresAt = snapshot?.expiresAt ?? null;
    const hasActiveAccess = Boolean(nextAccessToken && this.isLikelyActiveAccessToken(accessExpiresAt));
    const nextRefreshToken = refreshCandidate?.refreshToken ?? null;
    const allowPersistNonStandardRefreshToken = Boolean(
      hasActiveAccess && nextRefreshToken && (refreshCandidate?.key ?? "").trim() === "sb-server-auth-token"
    );

    if (!nextAccessToken && !nextRefreshToken) return;

    if (nextRefreshToken && currentVaultRefreshToken !== nextRefreshToken) {
      // Only persist refresh_token when it comes from canonical supabase-js storage keys.
      // Non-standard keys like "sb-server-auth-token" are prone to being stale and may cause exporting old tokens.
      if (!allowPersistNonStandardRefreshToken && !isStandardSupabaseAuthKey(refreshCandidate?.key ?? "")) {
        if (nextAccessToken) this.ensureAuthHeaderInjection(accountId, webContents, nextAccessToken);
        return;
      }

      const shouldWriteRefreshToken =
	        allowRefreshTokenWrite ||
	        !currentVaultRefreshToken ||
	        (nextAccessToken && this.isLikelyActiveAccessToken(accessExpiresAt));

      if (shouldWriteRefreshToken && !isKnownUsedRefreshToken(accountId, nextRefreshToken)) {
        setRefreshToken(accountId, nextRefreshToken);
      }
    }

    if (nextAccessToken) this.ensureAuthHeaderInjection(accountId, webContents, nextAccessToken);
  }

  async debugAuthSourcesFromOpenTab(accountId: string): Promise<{
    accountId: string;
    hasOpenTab: boolean;
    href: string | null;
    selected: {
      accessTokenFp: string | null;
      refreshTokenFp: string | null;
      expiresAt: number | null;
    } | null;
	    candidates: Array<{
	      source: "local" | "session" | "cookie" | "idb";
	      key: string;
	      parsed: boolean;
	      accessTokenFp: string | null;
	      accessTokenLen: number | null;
	      refreshTokenFp: string | null;
      refreshTokenLen: number | null;
      expiresAt: number | null;
    }>;
	  }> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents || webContents.isDestroyed()) {
      return { accountId, hasOpenTab: false, href: null, selected: null, candidates: [] };
    }

    let href: string | null = null;
    try {
      const raw = (await webContents.executeJavaScript("location.href", true)) as unknown;
      if (typeof raw === "string") href = raw;
    } catch {
      href = null;
    }

    const values = await this.collectAuthValues(webContents, { includeIndexedDb: true });

    const candidates = values.map((entry) => {
      const snapshot = extractSupabaseSessionSnapshotFromStorageValue(entry.value);
      const accessToken = snapshot?.accessToken ?? null;
      const refreshToken = snapshot?.refreshToken ?? null;
      return {
        source: entry.storage,
        key: entry.key,
        parsed: Boolean(snapshot),
        accessTokenFp: accessToken ? this.fingerprintToken(accessToken) : null,
        accessTokenLen: accessToken ? accessToken.length : null,
        refreshTokenFp: refreshToken ? this.fingerprintToken(refreshToken) : null,
        refreshTokenLen: refreshToken ? refreshToken.length : null,
        expiresAt: snapshot?.expiresAt ?? null,
      };
    });

	    const selectedSnapshot = this.pickBestSupabaseSnapshot(values);
	    const selectedRefresh = this.pickBestRefreshTokenCandidate(values);

	    const access = selectedSnapshot?.accessToken ?? null;
	    const accessExpiresAt = selectedSnapshot?.expiresAt ?? null;
	    const hasActiveAccess = Boolean(access && this.isLikelyActiveAccessToken(accessExpiresAt));
	    const refresh = hasActiveAccess
	      ? selectedSnapshot?.refreshToken ?? selectedRefresh?.refreshToken ?? null
	      : selectedRefresh?.refreshToken ?? selectedSnapshot?.refreshToken ?? null;
	    const expiresAt =
	      hasActiveAccess && selectedSnapshot?.refreshToken
	        ? accessExpiresAt
	        : selectedRefresh?.expiresAt ?? accessExpiresAt;
	    const selected = access || refresh
	      ? {
	          accessTokenFp: access ? this.fingerprintToken(access) : null,
	          refreshTokenFp: refresh ? this.fingerprintToken(refresh) : null,
	          expiresAt,
	        }
	      : null;

	    return { accountId, hasOpenTab: true, href, selected, candidates };
	  }

  private ensureTokenSync(accountId: string, webContents: WebContents) {
    if (this.tokenSync.has(accountId)) return;
    if (webContents.isDestroyed()) return;

	    let stopped = false;
	    let handle: ReturnType<typeof setTimeout> | null = null;
	    let refreshSyncDebounce: ReturnType<typeof setTimeout> | null = null;
	    let didFinishLoadListener: (() => void) | null = null;

	      const stop = () => {
	      stopped = true;
	      if (handle) clearTimeout(handle);
	      if (refreshSyncDebounce) clearTimeout(refreshSyncDebounce);
	      this.refreshTokenWriteDeadlines.delete(accountId);
	      if (didFinishLoadListener) {
	        try {
	          webContents.removeListener("did-finish-load", didFinishLoadListener);
	        } catch {
	          // ignore
	        }
	        didFinishLoadListener = null;
	      }
	      try {
	        webContents.session.webRequest.onCompleted(null);
	      } catch {
	        // ignore
	      }
      this.tokenSync.delete(accountId);
    };

    const scheduleSyncSoon = () => {
      if (stopped) return;
      if (refreshSyncDebounce) clearTimeout(refreshSyncDebounce);
      refreshSyncDebounce = setTimeout(async () => {
        refreshSyncDebounce = null;
        if (stopped || webContents.isDestroyed()) return;
        try {
          await this.syncTokensFromWebContents(accountId, webContents);
        } catch {
          // best-effort
        }
      }, 1000);
    };

    const tick = async () => {
      if (stopped) return;
      if (webContents.isDestroyed()) {
        stop();
        return;
      }

      try {
        await this.syncTokensFromWebContents(accountId, webContents);
      } catch {
        // best-effort
      }

      if (!stopped) {
        handle = setTimeout(tick, 15_000);
      }
    };

	    try {
	      webContents.once("destroyed", stop);
	    } catch {
	      // ignore
	    }

	    // When the user reloads the tab (Ctrl+R/F5), sync tokens again as soon as the page finishes loading.
	    // This helps recover from slow networks and prevents the UI from getting stuck with stale vault tokens.
	    try {
	      const onFinishLoad = () => {
	        if (stopped) return;
	        this.refreshTokenWriteDeadlines.set(accountId, Date.now() + 10_000);
	        scheduleSyncSoon();
	      };
	      didFinishLoadListener = onFinishLoad;
	      webContents.on("did-finish-load", onFinishLoad);
	    } catch {
	      // ignore
	    }

	    try {
	      const supabaseHost = supabaseHostFromConfig();
	      const filter = {
	        urls: [`https://${supabaseHost}/auth/v1/token*`],
	      };

      const listener = (details: OnCompletedListenerDetails) => {
        if (stopped) return;
        try {
          const url = new URL(details.url);
          if (!url.pathname.includes("/auth/v1/token")) return;
          const grantType = url.searchParams.get("grant_type");
          if (grantType && grantType !== "refresh_token") return;
        } catch {
          return;
        }

        this.refreshTokenWriteDeadlines.set(accountId, Date.now() + 30_000);
        scheduleSyncSoon();
      };

      webContents.session.webRequest.onCompleted(filter, listener);
    } catch {
      // ignore
    }

    handle = setTimeout(tick, 8_000);
    this.tokenSync.set(accountId, { stop });
  }

  async syncFromOpenTab(
    accountId: string,
    options?: { timeoutMs?: number; forceRefreshTokenWrite?: boolean }
  ): Promise<void> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return;
    const timeoutMs = options?.timeoutMs ?? 0;
    const task = (async () => {
      try {
        if (timeoutMs > 0) {
          await this.waitForSupabaseSnapshotFromWebContents(webContents, { timeoutMs });
        }
        await this.syncTokensFromWebContents(
          accountId,
          webContents,
          options?.forceRefreshTokenWrite ? { forceRefreshTokenWrite: true } : undefined
        );
      } catch {
        // best-effort
      }
    })();

    if (timeoutMs <= 0) {
      await task;
      return;
    }

    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  async syncOpenTabsBeforeQuit(options?: { totalTimeoutMs?: number; perTabTimeoutMs?: number }): Promise<void> {
    const totalTimeoutMs = options?.totalTimeoutMs ?? 2000;
    const perTabTimeoutMs = options?.perTabTimeoutMs ?? 800;
    const deadline = Date.now() + totalTimeoutMs;

    for (const accountId of this.workspace.listOpenTabs()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const budget = Math.min(perTabTimeoutMs, remaining);
      await this.syncFromOpenTab(accountId, { timeoutMs: budget });
    }
  }

  async waitForNewRefreshTokenFromOpenTab(
    accountId: string,
    options?: { totalTimeoutMs?: number; perSyncTimeoutMs?: number }
  ): Promise<boolean> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents || webContents.isDestroyed()) return false;

    const totalTimeoutMs = options?.totalTimeoutMs ?? 8000;
    const perSyncTimeoutMs = options?.perSyncTimeoutMs ?? 1000;

    const before = getRefreshToken(accountId);
    const deadline = Date.now() + totalTimeoutMs;
    while (Date.now() < deadline) {
      await this.syncFromOpenTab(accountId, { timeoutMs: perSyncTimeoutMs, forceRefreshTokenWrite: true });
      const current = getRefreshToken(accountId);
      if (current && current !== before && !isKnownUsedRefreshToken(accountId, current)) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
    }

    return false;
  }

  private ensureAuthHeaderInjection(accountId: string, webContents: WebContents, accessToken: string) {
    const existing = this.headerInjection.get(accountId);
    if (existing) {
      existing.setAccessToken(accessToken);
      return;
    }

    const supabaseHost = supabaseHostFromConfig();
    let token = accessToken;
    const toBearer = (value: string): string => {
      const raw = value.trim();
      if (!raw) return "";
      return raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}`;
    };

    const filter = {
      urls: ["https://edge.flowith.net/*", `https://${supabaseHost}/*`, `wss://${supabaseHost}/*`],
    };

    const injector = (details: OnBeforeSendHeadersListenerDetails, callback: (response: BeforeSendResponse) => void) => {
      try {
        if (!token) {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }
        if (details.method === "OPTIONS") {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }

        const headers = { ...details.requestHeaders } as Record<string, string | string[]>;
        const hasAuthorization = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
        if (hasAuthorization) {
          callback({ requestHeaders: headers });
          return;
        }

        let host = "";
        try {
          host = new URL(details.url).hostname;
        } catch {
          callback({ requestHeaders: headers });
          return;
        }

        if (host === "edge.flowith.net") {
          headers["Authorization"] = toBearer(token);
        } else if (host === supabaseHost) {
          headers["Authorization"] = toBearer(token);
        }

        callback({ requestHeaders: headers });
      } catch {
        callback({ requestHeaders: details.requestHeaders });
      }
    };

    try {
      webContents.session.webRequest.onBeforeSendHeaders(filter, injector);
    } catch {
      return;
    }

    this.headerInjection.set(accountId, {
      setAccessToken: (next) => {
        token = next;
      },
    });
  }

  async bootstrap(accountId: string) {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) throw new Error("Workspace webContents not found for account.");

    await waitForFlowithReady(webContents, 30_000);
    this.ensureTokenSync(accountId, webContents);
    await this.syncFromOpenTab(accountId, { timeoutMs: 1000, forceRefreshTokenWrite: true });

    // Tab-first: if the page already has a valid access token in its own storage (persisted profile),
    // do not refresh via vault refresh_token. This avoids "already used" caused by vault/tab divergence.
    const tabSnapshot = await this.waitForSupabaseSnapshotFromWebContents(webContents, { timeoutMs: 4000 });
    const tabAccessToken = tabSnapshot?.accessToken ?? null;
    const tabExpiresAt = tabSnapshot?.expiresAt ?? null;
    const tabHasActiveAccess = Boolean(tabAccessToken && this.isLikelyActiveAccessToken(tabExpiresAt));
    if (tabHasActiveAccess) {
      this.ensureAuthHeaderInjection(accountId, webContents, tabAccessToken ?? "");
      // Only treat the tab as "ready" when we can also see a refresh_token; otherwise we may be looking at
      // a non-user/anonymous session snapshot and would incorrectly skip vault bootstrap.
      if (tabSnapshot?.refreshToken) return;

      const refreshCandidate = await this.waitForRefreshTokenCandidateFromWebContents(webContents, 1500);
      if (refreshCandidate?.refreshToken) return;
    }

    // If the tab has a refresh_token but no active access token, give the page a moment to recover its own access token
    // (supabase-js auto refresh) before falling back to vault refresh. This reduces refresh_token contention.
    if (tabSnapshot?.refreshToken) {
      const recovered = await this.waitForSupabaseSnapshotFromWebContents(webContents, { timeoutMs: 6000 });
      const recoveredAccessToken = recovered?.accessToken ?? null;
      if (recoveredAccessToken && this.isLikelyActiveAccessToken(recovered?.expiresAt ?? null)) {
        this.ensureAuthHeaderInjection(accountId, webContents, recoveredAccessToken);
        return;
      }
    }

    let flowithSession: Session;
    try {
      flowithSession = await refreshFlowithSessionForAccount(accountId, {
        onAlreadyUsed: async () => {
          await this.waitForNewRefreshTokenFromOpenTab(accountId);
        },
      });
    } catch (e) {
      if (!isAlreadyUsedError(e)) throw e;
      await this.waitForNewRefreshTokenFromOpenTab(accountId);
      return;
    }

    await injectSupabaseSession(webContents, flowithSession);
    this.ensureAuthHeaderInjection(accountId, webContents, flowithSession.access_token ?? "");
    webContents.reload();
    this.ensureTokenSync(accountId, webContents);
  }
}
