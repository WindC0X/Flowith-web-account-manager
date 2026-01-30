import crypto from "node:crypto";
import type { AccountCredits, AccountsImportProgressEvent, ImportRefreshTokensOptions, ImportRefreshTokensResult } from "../../shared/ipc";
import { USER_AGENT_PRESETS } from "../../shared/userAgentPresets";
import { fetchAccountCreditsWithAccessToken } from "../flowith/credits";
import { getFlowithSupabaseClient } from "../flowith/supabase";
import { normalizeProxyConfig } from "../network/proxy";
import { normalizeUaConfig } from "../network/userAgent";
import { redactSensitive } from "../security/redact";
import {
  findAccountIdByFingerprint,
  isTokenEncryptionAvailable,
  setRefreshToken,
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
  const candidates = USER_AGENT_PRESETS.filter((p) => p.id !== "safari_ios");
  if (candidates.length === 0) return null;
  const idx = crypto.randomInt(candidates.length);
  return candidates[idx]?.id ?? null;
}

export async function importRefreshTokens(
  tokens: string[],
  options?: ImportRefreshTokensOptions,
  onProgress?: (event: AccountsImportProgressEvent) => void
): Promise<ImportRefreshTokensResult> {
  const warnings: string[] = [];
  if (!isTokenEncryptionAvailable()) {
    warnings.push(
      "Token encryption is unavailable on this host. Tokens will not be persisted and must be re-imported after restart."
    );
  }

  const importProxy = options?.net?.proxy ? normalizeProxyConfig(options.net.proxy) : null;
  const importUa = options?.ua ? normalizeUaConfig(options.ua) : null;

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  const creditsByAccountId: Record<string, AccountCredits> = {};
  const creditsErrorsByAccountId: Record<string, string> = {};
  let creditsFailed = 0;

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

      const rotatedRefreshToken = data.session.refresh_token ?? refreshToken;
      const rotatedFingerprint =
        rotatedRefreshToken === refreshToken ? fingerprint : fingerprintRefreshToken(rotatedRefreshToken);

      const existingByInput = findAccountIdByFingerprint(fingerprint);
      const existingByRotated =
        rotatedFingerprint === fingerprint ? existingByInput : findAccountIdByFingerprint(rotatedFingerprint);

      if (existingByInput && existingByRotated && existingByInput !== existingByRotated) {
        throw new Error(
          `Refresh token fingerprint conflict: input=${maskedFingerprint} rotated=${maskFingerprint(rotatedFingerprint)}`
        );
      }

      const accountId = existingByRotated ?? existingByInput ?? createAccountId();
      const isNewAccount = !existingByRotated && !existingByInput;
      if (isNewAccount) {
        const uaPresetId = importUa ? null : pickRandomUaPresetId();
        const email = data.session.user?.email;
        upsertAccountMeta(accountId, {
          displayName: email ? String(email) : `Account ${maskedFingerprint}`,
          tags: [],
          ...(importProxy ? { net: { proxy: importProxy } } : {}),
          ua: importUa ?? (uaPresetId ? { mode: "preset", value: uaPresetId } : { mode: "default" }),
        });
      }
      setRefreshToken(accountId, rotatedRefreshToken);

      try {
        const credits = await fetchAccountCreditsWithAccessToken(accountId, data.session.access_token ?? "");
        creditsByAccountId[accountId] = credits;
      } catch (e) {
        creditsFailed += 1;
        creditsErrorsByAccountId[accountId] = redactSensitive(e instanceof Error ? e.message : String(e));
      }
      imported += 1;
      try {
        onProgress?.({
          type: "progress",
          done: i + 1,
          total: tokens.length,
          imported,
          failed,
          creditsFailed,
          current: { line: i + 1, fingerprint: maskedFingerprint, status: "ok" },
        });
      } catch {
        // ignore
      }
    } catch (e) {
      failed += 1;
      errors.push(
        `line ${i + 1} (${maskedFingerprint}): ${redactSensitive(e instanceof Error ? e.message : String(e))}`
      );
      try {
        onProgress?.({
          type: "progress",
          done: i + 1,
          total: tokens.length,
          imported,
          failed,
          creditsFailed,
          current: { line: i + 1, fingerprint: maskedFingerprint, status: "fail" },
        });
      } catch {
        // ignore
      }
    }
  }

  if (creditsFailed > 0) {
    warnings.push(
      `Credits fetch failed for ${creditsFailed} imported account(s). You can open the tab for those accounts and retry.`
    );
  }

  return {
    imported,
    failed,
    warnings,
    errors,
    ...(Object.keys(creditsByAccountId).length > 0 ? { creditsByAccountId } : {}),
    ...(Object.keys(creditsErrorsByAccountId).length > 0 ? { creditsErrorsByAccountId } : {}),
  };
}
