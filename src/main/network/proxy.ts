import type { Session } from "electron";
import type { ProxyConfig } from "../../shared/ipc";

export function containsProxyCredentials(text: string): boolean {
  return /(^|\W)[^\s;,@/:]+:[^\s;,@/]+@/.test(text);
}

export function validateProxyConfig(proxy: ProxyConfig) {
  if (proxy.mode === "system" || proxy.mode === "direct") return;
  if (proxy.mode !== "custom") throw new Error("Invalid proxy mode.");

  const rules = proxy.rules?.trim();
  if (!rules) throw new Error("Custom proxy rules are required.");
  if (containsProxyCredentials(rules)) {
    throw new Error("Proxy rules must not include username:password credentials.");
  }
}

export function normalizeProxyConfig(proxy: ProxyConfig): ProxyConfig {
  if (proxy.mode === "system" || proxy.mode === "direct") return { mode: proxy.mode };
  validateProxyConfig(proxy);
  return { mode: "custom", rules: proxy.rules!.trim() };
}

export async function applyProxy(session: Session, proxy: ProxyConfig) {
  if (proxy.mode === "system") {
    await session.setProxy({ mode: "system" });
    return;
  }
  if (proxy.mode === "direct") {
    await session.setProxy({ mode: "direct" });
    return;
  }

  const normalized = normalizeProxyConfig(proxy);
  await session.setProxy({ mode: "fixed_servers", proxyRules: normalized.rules! });
}
