import { describe, expect, it } from "vitest";
import { computeSaveAsDedupKeys } from "./saveAsDedup";

describe("computeSaveAsDedupKeys", () => {
  it("normalizes https URL by stripping query/hash", () => {
    const keys = computeSaveAsDedupKeys(
      "acc1",
      {
        getURLChain: () => ["https://cdn.example.com/files/report.pdf?sig=1#x"],
        getURL: () => "https://cdn.example.com/files/report.pdf?sig=2",
      },
      "report.pdf"
    );

    expect(keys).toContain("acc1:name:report.pdf");
    expect(keys).toContain("acc1:url:https://cdn.example.com/files/report.pdf");
  });

  it("includes blob URL with stable origin+pathname", () => {
    const keys = computeSaveAsDedupKeys(
      "acc1",
      {
        getURLChain: () => ["blob:https://flowith.io/abc-123?ignored=true"],
        getURL: () => "blob:https://flowith.io/abc-123",
      },
      "download"
    );

    expect(keys).toContain("acc1:url:blob:https://flowith.io/abc-123");
  });
});

