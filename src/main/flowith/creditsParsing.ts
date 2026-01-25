type CreditsEntry = {
  sub_type?: unknown;
  remain_quota?: unknown;
  init_quota?: unknown;
  remain_days?: unknown;
  to_date?: unknown;
};

export type ParsedCredits = {
  subscriptionType: string | null;
  subscriptionExpiresAt: number | null;
  remainingCredits: number;
  totalCredits: number;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[,_]/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    if (value < 1_000_000_000_000) return Math.round(value * 1000);
    return Math.round(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;

    const n = normalizeNumber(trimmed);
    if (typeof n === "number") return normalizeEpochMs(n);
  }

  return null;
}

function pickPrimarySubscription(
  subscriptions: CreditsEntry[]
): { subscriptionType: string | null; subscriptionExpiresAt: number | null } {
  if (subscriptions.length === 0) return { subscriptionType: null, subscriptionExpiresAt: null };

  const normalizeType = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");
  const normalizeTypeKey = (raw: unknown) => normalizeType(raw).toLowerCase().replace(/[\s-]+/g, "_");

  const now = Date.now();
  const tierScore = (key: string) => {
    if (!key) return 0;
    if (key.includes("enterprise")) return 5;
    if (key.includes("pro")) return 4;
    if (key.includes("plus")) return 3;
    if (key.includes("premium")) return 3;
    if (key === "os_access" || key.startsWith("os_access_")) return 2;
    if (key.includes("trial")) return 0;
    return 1;
  };

  const normalizeExpiryForActiveCheck = (toDateMs: number) => {
    if (toDateMs <= 0) return 0;
    const d = new Date(toDateMs);
    const isUtcMidnight =
      d.getUTCHours() === 0 &&
      d.getUTCMinutes() === 0 &&
      d.getUTCSeconds() === 0 &&
      d.getUTCMilliseconds() === 0;
    if (!isUtcMidnight) return toDateMs;
    return toDateMs + 86_400_000 - 1;
  };

  const score = (s: CreditsEntry) => {
    const remainDays = normalizeNumber(s.remain_days) ?? 0;
    const remainQuota = normalizeNumber(s.remain_quota) ?? 0;
    const toDateMs = normalizeExpiryForActiveCheck(normalizeEpochMs(s.to_date) ?? 0);
    const key = normalizeTypeKey(s.sub_type);
    const active = toDateMs > 0 ? toDateMs > now : remainDays > 0 || remainQuota > 0;
    return { key, active, tier: tierScore(key), remainDays, remainQuota, toDateMs };
  };

  const nonInvitation = subscriptions.filter((s) => normalizeTypeKey(s.sub_type) !== "invitation");
  const primaryPool = nonInvitation.length > 0 ? nonInvitation : subscriptions;

  const typed = primaryPool.filter((s) => normalizeTypeKey(s.sub_type) !== "");
  const pool = typed.length > 0 ? typed : primaryPool;

  const scored = pool
    .map((s) => ({ entry: s, rawType: normalizeType(s.sub_type), score: score(s) }))
    .filter((s) => Boolean(s.rawType));

  if (scored.length === 0) return { subscriptionType: null, subscriptionExpiresAt: null };

  const hasActive = scored.some((s) => s.score.active);
  const candidates = hasActive ? scored.filter((s) => s.score.active) : scored;

  candidates.sort((a, b) => {
    const sa = a.score;
    const sb = b.score;
    if (sb.tier !== sa.tier) return sb.tier - sa.tier;
    if (sb.remainDays !== sa.remainDays) return sb.remainDays - sa.remainDays;
    if (sb.remainQuota !== sa.remainQuota) return sb.remainQuota - sa.remainQuota;
    return sb.toDateMs - sa.toDateMs;
  });

  const primary = candidates[0]?.entry;
  const subscriptionType = normalizeString(primary?.sub_type ?? null);
  const subscriptionExpiresAt = normalizeEpochMs(primary?.to_date ?? null);
  return { subscriptionType, subscriptionExpiresAt };
}

export function parseUserCreditsResponse(payload: unknown): ParsedCredits {
  if (!Array.isArray(payload)) {
    throw new Error("Credits response is not an array.");
  }

  let remainingCredits = 0;
  let totalCredits = 0;
  const subscriptions: CreditsEntry[] = [];

  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const entry = item as CreditsEntry;
    subscriptions.push(entry);

    const remain = normalizeNumber(entry.remain_quota);
    if (typeof remain === "number" && remain > 0) remainingCredits += remain;

    const init = normalizeNumber(entry.init_quota);
    if (typeof init === "number" && init > 0) totalCredits += init;
  }

  const { subscriptionType, subscriptionExpiresAt } = pickPrimarySubscription(subscriptions);

  return { subscriptionType, subscriptionExpiresAt, remainingCredits, totalCredits };
}
