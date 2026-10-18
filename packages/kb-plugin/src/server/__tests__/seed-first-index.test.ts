// @vitest-environment node
//
// node environment is required: this file reaches kb's sqlite store, which vite's client (jsdom)
// environment refuses to bundle (`node:sqlite`). Same as kb-routes.test.ts.
// The dashboard reindex job seeds a linked worktree's first index from the main checkout.
// See change: add-kb-worktree-seed (test-plan E23 dashboard job, E11).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reindexAll } from "../kb-routes.js";

const ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, ...ENV } });
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const REMOTE = "https://github.com/example/never";

let tmp: string;
let savedTrust: string | undefined;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "kb-plugin-seed-")));
  savedTrust = process.env.KB_SOURCE_TRUST_PATH;
  process.env.KB_SOURCE_TRUST_PATH = join(tmp, "trust.json");
});
afterEach(() => {
  if (savedTrust === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
  else process.env.KB_SOURCE_TRUST_PATH = savedTrust;
  rmSync(tmp, { recursive: true, force: true });
});

function mkMain(): string {
  const main = join(tmp, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  put(main, ".pi/dashboard/knowledge_base.json", JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }, { ref: REMOTE }], dbPath: ".pi/dashboard/kb/index.db" }));
  put(main, ".gitignore", ".pi/dashboard/kb/\n");
  for (let i = 0; i < 5; i++) put(main, `docs/g${i}.md`, `# Guide ${i}\n\nGuide number ${i} with the unique marker gm${i} and padding long enough to survive the merge threshold cleanly here.\n`);
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "i");
  return main;
}

describe("dashboard reindex job seeds the first index", () => {
  it("E23/E11 a worktree's first job logs the seed line; an untrusted (not passed) source keeps no seeded rows", async () => {
    const main = mkMain();
    await reindexAll(main); // the remote is untrusted → skipped; docs indexed
    // Plant rows for the untrusted source's id in main's index, as if it had been trusted there once.
    const s = new SqliteFtsStore(join(main, ".pi/dashboard/kb/index.db"));
    s.setFileState(REMOTE, "x.md", { mtimeMs: 1, sha256: "x" });
    s.setMeta(`gate:${REMOTE}`, "stale");
    s.close();

    const wt = join(tmp, "wt");
    git(main, "worktree", "add", "-q", "-b", "w", wt);
    put(wt, "docs/g1.md", "# Guide 1\n\nRewritten in the worktree with the unique marker wt-rewritten and padding long enough to survive the merge threshold.\n");
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const r = await reindexAll(wt);
      expect(r.outcomes?.find((o) => o.ref === REMOTE)?.status).toBe("untrusted");
    } finally {
      spy.mockRestore();
    }
    expect(writes.join("")).toContain(`[kb] seed=${main} sources=1/1`);
    const w = SqliteFtsStore.openExisting(join(wt, ".pi/dashboard/kb/index.db"))!;
    try {
      expect(w.search("wt-rewritten", { limit: 3 })[0]?.path).toMatch(/g1\.md$/);
      expect(w.filesByRoot()[REMOTE]).toBeUndefined();
    } finally {
      w.close();
    }
  }, 60_000);
});
