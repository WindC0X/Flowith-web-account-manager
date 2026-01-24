type CreditsEntry = {
  sub_type?: unknown;
  remain_quota?: unknown;
  init_quota?: unknown;
};

export type ParsedCredits = {
  subscriptionType: string | null;
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
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function summarizeSubscriptionType(types: string[]): string | null {
  if (types.length === 0) return null;
  if (types.length === 1) return types[0]!;
  const head = types.slice(0, 3).join(", ");
  if (types.length <= 3) return head;
  return `${head} (+${types.length - 3})`;
}

export function parseUserCreditsResponse(payload: unknown): ParsedCredits {
  if (!Array.isArray(payload)) {
    throw new Error("Credits response is not an array.");
  }

  let remainingCredits = 0;
  let totalCredits = 0;
  const subTypes = new Set<string>();

  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const entry = item as CreditsEntry;

    const remain = normalizeNumber(entry.remain_quota);
    if (typeof remain === "number" && remain > 0) remainingCredits += remain;

    const init = normalizeNumber(entry.init_quota);
    if (typeof init === "number" && init > 0) totalCredits += init;

    const sub = normalizeString(entry.sub_type);
    if (sub) subTypes.add(sub);
  }

  const subscriptionType = summarizeSubscriptionType(Array.from(subTypes));

  return { subscriptionType, remainingCredits, totalCredits };
}

