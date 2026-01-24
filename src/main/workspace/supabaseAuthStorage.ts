export type SupabaseSessionTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

function extractFromObject(value: unknown): SupabaseSessionTokens | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const accessToken =
    typeof record.access_token === "string"
      ? record.access_token
      : typeof record.accessToken === "string"
        ? record.accessToken
        : null;
  const refreshToken =
    typeof record.refresh_token === "string"
      ? record.refresh_token
      : typeof record.refreshToken === "string"
        ? record.refreshToken
        : null;

  if (accessToken || refreshToken) {
    return { accessToken: accessToken?.trim() || null, refreshToken: refreshToken?.trim() || null };
  }

  const nestedCandidates = [record.currentSession, record.session, record.data];
  for (const nested of nestedCandidates) {
    const extracted = extractFromObject(nested);
    if (extracted) return extracted;
  }

  return null;
}

export function extractSupabaseSessionTokensFromStorageValue(storageValue: string): SupabaseSessionTokens | null {
  const raw = storageValue.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return extractFromObject(parsed);
  } catch {
    return null;
  }
}

