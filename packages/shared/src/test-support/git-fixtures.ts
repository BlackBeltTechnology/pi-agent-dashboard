/**
 * Shared git-fixture builder — materializes the nine repository states the
 * checkout-root resolver must classify, as REAL repos in a temp dir.
 *
 * The states cannot be faked: the whole point of the resolver is that
 * `--git-dir` / `--git-common-dir` / `--show-toplevel` disagree in ways no
 * reasoning about path strings reproduces. Every assertion about the resolver
 * is therefore anchored to a repo git itself built.
 *
 * Two invocation rules are load-bearing, not hygiene:
 *   - `GIT_CONFIG_GLOBAL=/dev/null` + `GIT_CONFIG_SYSTEM=/dev/null` on every
 *     git call, or a developer's own `core.worktree` leaks into the
 *     `mainCheckout` assertions;
 *   - `-c protocol.file.allow=always` for a local-path `submodule add`, which
 *     git refuses by default since CVE-2022-39253.
 *
 * See change: add-git-checkout-root-resolver.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "../platform/exec.js";

/** Env that isolates every fixture git call from the developer's own config. */
export const FIXTURE_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
} as const;

/** Run git in `cwd` with the fixture isolation env. Throws on non-zero exit. */
export function fixtureGit(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t.test", "-c", "user.name=T", "-c", "init.defaultBranch=main", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...FIXTURE_GIT_ENV },
    },
  );
}

/** The three rev-parse probes, as git reports them for a cwd. */
export function probeTriple(cwd: string): {
  gitDir: string | null;
  commonDir: string | null;
  topLevel: string | null;
} {
  const one = (args: string[]): string | null => {
    try {
      return fixtureGit(cwd, ["rev-parse", ...args]).trim() || null;
    } catch {
      return null;
    }
  };
  return {
    gitDir: one(["--path-format=absolute", "--git-dir"]),
    commonDir: one(["--path-format=absolute", "--git-common-dir"]),
    topLevel: one(["--show-toplevel"]),
  };
}

export interface GitFixtures {
  /** Temp root holding every state. */
  root: string;
  /** Ordinary checkout root. */
  normal: string;
  /** Three levels below `normal`. */
  normalSubdir: string;
  /** `git worktree add` from `normal`. */
  worktree: string;
  /** Superproject holding the submodule. */
  superproject: string;
  /** Submodule checkout at `<super>/models/sub`. */
  submodule: string;
  /** `git worktree add` issued from inside `submodule`. */
  submoduleWorktree: string;
  /** `git clone --bare` hub directory (`<root>/barehub.git`). */
  bare: string;
  /** `git worktree add` from the bare hub. */
  bareWorktree: string;
  /** Checkout created with `git init --separate-git-dir=…`. */
  separateGitDir: string;
  /** The directory holding that checkout's git dir (`<root>/elsewhere.git`). */
  separateGitDirGitDir: string;
  /** An ordinary checkout whose own directory name ends in `.git`. */
  dotGitNamedCheckout: string;
  /** A directory that is not inside any repository. */
  nonRepo: string;
  cleanup(): void;
}

/** Build every fixture state under one temp root. Caller must `cleanup()`. */
export function buildGitFixtures(): GitFixtures {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "gitroots-")));

  const commit = (repo: string, name: string): void => {
    writeFileSync(path.join(repo, `${name}.txt`), `${name}\n`);
    fixtureGit(repo, ["add", "."]);
    fixtureGit(repo, ["commit", "-q", "-m", name]);
  };

  // ── normal checkout + a deep subdirectory ────────────────────────────────
  const normal = path.join(root, "normal");
  mkdirSync(normal);
  fixtureGit(normal, ["init", "-q"]);
  commit(normal, "seed");
  const normalSubdir = path.join(normal, "a", "b", "c");
  mkdirSync(normalSubdir, { recursive: true });

  // ── linked worktree of the normal checkout ───────────────────────────────
  const worktree = path.join(root, "normal-wt");
  fixtureGit(normal, ["worktree", "add", "-q", "-b", "wt", worktree]);

  // ── superproject + submodule + worktree of the submodule ─────────────────
  const superproject = path.join(root, "super");
  mkdirSync(superproject);
  fixtureGit(superproject, ["init", "-q"]);
  commit(superproject, "super-seed");
  fixtureGit(superproject, [
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    normal,
    "models/sub",
  ]);
  fixtureGit(superproject, ["commit", "-q", "-m", "add submodule"]);
  const submodule = path.join(superproject, "models", "sub");
  const submoduleWorktree = path.join(root, "sub-wt");
  fixtureGit(submodule, ["worktree", "add", "-q", "-b", "subwt", submoduleWorktree]);

  // ── bare hub + a worktree of it ──────────────────────────────────────────
  const bare = path.join(root, "barehub.git");
  fixtureGit(root, ["clone", "-q", "--bare", normal, bare]);
  const bareWorktree = path.join(root, "bare-wt");
  fixtureGit(bare, ["worktree", "add", "-q", "-b", "barewt", bareWorktree]);

  // ── --separate-git-dir checkout ──────────────────────────────────────────
  const separateGitDir = path.join(root, "sepco");
  const separateGitDirGitDir = path.join(root, "elsewhere.git");
  mkdirSync(separateGitDir);
  fixtureGit(root, ["init", "-q", `--separate-git-dir=${separateGitDirGitDir}`, separateGitDir]);
  commit(separateGitDir, "sep-seed");

  // ── ordinary checkout whose directory name ends in `.git` ────────────────
  const dotGitNamedCheckout = path.join(root, "app.git");
  mkdirSync(dotGitNamedCheckout);
  fixtureGit(dotGitNamedCheckout, ["init", "-q"]);
  commit(dotGitNamedCheckout, "app-seed");

  // ── a plain directory outside any repository ─────────────────────────────
  const nonRepo = realpathSync(mkdtempSync(path.join(tmpdir(), "gitroots-plain-")));

  return {
    root,
    normal,
    normalSubdir,
    worktree,
    superproject,
    submodule,
    submoduleWorktree,
    bare,
    bareWorktree,
    separateGitDir,
    separateGitDirGitDir,
    dotGitNamedCheckout,
    nonRepo,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      rmSync(nonRepo, { recursive: true, force: true });
    },
  };
}
