export type SupabaseSessionTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

export type SupabaseSessionSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

function normalizeToken(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function normalizeExpiresAt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  // Supabase Session uses expires_at in unix seconds. Some wrappers may store ms.
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

function extractFromObject(value: unknown): SupabaseSessionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const accessToken =
    normalizeToken(record.access_token) ??
    normalizeToken(record.accessToken);
  const refreshToken =
    normalizeToken(record.refresh_token) ??
    normalizeToken(record.refreshToken);
  const expiresAt =
    normalizeExpiresAt(record.expires_at) ??
    normalizeExpiresAt(record.expiresAt);

  if (accessToken || refreshToken) {
    return { accessToken, refreshToken, expiresAt };
  }

  const nestedCandidates = [record.currentSession, record.session, record.data];
  for (const nested of nestedCandidates) {
    const extracted = extractFromObject(nested);
    if (extracted) return extracted;
  }

  return null;
}

export function extractSupabaseSessionSnapshotFromStorageValue(
  storageValue: string
): SupabaseSessionSnapshot | null {
  const raw = storageValue.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return extractFromObject(parsed);
  } catch {
    return null;
  }
}

export function extractSupabaseSessionTokensFromStorageValue(storageValue: string): SupabaseSessionTokens | null {
  const snapshot = extractSupabaseSessionSnapshotFromStorageValue(storageValue);
  if (!snapshot) return null;
  return { accessToken: snapshot.accessToken, refreshToken: snapshot.refreshToken };
}
