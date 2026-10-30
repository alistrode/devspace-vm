import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
let baseline;
async function git(cwd, args, env) {
    const result = await execFileAsync("git", args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 50 * 1024 * 1024,
    });
    return result.stdout;
}
async function workingTreeSnapshot(cwd) {
    const tempDirectory = await mkdtemp(join(tmpdir(), "devspace-show-changes-"));
    const env = {
        GIT_INDEX_FILE: join(tempDirectory, "index"),
        GIT_AUTHOR_NAME: "DevSpace",
        GIT_AUTHOR_EMAIL: "devspace@users.noreply.local",
        GIT_COMMITTER_NAME: "DevSpace",
        GIT_COMMITTER_EMAIL: "devspace@users.noreply.local",
    };
    try {
        await git(cwd, ["read-tree", "HEAD"], env);
        await git(cwd, ["add", "-A", "--", "."], env);
        const tree = (await git(cwd, ["write-tree"], env)).trim();
        const parent = (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"], env)).trim();
        return (await git(cwd, ["commit-tree", tree, "-p", parent, "-m", "DevSpace changes snapshot"], env)).trim();
    }
    finally {
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
export async function showChangesTool() {
    const cwd = process.cwd();
    const current = await workingTreeSnapshot(cwd);
    const previous = baseline ?? (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
    const patch = await git(cwd, ["diff", "--binary", "--no-color", previous, current]);
    baseline = current;
    return {
        content: [{
                type: "text",
                text: patch || "No changes since the previous show_changes call.",
            }],
    };
}
