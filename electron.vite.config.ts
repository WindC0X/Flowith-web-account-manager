import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";

const DEV_HOST = "127.0.0.1";
const DEV_PORT_CANDIDATES = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed <= 0 || parsed > 65535) return null;
  return parsed;
}

async function canBind(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();

    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function allocateEphemeralPort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();

    server.once("error", (err) => reject(err));
    server.listen({ host, port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate ephemeral port")));
        return;
      }

      const port = (address as AddressInfo).port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function resolveDevServerPort(host: string): Promise<number> {
  const envPort = parsePort(process.env.FWD_DEV_PORT);
  if (envPort !== null) return envPort;

  for (const port of DEV_PORT_CANDIDATES) {
    if (await canBind(host, port)) return port;
  }

  return await allocateEphemeralPort(host);
}

export default defineConfig(async ({ command }) => {
  const devPort = command === "serve" ? await resolveDevServerPort(DEV_HOST) : null;

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      plugins: [react()],
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
        },
      },
      server: {
        host: DEV_HOST,
        ...(devPort ? { port: devPort } : {}),
        strictPort: false,
      },
    },
  };
});
