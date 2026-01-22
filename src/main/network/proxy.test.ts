import { describe, expect, it } from "vitest";
import type { ProxyConfig } from "../../shared/ipc";
import { containsProxyCredentials, normalizeProxyConfig, validateProxyConfig } from "./proxy";

describe("containsProxyCredentials", () => {
  it("detects username:password@ in proxy rules", () => {
    expect(containsProxyCredentials("http://user:pass@127.0.0.1:7890")).toBe(true);
    expect(containsProxyCredentials("socks5://u:p@127.0.0.1:7891")).toBe(true);
  });

  it("does not flag rules without credentials", () => {
    expect(containsProxyCredentials("http://127.0.0.1:7890")).toBe(false);
    expect(containsProxyCredentials("socks5://127.0.0.1:7891")).toBe(false);
  });
});

describe("validateProxyConfig", () => {
  it("accepts system/direct modes", () => {
    expect(() => validateProxyConfig({ mode: "system" })).not.toThrow();
    expect(() => validateProxyConfig({ mode: "direct" })).not.toThrow();
  });

  it("rejects invalid modes", () => {
    expect(() => validateProxyConfig({ mode: "nope" } as unknown as ProxyConfig)).toThrow(
      /Invalid proxy mode/
    );
  });

  it("requires custom rules and rejects credentials", () => {
    expect(() => validateProxyConfig({ mode: "custom" })).toThrow(/required/i);
    expect(() => validateProxyConfig({ mode: "custom", rules: "   " })).toThrow(/required/i);
    expect(() => validateProxyConfig({ mode: "custom", rules: "http://u:p@127.0.0.1:7890" })).toThrow(
      /must not include/i
    );
  });

  it("accepts safe custom rules", () => {
    expect(() => validateProxyConfig({ mode: "custom", rules: "http://127.0.0.1:7890" })).not.toThrow();
  });
});

describe("normalizeProxyConfig", () => {
  it("returns canonical shape for system/direct", () => {
    expect(normalizeProxyConfig({ mode: "system", rules: "http://127.0.0.1:7890" })).toEqual({ mode: "system" });
    expect(normalizeProxyConfig({ mode: "direct", rules: "http://127.0.0.1:7890" })).toEqual({ mode: "direct" });
  });

  it("trims custom rules", () => {
    expect(normalizeProxyConfig({ mode: "custom", rules: "  http://127.0.0.1:7890  " })).toEqual({
      mode: "custom",
      rules: "http://127.0.0.1:7890",
    });
  });
});

