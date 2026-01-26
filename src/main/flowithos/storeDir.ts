import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_DIR_NAME = "FlowithOS Account Manager";
const FALLBACK_DIR_NAME = "flowithos-account-manager";
const PROBE_FILES = ["flowithos-account-manager.json", "flowithos-account-manager-renderer-storage.json"];

export function getFlowithOsAccountManagerStoreCwd(): string {
  const override = process.env.FLOWITHOS_STORE_CWD;
  if (typeof override === "string" && override.trim()) {
    const candidate = override.trim();
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  let appData: string;
  try {
    appData = app.getPath("appData");
  } catch {
    try {
      return app.getPath("userData");
    } catch {
      return "";
    }
  }

  const candidates = [DEFAULT_DIR_NAME, FALLBACK_DIR_NAME].map((name) => join(appData, name));
  for (const dir of candidates) {
    for (const file of PROBE_FILES) {
      try {
        if (existsSync(join(dir, file))) return dir;
      } catch {
        // ignore
      }
    }
  }

  return join(appData, DEFAULT_DIR_NAME);
}

