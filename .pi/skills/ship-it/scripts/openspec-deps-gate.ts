/**
 * Dependency gate at ship-it entry (design D9): prints a JSON verdict for one
 * OpenSpec change — are its declared / inferred blockers shipped?
 *
 *   npx tsx .pi/skills/ship-it/scripts/openspec-deps-gate.ts --change <name> [--cwd <dir>]
 *
 * Online: asks the dashboard (`GET /api/openspec/dependencies`) for the full
 * computed graph for this checkout (5 s per request, 503 `pending` retried up to
 * 3 × 2 s apart). Offline (any other failure — no server, non-2xx, a remote
 * dashboard, CI): the shared parser over this checkout's files; it sees only the
 * change's own `dependencies.yaml` (`invalid-file`, `self-reference`, unknown
 * names) and says cycles and inferred edges were not checked. Either way a
 * blocker whose archive entry is already on `origin/develop` counts as satisfied
 * (implementation precedes the step-2.5 merge).
 *
 * The script owns all logic so the LLM-run skill stays deterministic. It always
 * exits 0 with a verdict; usage errors exit 2. Never throws on I/O.
 *
 * See change: add-openspec-change-dependencies.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDashboardPorts } from "../../../../packages/shared/src/config.ts";
import {
  archivedChangeName,
  type ChangeInputs,
  computeDependencyGraph,
  DEPENDENCIES_FILE,
  KEBAB_ID_REGEX,
  readDependenciesFile,
} from "../../../../packages/shared/src/openspec-dependencies.ts";
import type {
  ChangeDependencies,
  DependencyEdgeSource,
  DependencyIssue,
} from "../../../../packages/shared/src/types.ts";

export type GateStatus = "ok" | "warn" | "blocked";
export type GateMode = "online" | "offline";

/** One blocker of the change: `open` = unshipped, `satisfied` = archived (here or on `origin/develop`), `unknown` = names no change. */
export interface GateBlocker {
  change: string;
  state: "open" | "satisfied" | "unknown";
  source: DependencyEdgeSource;
  reason?: string;
}

export interface GateVerdict {
  status: GateStatus;
  mode: GateMode;
  blockers: GateBlocker[];
  issues: DependencyIssue[];
  notes: string[];
}

export interface GateOptions {
  cwd: string;
  change: string;
  env?: Record<string, string | undefined>;
  /** Test seam: overrides the dashboard base URL (default `http://localhost:<port>`). */
  baseUrl?: string;
  requestTimeoutMs?: number;
  /** Max retries of a 503 `pending` answer. */
  maxRetries?: number;
  retryDelayMs?: number;
  fetchTimeoutMs?: number;
  /** Test seam: skip `git fetch` + origin/develop lookup entirely. */
  skipDevelop?: boolean;
}

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;
const GIT_FETCH_TIMEOUT_MS = 10_000;

function readFileConfig(): { port?: number; piPort?: number } {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi", "dashboard", "config.json"), "utf8")) as {
      port?: unknown;
      piPort?: unknown;
    };
    return {
      ...(typeof raw.port === "number" ? { port: raw.port } : {}),
      ...(typeof raw.piPort === "number" ? { piPort: raw.piPort } : {}),
    };
  } catch {
    return {};
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Online answer, or `null` when the caller should fall back to the offline path. */
async function askDashboard(opts: GateOptions, notes: string[]): Promise<ChangeDependencies | null> {
  const env = opts.env ?? process.env;
  const base = opts.baseUrl ?? `http://localhost:${resolveDashboardPorts(env, readFileConfig()).port}`;
  const url = `${base}/api/openspec/dependencies?cwd=${encodeURIComponent(opts.cwd)}&change=${encodeURIComponent(opts.change)}`;
  const timeout = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const delay = opts.retryDelayMs ?? RETRY_DELAY_MS;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    } catch {
      notes.push("dashboard not reachable; used the offline check");
      return null;
    }
    if (res.status === 503 && attempt < maxRetries) {
      await sleep(delay);
      continue;
    }
    if (!res.ok) {
      notes.push(`dashboard answered ${res.status}; used the offline check`);
      return null;
    }
    try {
      const body = (await res.json()) as { success?: boolean; data?: { dependencies?: ChangeDependencies | null } };
      const dep = body.data?.dependencies;
      if (body.success && dep) return dep;
    } catch {
      /* fall through */
    }
    notes.push("dashboard answer had no dependencies; used the offline check");
    return null;
  }
}

