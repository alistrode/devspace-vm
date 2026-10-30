import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  ownerToken: string;
  stateDir: string;
}

type Env = NodeJS.ProcessEnv;

export function loadConfig(env: Env = process.env): ServerConfig {
  const stateDir = env.DEVSPACE_STATE_DIR ?? join(homedir(), ".devspace");
  const auth = readAuthFile(join(stateDir, "auth.json"));
  const ownerToken = env.DEVSPACE_OAUTH_OWNER_TOKEN ?? auth.ownerToken;
  if (!ownerToken) throw new Error("Owner password is missing. Run `devspace init` or set DEVSPACE_OAUTH_OWNER_TOKEN.");
  const host = env.HOST ?? "127.0.0.1";
  const port = Number(env.PORT ?? 7676);
  return {
    host,
    port: Number.isFinite(port) ? port : 7676,
    publicBaseUrl: env.DEVSPACE_PUBLIC_BASE_URL ?? `http://${host}:${port}`,
    ownerToken,
    stateDir,
  };
}

function readAuthFile(path: string): { ownerToken?: string } {
  try { return JSON.parse(readFileSync(path, "utf8")) as { ownerToken?: string }; }
  catch { return {}; }
}
