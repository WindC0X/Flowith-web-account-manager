import { session } from "electron";
import type { ConnectivityCheck } from "../../shared/ipc";
import { getAccount } from "../accounts/vault";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { redactSensitive } from "../security/redact";
import { partitionForAccount } from "../workspace/WebWorkspaceService";
import { applyProxy } from "./proxy";

const FLOWITH_WEB = "https://flowith.io";
const FLOWITH_EDGE = "https://edge.flowith.net";

export async function testConnectivity(accountId: string): Promise<ConnectivityCheck[]> {
  const account = getAccount(accountId);
  const proxy = account?.net.proxy ?? { mode: "system" as const };
  const ses = session.fromPartition(partitionForAccount(accountId));

  await applyProxy(ses, proxy);

  const endpoints: Array<{ name: string; url: string }> = [
    { name: "flowith-web", url: FLOWITH_WEB },
    { name: "flowith-edge", url: FLOWITH_EDGE },
  ];

  try {
    const { url: supabaseUrl } = resolveFlowithSupabaseConfig();
    if (supabaseUrl) endpoints.push({ name: "flowith-supabase", url: supabaseUrl });
  } catch {
    // ignore invalid config
  }

  const results: ConnectivityCheck[] = [];

  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await ses.fetch(ep.url, { method: "GET", signal: controller.signal });
      clearTimeout(timeout);
      results.push({
        name: ep.name,
        url: ep.url,
        ok: res.ok,
        status: res.status,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      results.push({
        name: ep.name,
        url: ep.url,
        ok: false,
        latencyMs: Date.now() - start,
        error: redactSensitive(e instanceof Error ? e.message : String(e)),
      });
    }
  }

  return results;
}
