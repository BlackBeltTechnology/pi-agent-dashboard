import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DEFAULTS } from "@blackbelt-technology/pi-dashboard-kb";
import { casePath, readCaseSet } from "./cases.js";
import type { Ctx } from "../ctx.js";
import { runOne, type CaseResult, type Retriever } from "../retriever.js";
import { BUILTIN_IDS, hermesRetrievers, kbRetriever } from "../retrievers/builtin.js";
import { loadRetrieverModule } from "../retrievers/external.js";
import { hermesFingerprint, kbFingerprint, snapshotDb } from "../snapshot.js";
import { CliError, stableJson } from "../util.js";
import { ensureWorkDir, resolvePaths, writeSecure } from "../workdir.js";
import { basename } from "node:path";

export interface RunArgs {
  set?: string;
  retrievers?: string[];
  retrieverModule?: string;
  /** Hermes `project` filter; default = basename of the project dir. */
  hermesProject?: string;
  /** kb index path; default `<cwd>/.pi/dashboard/kb/index.db`. */
  kbIndex?: string;
}

export interface RetrieverStatus {
  id: string;
  version: string;
  asOf: "strict" | "none";
  status: "ok" | "unavailable";
  reason?: string;
  sessionBacked?: boolean;
}

export interface RetrievedFile {
  runId: string;
  caseSetName: string;
  caseSetHash: string;
  retrievers: RetrieverStatus[];
  results: Record<string, Record<string, CaseResult>>;
}

export const ABSENT = "absent";

export function runDir(runsDir: string, runId: string): string {
  return join(runsDir, runId);
}

