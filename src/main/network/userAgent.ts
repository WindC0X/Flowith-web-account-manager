import type { UaConfig } from "../../shared/ipc";

export function validateUaConfig(ua: UaConfig) {
  if (ua.mode === "default") return;
  if (ua.mode !== "custom" && ua.mode !== "preset") throw new Error("Invalid User-Agent mode.");

  const value = ua.value?.trim();
  if (!value) throw new Error("User-Agent value is required for custom/preset mode.");
  if (value.length > 512) throw new Error("User-Agent value is too long.");
  if (/[\\r\\n]/.test(value)) throw new Error("User-Agent value must be single-line.");
}

export function resolveUserAgent(ua: UaConfig): string | null {
  if (ua.mode === "default") return null;
  const value = ua.value?.trim();
  if (!value) return null;
  return value;
}

export function normalizeUaConfig(ua: UaConfig): UaConfig {
  if (ua.mode === "default") return { mode: "default" };
  validateUaConfig(ua);
  return { mode: ua.mode, value: ua.value!.trim() };
}
