import { describe, expect, it } from "vitest";
import { extractSupabaseSessionTokensFromStorageValue } from "./supabaseAuthStorage";

describe("extractSupabaseSessionTokensFromStorageValue", () => {
  it("extracts access/refresh token from a direct Session JSON", () => {
    const raw = JSON.stringify({ access_token: "at", refresh_token: "rt" });
    expect(extractSupabaseSessionTokensFromStorageValue(raw)).toEqual({ accessToken: "at", refreshToken: "rt" });
  });

  it("extracts tokens from nested currentSession/session", () => {
    const raw = JSON.stringify({ currentSession: { session: { access_token: "at2", refresh_token: "rt2" } } });
    expect(extractSupabaseSessionTokensFromStorageValue(raw)).toEqual({ accessToken: "at2", refreshToken: "rt2" });
  });

  it("returns null for non-JSON input", () => {
    expect(extractSupabaseSessionTokensFromStorageValue("not json")).toBeNull();
  });
});

