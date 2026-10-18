// The extension's cold populate seeds a linked worktree's first index from the main checkout.
// See change: add-kb-worktree-seed (test-plan E23, kb-extension writer).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeKb, createReindexState, getKb, reindexNow } from "../reindex.js";

const ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, ...ENV } });
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

let tmp: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "kb-ext-seed-")));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("kb-extension cold populate seeds from the main checkout", () => {
  it("E23 a worktree's first reindexNow logs the seed line and indexes the same content", async () => {
    const main = join(tmp, "main");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    put(main, ".pi/dashboard/knowledge_base.json", JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db" }));
    put(main, ".gitignore", ".pi/dashboard/kb/\n");
    for (let i = 0; i < 5; i++) put(main, `docs/g${i}.md`, `# Guide ${i}\n\nGuide number ${i} with the unique marker gm${i} and padding long enough to survive the merge threshold cleanly here.\n`);
    git(main, "add", "-A");
    git(main, "commit", "-q", "-m", "i");
    const state = createReindexState();
    await reindexNow(state, main);
    closeKb(state);

    const wt = join(tmp, "wt");
    git(main, "worktree", "add", "-q", "-b", "w", wt);
    put(wt, "docs/g1.md", "# Guide 1\n\nRewritten in the worktree with the unique marker wt-rewritten and padding long enough to survive the merge threshold.\n");
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      await reindexNow(state, wt);
    } finally {
      spy.mockRestore();
    }
    expect(writes.join("")).toContain(`[kb] seed=${main} sources=1/1`);
    const { store } = getKb(state, wt)!;
    expect(store.search("wt-rewritten", { limit: 3 })[0]?.path).toMatch(/g1\.md$/);
    expect(store.search("gm3", { limit: 3 })[0]?.path).toMatch(/g3\.md$/);
    expect(store.search("gm1", { limit: 3 }).length).toBe(0); // the edited file's old content is gone
    closeKb(state);
  }, 60_000);
});
