// Fixtures for the kb-extension git-scope tests (change: add-kb-git-forge-scope):
// a temp HOME + temp git repos made with real git. Mirrors packages/kb's helper,
// which is not part of kb's published surface.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";

const ENV = { GIT_AUTHOR_NAME: "Test Author", GIT_AUTHOR_EMAIL: "author@example.test", GIT_COMMITTER_NAME: "Test Author", GIT_COMMITTER_EMAIL: "author@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...ENV } });

export interface RepoFixture {
  tmp: string;
  home: string;
  repo(opts?: { remote?: string; name?: string }): string;
  commit(dir: string, subject: string, files?: Record<string, string>): string;
  /** `n` commits whose subject contains `word`, created with fast-import. */
  bulk(dir: string, n: number, word: string): void;
}

export function useRepoFixture(): RepoFixture {
  const fx = {} as RepoFixture;
  let prevHome: string | undefined;
  let counter = 0;
  beforeEach(() => {
    fx.tmp = realpathSync(mkdtempSync(join(tmpdir(), "kb-ext-git-")));
    fx.home = join(fx.tmp, "home");
    mkdirSync(fx.home, { recursive: true });
    prevHome = process.env.HOME;
    process.env.HOME = fx.home;
    fx.commit = (dir, subject, files) => {
      for (const [n, c] of Object.entries(files ?? { [`f${++counter}.txt`]: subject })) {
        mkdirSync(dirname(join(dir, n)), { recursive: true });
        writeFileSync(join(dir, n), c);
      }
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", subject);
      return git(dir, "rev-parse", "HEAD").trim();
    };
    fx.repo = (opts = {}) => {
      const dir = join(fx.tmp, opts.name ?? `repo${++counter}`);
      mkdirSync(dir, { recursive: true });
      git(dir, "init", "-q", "-b", "main");
      if (opts.remote) git(dir, "remote", "add", "origin", opts.remote);
      fx.commit(dir, "initial commit");
      return realpathSync(dir);
    };
    fx.bulk = (dir, n, word) => {
      const lines: string[] = [];
      for (let i = 1; i <= n; i++) lines.push("commit refs/heads/bulk", `committer Bulk <b@example.test> ${1_700_000_000 + i} +0000`, `data <<EOM\nbulk ${word} ${i}\nEOM`, `M 100644 inline b/f${i}.txt`, "data <<EOM", `${i}`, "EOM", "");
      execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: lines.join("\n"), env: { ...process.env, ...ENV } });
    };
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(fx.tmp, { recursive: true, force: true });
  });
  return fx;
}
