import crypto from "node:crypto";
import type { ImportRefreshTokensResult } from "../../shared/ipc";
import { USER_AGENT_PRESETS } from "../../shared/userAgentPresets";
import { getFlowithSupabaseClient } from "../flowith/supabase";
import { redactSensitive } from "../security/redact";
import {
  findAccountIdByFingerprint,
  isTokenEncryptionAvailable,
  setRefreshToken,
  upsertAccountFingerprint,
  upsertAccountMeta,
} from "./vault";

function fingerprintRefreshToken(refreshToken: string): string {
  return crypto.createHash("sha256").update(refreshToken).digest("hex").slice(0, 12);
}

function maskFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 6) return fingerprint;
  return `${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}`;
}

function createAccountId(): string {
  return `acc_${crypto.randomBytes(8).toString("hex")}`;
}

function pickRandomUaPresetId(): string | null {
  if (USER_AGENT_PRESETS.length === 0) return null;
  const idx = crypto.randomInt(USER_AGENT_PRESETS.length);
  return USER_AGENT_PRESETS[idx]?.id ?? null;
}

export async function importRefreshTokens(tokens: string[]): Promise<ImportRefreshTokensResult> {
  const warnings: string[] = [];
  if (!isTokenEncryptionAvailable()) {
    warnings.push(
      "Token encryption is unavailable on this host. Tokens will not be persisted and must be re-imported after restart."
    );
  }

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  let supabase;
  try {
    supabase = getFlowithSupabaseClient();
  } catch (e) {
    return {
      imported: 0,
      failed: tokens.length,
      warnings,
      errors: [redactSensitive(e instanceof Error ? e.message : String(e))],
    };
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const refreshToken = tokens[i]!;
    const fingerprint = fingerprintRefreshToken(refreshToken);
    const maskedFingerprint = maskFingerprint(fingerprint);

    try {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error) throw error;
      if (!data?.session) throw new Error("Supabase refresh returned no session.");

      const existingAccountId = findAccountIdByFingerprint(fingerprint);
      const accountId = existingAccountId ?? createAccountId();
      if (!existingAccountId) {
        upsertAccountFingerprint(accountId, fingerprint);
        const uaPresetId = pickRandomUaPresetId();
        const email = data.session.user?.email;
        upsertAccountMeta(accountId, {
          displayName: email ? String(email) : `Account ${maskedFingerprint}`,
          tags: [],
          ua: uaPresetId ? { mode: "preset", value: uaPresetId } : { mode: "default" },
        });
      }
      setRefreshToken(accountId, refreshToken);
      imported += 1;
    } catch (e) {
      failed += 1;
      errors.push(
        `line ${i + 1} (${maskedFingerprint}): ${redactSensitive(e instanceof Error ? e.message : String(e))}`
      );
    }
  }

  return { imported, failed, warnings, errors };
}
