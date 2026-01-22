import { safeStorage } from "electron";
import Store from "electron-store";
import type { AccountMetaPatch, AccountSummary } from "../../shared/ipc";

type StoredAccountV1 = {
  id: string;
  fingerprint?: string;
  displayName?: string;
  tags?: string[];
  net?: AccountSummary["net"];
  ua?: AccountSummary["ua"];
  refreshTokenEnc?: string | null;
};

type VaultStateV1 = {
  version: 1;
  accounts: Record<string, StoredAccountV1>;
};

type VaultStoreSchema = {
  vault: VaultStateV1;
};

let store: Store<VaultStoreSchema> | null = null;
const runtimeTokens = new Map<string, string>();

export function isTokenEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function listAccounts(): AccountSummary[] {
  const vault = getVault();
  return Object.values(vault.accounts).map((a) => toAccountSummary(a));
}

export function getAccount(accountId: string): AccountSummary | null {
  const vault = getVault();
  const account = vault.accounts[accountId];
  if (!account) return null;
  return toAccountSummary(account);
}

export function upsertAccountMeta(accountId: string, patch: AccountMetaPatch): AccountSummary {
  const vault = getVault();
  const current = vault.accounts[accountId] ?? { id: accountId };
  const next = applyPatch(current, patch);
  vault.accounts[accountId] = next;
  setVault(vault);
  return toAccountSummary(next);
}

export function findAccountIdByFingerprint(fingerprint: string): string | null {
  const vault = getVault();
  for (const [id, account] of Object.entries(vault.accounts)) {
    if (account.fingerprint === fingerprint) return id;
  }
  return null;
}

export function upsertAccountFingerprint(accountId: string, fingerprint: string) {
  const vault = getVault();
  const current = vault.accounts[accountId] ?? { id: accountId };
  vault.accounts[accountId] = { ...current, fingerprint };
  setVault(vault);
}

export function setRefreshToken(accountId: string, refreshToken: string): { persisted: boolean } {
  const vault = getVault();
  const account = vault.accounts[accountId] ?? { id: accountId };

  const canEncrypt = isTokenEncryptionAvailable();
  if (canEncrypt) {
    account.refreshTokenEnc = encrypt(refreshToken);
    runtimeTokens.delete(accountId);
  } else {
    account.refreshTokenEnc = null;
    runtimeTokens.set(accountId, refreshToken);
  }

  vault.accounts[accountId] = account;
  setVault(vault);
  return { persisted: canEncrypt };
}

export function getRefreshToken(accountId: string): string | null {
  const vault = getVault();
  const account = vault.accounts[accountId];
  if (!account) return null;

  if (account.refreshTokenEnc && isTokenEncryptionAvailable()) {
    try {
      return decrypt(account.refreshTokenEnc);
    } catch {
      return null;
    }
  }

  return runtimeTokens.get(accountId) ?? null;
}

function getStore(): Store<VaultStoreSchema> {
  if (!store) {
    store = new Store<VaultStoreSchema>({
      defaults: {
        vault: {
          version: 1,
          accounts: {},
        },
      },
    });
  }
  return store;
}

function getVault(): VaultStateV1 {
  const raw = getStore().get("vault");
  if (!raw || raw.version !== 1 || !raw.accounts || typeof raw.accounts !== "object") {
    const empty: VaultStateV1 = { version: 1, accounts: {} };
    getStore().set("vault", empty);
    return empty;
  }
  return raw;
}

function setVault(vault: VaultStateV1) {
  getStore().set("vault", vault);
}

function toAccountSummary(account: StoredAccountV1): AccountSummary {
  return {
    id: account.id,
    fingerprint: account.fingerprint ?? "",
    displayName: account.displayName ?? "Account",
    tags: account.tags ?? [],
    net: account.net ?? { proxy: { mode: "system" } },
    ua: account.ua ?? { mode: "default" },
  };
}

function applyPatch(current: StoredAccountV1, patch: AccountMetaPatch): StoredAccountV1 {
  const displayName = patch.displayName ?? current.displayName;
  const tags = patch.tags ?? current.tags;
  const net = patch.net ?? current.net;
  const ua = patch.ua ?? current.ua;

  const next: StoredAccountV1 = { id: current.id };
  if (current.fingerprint !== undefined) next.fingerprint = current.fingerprint;
  if (displayName !== undefined) next.displayName = displayName;
  if (tags !== undefined) next.tags = tags;
  if (net !== undefined) next.net = net;
  if (ua !== undefined) next.ua = ua;
  if (current.refreshTokenEnc !== undefined) next.refreshTokenEnc = current.refreshTokenEnc;
  return next;
}

function encrypt(refreshToken: string): string {
  return safeStorage.encryptString(refreshToken).toString("base64");
}

function decrypt(enc: string): string {
  return safeStorage.decryptString(Buffer.from(enc, "base64"));
}
