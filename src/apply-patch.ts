import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PatchAction = { action: "create" | "update"; path: string; content: string } | { action: "delete"; path: string } | { action: "move"; path: string; destination: string };
export async function applyPatch(_root: string, patch: string | PatchAction[]): Promise<{ files: string[] }> {
  const actions = typeof patch === "string" ? JSON.parse(patch) as PatchAction[] : patch;
  const files: string[] = [];
  for (const action of actions) {
    if (action.action === "delete") { await rm(action.path, { force: true, recursive: true }); files.push(action.path); continue; }
    if (action.action === "move") { await mkdir(dirname(action.destination), { recursive: true }); await rename(action.path, action.destination); files.push(action.destination); continue; }
    await mkdir(dirname(action.path), { recursive: true }); await writeFile(action.path, action.content); files.push(action.path);
  }
  return { files };
}
