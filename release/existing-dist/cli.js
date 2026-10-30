#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
const command = process.argv[2] ?? "serve";
if (command === "init") {
    const stateDir = process.env.DEVSPACE_STATE_DIR ?? join(homedir(), ".devspace");
    mkdirSync(stateDir, { recursive: true });
    const ownerToken = process.env.DEVSPACE_OAUTH_OWNER_TOKEN ?? randomUUID();
    writeFileSync(join(stateDir, "auth.json"), JSON.stringify({ ownerToken }, null, 2));
    console.log("Owner password saved to", join(stateDir, "auth.json"));
}
else if (command === "serve") {
    const config = loadConfig();
    const server = await createServer(config);
    const listener = server.app.listen(config.port, config.host, () => console.log(`DevSpace listening on ${config.publicBaseUrl}`));
    process.on("SIGINT", () => void server.close().finally(() => listener.close()));
}
else
    throw new Error("Usage: devspace [init|serve]");
