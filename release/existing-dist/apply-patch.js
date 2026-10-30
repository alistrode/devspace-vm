import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export async function applyPatch(_root, patch) {
    const actions = typeof patch === "string" ? JSON.parse(patch) : patch;
    const files = [];
    for (const action of actions) {
        if (action.action === "delete") {
            await rm(action.path, { force: true, recursive: true });
            files.push(action.path);
            continue;
        }
        if (action.action === "move") {
            await mkdir(dirname(action.destination), { recursive: true });
            await rename(action.path, action.destination);
            files.push(action.destination);
            continue;
        }
        await mkdir(dirname(action.path), { recursive: true });
        await writeFile(action.path, action.content);
        files.push(action.path);
    }
    return { files };
}
