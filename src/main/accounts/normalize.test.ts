import { describe, expect, it } from "vitest";
import type { AccountMetaPatch } from "../../shared/ipc";
import { normalizeAccountMetaPatch } from "./normalize";

describe("normalizeAccountMetaPatch", () => {
  it("normalizes tags, proxy rules, and user-agent values", () => {
    const patch: AccountMetaPatch = {
      tags: [" a ", "A", "b", ""],
      net: { proxy: { mode: "custom", rules: "  http://127.0.0.1:7890  " } },
      ua: { mode: "custom", value: "  UA  " },
    };
    expect(normalizeAccountMetaPatch(patch)).toEqual({
      tags: ["a", "b"],
      net: { proxy: { mode: "custom", rules: "http://127.0.0.1:7890" } },
      ua: { mode: "custom", value: "UA" },
    });
  });

  it("handles missing net.proxy defensively", () => {
    const patch = { net: {} } as unknown as AccountMetaPatch;
    expect(normalizeAccountMetaPatch(patch)).toEqual({ net: { proxy: { mode: "system" } } });
  });
});
