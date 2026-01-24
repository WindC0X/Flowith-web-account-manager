import type { DownloadItem } from "electron";

type DownloadItemLike = Pick<DownloadItem, "getURLChain" | "getURL">;

function normalizeUrlForKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return `${url.origin}${url.pathname}`;
    }
    if (url.protocol === "blob:") {
      // Node/Electron URL parser represents the embedded URL as the pathname.
      return `blob:${url.pathname}`;
    }
  } catch {
    // ignore
  }

  return null;
}

export function computeSaveAsDedupKeys(accountId: string, item: DownloadItemLike, filename: string): string[] {
  const normalizedAccountId = accountId.trim();
  const normalizedFilename = (filename.trim() || "download").toLowerCase();

  const keys: string[] = [`${normalizedAccountId}:name:${normalizedFilename}`];
  const candidates: string[] = [];

  try {
    const chain = item.getURLChain();
    for (const candidate of chain) {
      if (typeof candidate === "string") candidates.push(candidate);
    }
  } catch {
    // ignore
  }

  try {
    const candidate = item.getURL();
    if (typeof candidate === "string") candidates.push(candidate);
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    const normalized = normalizeUrlForKey(candidate);
    if (normalized) keys.push(`${normalizedAccountId}:url:${normalized}`);
  }

  return [...new Set(keys)];
}
