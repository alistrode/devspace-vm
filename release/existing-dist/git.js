import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function git(cwd, args) {
    return execFileAsync("git", args, { cwd });
}
