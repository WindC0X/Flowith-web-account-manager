import type { AccountMetaPatch, ProxyConfig } from "../../shared/ipc";
import { normalizeTags } from "../../shared/tags";
import { normalizeProxyConfig } from "../network/proxy";
import { normalizeUaConfig } from "../network/userAgent";

const DEFAULT_PROXY: ProxyConfig = { mode: "system" };

export function normalizeAccountMetaPatch(patch: AccountMetaPatch): AccountMetaPatch {
  const next: AccountMetaPatch = { ...patch };

  if (patch.tags !== undefined) {
    next.tags = normalizeTags(patch.tags);
  }

  if (patch.net !== undefined) {
    const rawNet = patch.net as Partial<{ proxy: ProxyConfig }>;
    next.net = { proxy: normalizeProxyConfig(rawNet.proxy ?? DEFAULT_PROXY) };
  }

  if (patch.ua !== undefined) {
    next.ua = normalizeUaConfig(patch.ua);
  }

  return next;
}