/** Offline path: this change's own file + name resolution against this checkout. */
async function offlineEntry(opts: GateOptions): Promise<ChangeDependencies> {
  const changesDir = path.join(opts.cwd, "openspec", "changes");
  let active: string[] = [];
  let archived: string[] = [];
  try {
    active = fs
      .readdirSync(changesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "archive" && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    /* no changes dir */
  }
  try {
    archived = fs
      .readdirSync(path.join(changesDir, "archive"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => archivedChangeName(e.name))
      .filter((n): n is string => n !== null);
  } catch {
    /* no archive */
  }
  const file = await readDependenciesFile(path.join(changesDir, opts.change, DEPENDENCIES_FILE));
  const declared: ChangeInputs["declared"] =
    file.kind === "ok" ? { state: "ok", value: file.value } : file.kind === "invalid" ? { state: "invalid", error: file.error } : { state: "absent" };
  const names = new Set([...active, opts.change]);
  const changes: ChangeInputs[] = [...names].map((name) => ({
    name,
    declared: name === opts.change ? declared : { state: "absent" },
    proposal: null,
    deltas: {},
  }));
  return computeDependencyGraph({ changes, archived, mainSpecs: [] })[opts.change];
}

/** Archive entry names (`<date>-<name>` → `<name>`) on `origin/develop`, or `null` when unavailable. */
function developArchivedNames(cwd: string, fetchTimeoutMs: number, notes: string[]): Set<string> | null {
  try {
    execFileSync("git", ["fetch", "origin", "develop"], { cwd, stdio: "ignore", timeout: fetchTimeoutMs });
  } catch {
    notes.push("git fetch origin develop failed; used the existing origin/develop ref");
  }
  try {
    const out = execFileSync("git", ["ls-tree", "--name-only", "origin/develop", "openspec/changes/archive/"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    const names = new Set<string>();
    for (const line of out.split("\n")) {
      const n = archivedChangeName(path.posix.basename(line.trim()));
      if (n) names.add(n);
    }
    return names;
  } catch {
    notes.push("origin/develop is not available; archived-on-develop blockers were not checked");
    return null;
  }
}

export async function runGate(opts: GateOptions): Promise<GateVerdict> {
  const notes: string[] = [];
  const online = KEBAB_ID_REGEX.test(opts.change) ? await askDashboard(opts, notes) : null;
  const mode: GateMode = online ? "online" : "offline";
  let entry: ChangeDependencies;
  if (online) {
    entry = online;
  } else {
    if (!KEBAB_ID_REGEX.test(opts.change)) notes.push(`"${opts.change}" is not a valid change name`);
    entry = await offlineEntry(opts);
    notes.push("offline: cycles and inferred edges were not checked");
  }

  let blockers: GateBlocker[] = [
    ...entry.blockedBy.map((e) => ({ change: e.change, state: e.state, source: e.source, ...(e.reason ? { reason: e.reason } : {}) })),
    // A declared name that resolves to nothing is reported, not silently dropped.
    ...entry.issues
      .filter((i) => i.code === "unknown-change")
      .flatMap((i) => (i.with ?? []).map((change) => ({ change, state: "unknown" as const, source: "declared" as const }))),
  ];

  if (blockers.some((b) => b.state === "open") && !opts.skipDevelop) {
    const onDevelop = developArchivedNames(opts.cwd, opts.fetchTimeoutMs ?? GIT_FETCH_TIMEOUT_MS, notes);
    if (onDevelop) {
      blockers = blockers.map((b) => {
        if (b.state !== "open" || !onDevelop.has(b.change)) return b;
        notes.push(`${b.change} is archived on origin/develop (pending merge into this branch); counted as satisfied`);
        return { ...b, state: "satisfied" as const };
      });
    }
  }

  const status: GateStatus = entry.issues.some((i) => i.severity === "error")
    ? "blocked"
    : blockers.some((b) => b.state === "open")
      ? "warn"
      : "ok";
  return { status, mode, blockers, issues: entry.issues, notes };
}

function parseArgs(argv: string[]): { change?: string; cwd: string } {
  const out: { change?: string; cwd: string } = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--change") out.change = argv[++i];
    else if (argv[i] === "--cwd") out.cwd = path.resolve(argv[++i] ?? ".");
  }
  return out;
}

async function main(): Promise<void> {
  const { change, cwd } = parseArgs(process.argv.slice(2));
  if (!change) {
    process.stderr.write("usage: openspec-deps-gate.ts --change <name> [--cwd <dir>]\n");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(await runGate({ cwd, change }), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    process.stderr.write(`openspec-deps-gate failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