export function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new CliError(`not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function latestRunId(runsDir: string): string {
  const ids = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
  if (!ids.length) throw new CliError(`no runs in ${runsDir}`);
  return ids[ids.length - 1];
}

function newRunId(ctx: Ctx, runsDir: string): string {
  const stamp = (ctx.now?.() ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  let id = `r${stamp}`;
  for (let n = 2; existsSync(join(runsDir, id)); n++) id = `r${stamp}-${n}`;
  return id;
}

function hermesVersion(ctx: Ctx): string {
  const dir = ctx.hermesPackageDir ?? join(ctx.home, ".pi", "agent", "npm", "node_modules", "pi-hermes-memory");
  try {
    return String(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version ?? ABSENT);
  } catch {
    return ABSENT;
  }
}

function piVersion(ctx: Ctx): string {
  if (ctx.piVersion) return ctx.piVersion;
  try {
    const [cmd, ...rest] = ctx.piCommand;
    const r = spawnSync(cmd, [...rest, "--version"], { encoding: "utf8", timeout: 15_000 });
    return r.status === 0 ? `${r.stdout}${r.stderr}`.trim().split("\n").pop() || ABSENT : ABSENT;
  } catch {
    return ABSENT;
  }
}

export async function runCommand(ctx: Ctx, args: RunArgs = {}): Promise<number> {
  const p = resolvePaths({ cwd: ctx.cwd, home: ctx.home });
  const set = args.set ?? "baseline";
  const caseSet = readCaseSet(casePath(p.casesDir, set));

  const selected = args.retrievers?.length ? args.retrievers : [...BUILTIN_IDS];
  for (const id of selected) {
    if (!(BUILTIN_IDS as readonly string[]).includes(id)) throw new CliError(`unknown retriever '${id}' (built-ins: ${BUILTIN_IDS.join(", ")})`);
  }
  // Validate the external module before anything is snapshotted or searched.
  const external = args.retrieverModule ? await loadRetrieverModule(args.retrieverModule, ctx.cwd, BUILTIN_IDS) : null;

  ensureWorkDir(p);
  const runId = newRunId(ctx, p.runsDir);
  const dir = runDir(p.runsDir, runId);
  const snapDir = join(p.snapshotsDir, runId);
  const statuses: RetrieverStatus[] = [];
  const active: Retriever[] = [];
  const snapshots: Record<string, unknown> = {};
  let kbChunks: unknown = ABSENT;

  const wantHermes = selected.some((id) => id.startsWith("hermes."));
  if (wantHermes) {
    const src = join(ctx.home, ".pi", "agent", "pi-hermes-memory", "sessions.db");
    const snap = snapshotDb({ source: src, destDir: snapDir, name: "hermes.db", fingerprint: hermesFingerprint, deps: ctx.snapshotDeps });
    if (snap.status === "ok") {
      snapshots.hermes = { status: "ok", attempts: snap.attempts, fingerprint: snap.fingerprint };
      for (const r of hermesRetrievers(snap.path)) if (selected.includes(r.id)) active.push(r);
    } else {
      snapshots.hermes = ABSENT;
      for (const id of selected.filter((s) => s.startsWith("hermes."))) statuses.push({ id, version: "", asOf: "strict", status: "unavailable", reason: "hermes sessions.db absent" });
    }
  } else snapshots.hermes = ABSENT;

  if (selected.includes("kb.docs")) {
    const src = args.kbIndex ?? join(ctx.cwd, DEFAULTS.dbPath);
    const snap = snapshotDb({ source: src, destDir: snapDir, name: "kb.db", fingerprint: kbFingerprint, deps: ctx.snapshotDeps });
    if (snap.status === "ok") {
      snapshots.kb = { status: "ok", attempts: snap.attempts, fingerprint: snap.fingerprint };
      kbChunks = snap.fingerprint.chunks ?? ABSENT;
      active.push(kbRetriever(snap.path, ctx.cwd));
    } else {
      snapshots.kb = ABSENT;
      statuses.push({ id: "kb.docs", version: "", asOf: "none", status: "unavailable", reason: "kb index absent" });
    }
  } else snapshots.kb = ABSENT;

  if (external) active.push(...external.retrievers);
  for (const r of active) statuses.push({ id: r.id, version: r.version, asOf: r.asOf, status: "ok", ...(r.sessionBacked ? { sessionBacked: true } : {}) });

  const project = args.hermesProject ?? basename(ctx.cwd);
  const results: RetrievedFile["results"] = {};
  for (const r of active) {
    const per: Record<string, CaseResult> = {};
    for (const c of caseSet.cases) per[c.id] = await runOne(r, c, { project, cwd: ctx.cwd, timeoutMs: ctx.searchTimeoutMs });
    results[r.id] = per;
  }

  const retrieved: RetrievedFile = { runId, caseSetName: set, caseSetHash: caseSet.caseSetHash, retrievers: statuses.sort((a, b) => (a.id < b.id ? -1 : 1)), results };
  writeSecure(join(dir, "retrieved.json"), stableJson(retrieved));
  const modOf = (id: string) => (external?.retrievers.some((r) => r.id === id) ? { path: external.path, sha256: external.sha256 } : ABSENT);
  writeSecure(
    join(dir, "manifest.json"),
    stableJson({
      runId,
      date: (ctx.now?.() ?? new Date()).toISOString(),
      caseSet: { name: set, hash: caseSet.caseSetHash, seed: caseSet.seed, quotas: caseSet.quotas, inputFingerprint: caseSet.inputFingerprint },
      retrievers: retrieved.retrievers.map((r) => ({ id: r.id, version: r.version || ABSENT, asOf: r.asOf, status: r.status, module: modOf(r.id) })),
      judge: { role: ABSENT, model: ABSENT, promptVersion: ABSENT, promptSha256: ABSENT, scrubSha256: ABSENT, validitySetHash: ABSENT },
      versions: { pi: piVersion(ctx), hermes: hermesVersion(ctx) },
      snapshots,
      kbChunkCount: kbChunks,
      hermesProject: project,
    }),
  );
  ctx.out(`run ${runId}: ${active.length} retrievers × ${caseSet.cases.length} cases${statuses.some((s) => s.status === "unavailable") ? ` (unavailable: ${statuses.filter((s) => s.status === "unavailable").map((s) => s.id).join(", ")})` : ""}\n`);
  return 0;
}
