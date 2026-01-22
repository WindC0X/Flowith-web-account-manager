import { describe, expect, it } from "vitest";
import { normalizeTags } from "./tags";

describe("normalizeTags", () => {
  it("trims and drops empty tags", () => {
    expect(normalizeTags([" a ", " ", "\t", "b"])).toEqual(["a", "b"]);
  });

  it("deduplicates case-insensitively while preserving first casing", () => {
    expect(normalizeTags(["Tag", "tag", "TAG", "Other"])).toEqual(["Tag", "Other"]);
  });

  it("preserves first-seen order", () => {
    expect(normalizeTags(["b", "a", "B"])).toEqual(["b", "a"]);
  });
});

