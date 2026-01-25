import { describe, expect, it } from "vitest";
import { parseUserCreditsResponse } from "./creditsParsing";

describe("parseUserCreditsResponse", () => {
  it("sums remaining/total credits and extracts subscription type", () => {
    const parsed = parseUserCreditsResponse([
      { sub_type: "pro", remain_quota: 1200, init_quota: 5000 },
      { sub_type: "pro", remain_quota: 300, init_quota: 5000 },
    ]);

    expect(parsed).toEqual({
      subscriptionType: "pro",
      subscriptionExpiresAt: null,
      remainingCredits: 1500,
      totalCredits: 10000,
    });
  });

  it("handles multiple subscription types", () => {
    const expiresAt = Date.parse("2026-01-02T00:00:00.000Z");
    const parsed = parseUserCreditsResponse([
      { sub_type: "trial", remain_quota: 3, init_quota: 4, remain_days: 1, to_date: "2025-01-02T00:00:00.000Z" },
      { sub_type: "pro", remain_quota: 1, init_quota: 2, remain_days: 10, to_date: "2026-01-02T00:00:00.000Z" },
    ]);

    expect(parsed.subscriptionType).toBe("pro");
    expect(parsed.subscriptionExpiresAt).toBe(expiresAt);
    expect(parsed.remainingCredits).toBe(4);
    expect(parsed.totalCredits).toBe(6);
  });

  it("prefers os_access over trial subscriptions", () => {
    const expiresAt = Date.parse("2026-01-25T00:00:00.000Z");
    const parsed = parseUserCreditsResponse([
      { sub_type: "trial", remain_quota: 300, init_quota: 800, remain_days: 36499, to_date: "2125-12-31T00:00:00.000Z" },
      { sub_type: "Invitation", remain_quota: 3000, init_quota: 3000, remain_days: 30, to_date: "2026-02-24T00:00:00.000Z" },
      { sub_type: "os_access", remain_quota: 9680, init_quota: 10000, remain_days: 29, to_date: "2026-01-25T00:00:00.000Z" },
    ]);

    expect(parsed.subscriptionType).toBe("os_access");
    expect(parsed.subscriptionExpiresAt).toBe(expiresAt);
  });

  it("prefers pro over os_access subscriptions", () => {
    const proExpiresAt = Date.parse("2026-06-01T00:00:00.000Z");
    const parsed = parseUserCreditsResponse([
      { sub_type: "os_access", remain_quota: 9680, init_quota: 10000, remain_days: 29, to_date: "2026-01-25T00:00:00.000Z" },
      { sub_type: "pro", remain_quota: 1, init_quota: 2, remain_days: 1, to_date: "2026-06-01T00:00:00.000Z" },
    ]);

    expect(parsed.subscriptionType).toBe("pro");
    expect(parsed.subscriptionExpiresAt).toBe(proExpiresAt);
  });

  it("accepts numeric strings and ignores invalid entries", () => {
    const parsed = parseUserCreditsResponse([
      { sub_type: "pro", remain_quota: "10", init_quota: "100" },
      { sub_type: "", remain_quota: "nope", init_quota: null },
      null,
      123,
    ]);

    expect(parsed).toEqual({
      subscriptionType: "pro",
      subscriptionExpiresAt: null,
      remainingCredits: 10,
      totalCredits: 100,
    });
  });

  it("rejects non-array payloads", () => {
    expect(() => parseUserCreditsResponse({})).toThrow(/not an array/i);
  });
});
