/**
 * Fixtures for the `pi-spec-driven` workflow-schema suites: temp repos, a
 * fault-injectable fake CLI, and an fs snapshot. See change: add-pi-spec-driven-schema.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveExecutorArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import type {
  CliCall,
  CliCtx,
  CliResult,
  CliRunner,
  WorkflowSchemaDeps,
} from "../../openspec/workflow-schema.js";

const BASE_SCHEMA_YAML = `name: spec-driven
version: 1
description: Package base schema
# a comment that must survive
artifacts:
  - id: design
    generates: design.md
    description: Design
    template: design.md
    instruction: |
      Create the design document.

      When to include design.md (create only if any apply):
      - Cross-cutting change
    requires:
      - proposal
`;

export function mkTmp(prefix: string): string {
  // realpath: macOS tmpdir is a symlink and the CLI emits canonical paths.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)));
}

export function write(root: string, relPath: string, content: string): void {
  const p = path.join(root, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** Minimal repo: `openspec/config.yaml` + `openspec/changes/`. */
export function mkRepo(opts: { config?: string | null; configFile?: string } = {}): string {
  const root = mkTmp("wfs");
  fs.mkdirSync(path.join(root, "openspec", "changes"), { recursive: true });
  if (opts.config !== null) {
    write(root, `openspec/${opts.configFile ?? "config.yaml"}`, opts.config ?? "schema: spec-driven\n");
  }
  return root;
}

/** Path → content-hash map of every entry (files, dirs, symlinks) below `root`; byte-identity check. */
export function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const rel = path.relative(root, full);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) out[rel] = `L:${fs.readlinkSync(full)}`;
      else if (st.isDirectory()) {
        out[rel] = "D";
        walk(full);
      } else out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

export interface FakeCliOptions {
  version?: string;
  /** `schema which spec-driven` (scratch) answer. */
  whichBase?: { source: string; shadows: unknown[] };
  /** Base `schema.yaml` the fake `fork` writes (name is rewritten). */
  baseYaml?: string;
  /** Names `schema which <name>` resolves from the project/package (default: spec-driven, pi-spec-driven, team-flow). */
  resolvable?: string[];
  /** `schema validate` of the SCRATCH schema fails. */
  scratchValidateFails?: boolean;
  /** `schema validate` run in the real project fails. */
  localValidateFails?: boolean;
  /** `status --all` root; `null` = no root key at all. */
  statusRoot?: { path?: string; source?: string } | null;
  /** Hook run inside `fork` after writing the files. */
  onFork?: (schemaDir: string) => void;
}

export interface FakeCli {
  cli: CliRunner;
  calls: Array<{ call: CliCall; ctx: CliCtx }>;
  count(op: CliCall["op"]): number;
  options: FakeCliOptions;
}

export function makeFakeCli(options: FakeCliOptions = {}): FakeCli {
  const calls: FakeCli["calls"] = [];
  const opt = options;
  const ok = (stdout: string): CliResult => ({ ok: true, stdout });
  const fail = (stdout = ""): CliResult => ({ ok: false, stdout, stderr: "", message: "exit 1" });
  const cli: CliRunner = async (call, ctx) => {
    calls.push({ call, ctx });
    switch (call.op) {
      case "version":
        return ok(`${opt.version ?? "1.11.0"}\n`);
      case "which": {
        if (call.name === "spec-driven" && ctx.cwd.includes("pi-wfs-")) {
          // generation scratch call
          return ok(JSON.stringify({ name: call.name, ...(opt.whichBase ?? { source: "package", shadows: [] }) }));
        }
        const resolvable = opt.resolvable ?? ["spec-driven", "pi-spec-driven", "team-flow"];
        return resolvable.includes(call.name)
          ? ok(JSON.stringify({ name: call.name, source: "project", shadows: [] }))
          : fail(JSON.stringify({ error: "not found" }));
      }
      case "fork": {
        const dir = path.join(ctx.cwd, "openspec", "schemas", call.name);
        fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
        const yaml = (opt.baseYaml ?? BASE_SCHEMA_YAML).replace(/^name: .*$/m, `name: ${call.name}`);
        fs.writeFileSync(path.join(dir, "schema.yaml"), yaml);
        fs.writeFileSync(path.join(dir, "templates", "design.md"), "# design\n");
        opt.onFork?.(dir);
        return ok("forked\n");
      }
      case "validate": {
        const scratch = ctx.cwd.includes("pi-wfs-");
        const failing = scratch ? opt.scratchValidateFails : opt.localValidateFails;
        return failing
          ? fail(JSON.stringify({ name: call.name, valid: false, issues: ["bad"] }))
          : ok(JSON.stringify({ name: call.name, valid: true, issues: [] }));
      }
      case "statusAll": {
        if (opt.statusRoot === null) return ok(JSON.stringify({ changes: [] }));
        const root = { path: ctx.cwd, source: "nearest", ...opt.statusRoot };
        return ok(JSON.stringify({ changes: [], root }));
      }
    }
  };
  return {
    cli,
    calls,
    count: (op) => calls.filter((c) => c.call.op === op).length,
    options: opt,
  };
}

/** Deps with a stub CLI, an instant `sleep`, and a private validate memo. */
export function stubDeps(
  fake: FakeCli,
  over: Partial<WorkflowSchemaDeps> = {},
): Partial<WorkflowSchemaDeps> {
  return {
    cli: fake.cli,
    sleep: async () => undefined,
    validateMemo: new Map(),
    ...over,
  };
}

/** True when the real `openspec` CLI resolves (real-CLI suites skip ONLY when it does not). */
export function realCliAvailable(): boolean {
  return resolveExecutorArgv("openspec", []) !== null;
}

/** Run the real CLI synchronously (cwd, optional env); returns stdout. Throws on non-zero. */
export function openspecSync(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const argv = resolveExecutorArgv("openspec", args);
  if (!argv) throw new Error("openspec CLI not available");
  return execFileSync(argv[0], argv.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function listDirNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Write a `pi-spec-driven/` with a stamp (or none) straight to disk. */
export function writeSchemaDir(
  root: string,
  stamp: { base: string; patch: number; previousDefault?: string } | null,
  extra: Record<string, string> = {},
): string {
  const dir = path.join(root, "openspec", "schemas", "pi-spec-driven");
  fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
  const stampYaml = stamp
    ? `x-pi-dashboard:\n  derivedFrom: spec-driven@${stamp.base}\n  patch: ${stamp.patch}\n  previousDefault: ${stamp.previousDefault ?? "spec-driven"}\n`
    : "";
  fs.writeFileSync(path.join(dir, "schema.yaml"), `name: pi-spec-driven\nversion: 1\nartifacts: []\n${stampYaml}`);
  fs.writeFileSync(path.join(dir, "templates", "design.md"), "# design\n");
  for (const [rel, content] of Object.entries(extra)) write(dir, rel, content);
  return dir;
}
