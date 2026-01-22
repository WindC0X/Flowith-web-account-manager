import { describe, expect, it } from "vitest";
import type { UaConfig } from "../../shared/ipc";
import { normalizeUaConfig, resolveUserAgent, validateUaConfig } from "./userAgent";

describe("validateUaConfig", () => {
  it("accepts default mode", () => {
    expect(() => validateUaConfig({ mode: "default" })).not.toThrow();
  });

  it("requires value for custom/preset mode", () => {
    expect(() => validateUaConfig({ mode: "custom" })).toThrow(/required/i);
    expect(() => validateUaConfig({ mode: "preset", value: "   " })).toThrow(/required/i);
  });

  it("rejects invalid mode", () => {
    expect(() => validateUaConfig({ mode: "nope" } as unknown as UaConfig)).toThrow(/Invalid User-Agent mode/);
  });

  it("rejects newline and overly long values", () => {
    expect(() => validateUaConfig({ mode: "custom", value: "UA\\nX" })).toThrow(/single-line/i);
    expect(() => validateUaConfig({ mode: "custom", value: "a".repeat(513) })).toThrow(/too long/i);
  });
});

describe("resolveUserAgent", () => {
  it("returns null for default/blank", () => {
    expect(resolveUserAgent({ mode: "default" })).toBeNull();
    expect(resolveUserAgent({ mode: "custom", value: "   " })).toBeNull();
  });

  it("returns trimmed value for custom/preset", () => {
    expect(resolveUserAgent({ mode: "custom", value: "  UA  " })).toBe("UA");
    expect(resolveUserAgent({ mode: "preset", value: "UA" })).toBe("UA");
  });
});

describe("normalizeUaConfig", () => {
  it("returns canonical shape for default", () => {
    expect(normalizeUaConfig({ mode: "default", value: "UA" })).toEqual({ mode: "default" });
  });

  it("trims value for non-default", () => {
    expect(normalizeUaConfig({ mode: "custom", value: "  UA  " })).toEqual({ mode: "custom", value: "UA" });
  });
});

