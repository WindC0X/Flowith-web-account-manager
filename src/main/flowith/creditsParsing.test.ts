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
      remainingCredits: 1500,
      totalCredits: 10000,
    });
  });

  it("handles multiple subscription types", () => {
    const parsed = parseUserCreditsResponse([
      { sub_type: "pro", remain_quota: 1, init_quota: 2 },
      { sub_type: "trial", remain_quota: 3, init_quota: 4 },
    ]);

    expect(parsed.subscriptionType).toBe("pro, trial");
    expect(parsed.remainingCredits).toBe(4);
    expect(parsed.totalCredits).toBe(6);
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
      remainingCredits: 10,
      totalCredits: 100,
    });
  });

  it("rejects non-array payloads", () => {
    expect(() => parseUserCreditsResponse({})).toThrow(/not an array/i);
  });
});

