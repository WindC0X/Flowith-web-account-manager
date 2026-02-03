export type SupabaseSessionTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

export type SupabaseSessionSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function normalizeToken(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function normalizeExpiresAt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  // Supabase Session uses expires_at in unix seconds. Some wrappers may store ms.
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

function decodeBase64UrlToUtf8(raw: string): string | null {
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function decodeJwtExpiresAt(accessToken: string): number | null {
  if (!JWT_PATTERN.test(accessToken)) return null;
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1] ?? "";
  if (!payload) return null;
  const decoded = decodeBase64UrlToUtf8(payload);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const exp = (parsed as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
    return Math.round(exp * 1000);
  } catch {
    return null;
  }
}

function extractFromObject(value: unknown): SupabaseSessionSnapshot | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return extractFromObject(parsed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const candidates: SupabaseSessionSnapshot[] = [];

  const accessToken = normalizeToken(record.access_token) ?? normalizeToken(record.accessToken);
  const refreshToken = normalizeToken(record.refresh_token) ?? normalizeToken(record.refreshToken);
  let expiresAt = normalizeExpiresAt(record.expires_at) ?? normalizeExpiresAt(record.expiresAt);
  if (!expiresAt && accessToken) expiresAt = decodeJwtExpiresAt(accessToken);

  if (accessToken || refreshToken) {
    candidates.push({ accessToken, refreshToken, expiresAt });
  }

  const nestedCandidates = [record.currentSession, record.session, record.data];
  for (const nested of nestedCandidates) {
    const extracted = extractFromObject(nested);
    if (extracted) candidates.push(extracted);
  }

  if (candidates.length === 0) return null;

  const rank = (snapshot: SupabaseSessionSnapshot): number => {
    if (snapshot.accessToken && snapshot.refreshToken) return 3;
    if (snapshot.refreshToken) return 2;
    if (snapshot.accessToken) return 1;
    return 0;
  };

  candidates.sort((a, b) => {
    const ar = rank(a);
    const br = rank(b);
    if (ar !== br) return br - ar;
    const ae = a.expiresAt ?? 0;
    const be = b.expiresAt ?? 0;
    if (ae !== be) return be - ae;
    return 0;
  });

  return candidates[0] ?? null;
}

export function extractSupabaseSessionSnapshotFromStorageValue(
  storageValue: string
): SupabaseSessionSnapshot | null {
  const raw = storageValue.trim();
  if (!raw) return null;

  const candidates: string[] = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded && decoded !== raw) candidates.push(decoded.trim());
  } catch {
    // ignore
  }

  const stripCookieWrappers = (value: string): string[] => {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const out = [trimmed];
    if (trimmed.startsWith("j:")) out.push(trimmed.slice(2).trim());
    if (trimmed.startsWith("s:")) {
      const rest = trimmed.slice(2).trim();
      out.push(rest);
      const lastDot = rest.lastIndexOf(".");
      if (lastDot > 0) out.push(rest.slice(0, lastDot).trim());
    }
    return out;
  };

  const wrapped: string[] = [];
  for (const c of candidates) wrapped.push(...stripCookieWrappers(c));
  candidates.push(...wrapped);

  if (/^[A-Za-z0-9+/=]{32,}$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf-8").trim();
      if (decoded) candidates.push(decoded);
    } catch {
      // ignore
    }
  }

  if (/^[A-Za-z0-9_-]{32,}$/.test(raw) && !raw.includes(".")) {
    const decoded = decodeBase64UrlToUtf8(raw)?.trim() ?? "";
    if (decoded) candidates.push(decoded);
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const extracted = extractFromObject(parsed);
      if (extracted) return extracted;
    } catch {
      // try extracting JSON object substring as a last resort
      try {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start >= 0 && end > start) {
          const slice = trimmed.slice(start, end + 1);
          const parsed = JSON.parse(slice) as unknown;
          const extracted = extractFromObject(parsed);
          if (extracted) return extracted;
        }
      } catch {
        // try next
      }
    }
  }

  return null;
}

export function extractSupabaseSessionTokensFromStorageValue(storageValue: string): SupabaseSessionTokens | null {
  const snapshot = extractSupabaseSessionSnapshotFromStorageValue(storageValue);
  if (!snapshot) return null;
  return { accessToken: snapshot.accessToken, refreshToken: snapshot.refreshToken };
}
