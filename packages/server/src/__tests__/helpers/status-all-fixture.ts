/**
 * Test fixture: a fake `openspec status --all --json` CLI that renders its
 * envelope from the REAL tmp tree, the way the real CLI does (artifact status
 * from file existence, `existingOutputPaths` from disk, one broken change →
 * exit 1 with the rest of the JSON complete). Used by the `status --all`
 * directory-service suites. See change: use-openspec-status-all.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { StatusAllRaw } from "@blackbelt-technology/pi-dashboard-shared/openspec-status-all.js";

export interface FixtureCliOptions {
  /** Extra artifacts per change (id → output path), appended in CLI order. */
  extraArtifacts?: Record<string, string>;
  /** Called BEFORE the envelope is rendered, i.e. after the pre-call probe (created-between-probe-and-spawn hook). */
  beforeRender?: () => void | Promise<void>;
  /** Called after the envelope is computed but BEFORE it is returned (write-during-call hook). */
  duringCall?: () => void | Promise<void>;
}

export interface FixtureCli {
  /** The mock for `runOpenSpecStatusAll`. */
  run: (cwd: string) => Promise<StatusAllRaw>;
  calls: number;
  options: FixtureCliOptions;
  /** Next call returns this instead of rendering (consumed once). */
  failNextWith?: StatusAllRaw;
}

export function mkTmpCwd(prefix: string): string {
  // realpath: macOS tmpdir is a symlink and the real CLI emits canonical paths.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)));
}

export function writeFile(cwd: string, rel: string, content: string): void {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** `n` changes `c000…`, each with proposal/design/tasks + one spec. */
export function seedChanges(cwd: string, n: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const name = `c${String(i).padStart(3, "0")}`;
    names.push(name);
    writeFile(cwd, `openspec/changes/${name}/proposal.md`, "# p\n");
    writeFile(cwd, `openspec/changes/${name}/design.md`, "# d\n");
    writeFile(cwd, `openspec/changes/${name}/specs/cap/spec.md`, "## ADDED Requirements\n");
    writeFile(cwd, `openspec/changes/${name}/tasks.md`, "- [x] 1.1 a\n- [ ] 1.2 b\n");
  }
  return names;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Render the `--all` envelope for the tree under `cwd`. */
export function renderStatusAll(cwd: string, options: FixtureCliOptions = {}): StatusAllRaw {
  const root = fs.realpathSync(cwd);
  const changesDir = path.join(root, "openspec", "changes");
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(changesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "archive")
      .map((e) => e.name)
      .sort();
  } catch {
    names = [];
  }
  let anyBroken = false;
  const changes = names.map((name) => {
    const changeRoot = path.join(changesDir, name);
    const meta = path.join(changeRoot, ".openspec.yaml");
    if (fs.existsSync(meta) && fs.readFileSync(meta, "utf8").includes("[unclosed")) {
      anyBroken = true;
      return { changeName: name, status: [{ severity: "error", code: "change_error", message: "Invalid YAML in metadata file" }] };
    }
    const outputs: Array<[string, string]> = [
      ["proposal", "proposal.md"],
      ["specs", "specs/**/*.md"],
      ["design", "design.md"],
      ["tasks", "tasks.md"],
      ...Object.entries(options.extraArtifacts ?? {}),
    ];
    const artifactPaths: Record<string, unknown> = {};
    const artifacts = outputs.map(([id, out]) => {
      const existing = out.includes("*")
        ? listFiles(path.join(changeRoot, out.split("/")[0])).filter((f) => f.endsWith(".md"))
        : fs.existsSync(path.join(changeRoot, out))
          ? [path.join(changeRoot, out)]
          : [];
      artifactPaths[id] = { outputPath: out, resolvedOutputPath: path.join(changeRoot, out), existingOutputPaths: existing };
      return { id, outputPath: out, status: existing.length > 0 ? "done" : "ready", requires: [] };
    });
    return {
      changeName: name,
      schemaName: "spec-driven",
      changeRoot,
      artifactPaths,
      isComplete: artifacts.every((a) => a.status === "done"),
      artifacts,
    };
  });
  return {
    stdout: JSON.stringify({ changes, root: { path: root, source: "nearest" } }),
    stderr: "",
    exitCode: anyBroken ? 1 : 0,
  };
}

export function createFixtureCli(options: FixtureCliOptions = {}): FixtureCli {
  const cli: FixtureCli = {
    calls: 0,
    options,
    run: async (cwd: string) => {
      cli.calls++;
      if (cli.failNextWith) {
        const f = cli.failNextWith;
        cli.failNextWith = undefined;
        return f;
      }
      await cli.options.beforeRender?.();
      const raw = renderStatusAll(cwd, cli.options);
      await cli.options.duringCall?.();
      return raw;
    },
  };
  return cli;
}

/** Bump a file's mtime well into the future (an in-place edit the dir mtime cannot see). */
export function touchFuture(file: string, offsetMs = 60_000): void {
  const t = new Date(Date.now() + offsetMs);
  fs.utimesSync(file, t, t);
}

/**
 * Set every file and directory under `dir` to `ageMs` in the past (children
 * before parents), so a later create/delete/rename moves a directory mtime
 * past it even on filesystems with coarse timestamp granularity.
 */
export function backdate(dir: string, ageMs = 10_000): void {
  const t = new Date(Date.now() - ageMs);
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else fs.utimesSync(p, t, t);
    }
    fs.utimesSync(d, t, t);
  };
  walk(dir);
}
