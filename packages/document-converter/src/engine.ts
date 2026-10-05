/**
 * Docker invocation layer.
 *
 * Spawns `docker run -i pi-doc-engine`, pipes one JSON request to stdin, reads
 * one JSON response from stdout, and maps exit codes + the response envelope to
 * typed errors. Mount *targets* keep the lexical request path so container
 * paths equal request paths — no path rewriting needed; mount *sources* are the
 * realpath'd host dir that is actually exposed.
 *
 * Confinement (change: harden-untrusted-content-ingestion, D1): every absolute
 * request path must lie under a configured root (`writable` ∪ `mounts` ∪
 * `workspaceRoot`), outside the sensitive denylist, before docker is spawned.
 *
 * The raw runner is injectable so unit tests can mock the Docker boundary
 * without a container.
 */

import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { DocConverterError } from "./errors.js";

/** One JSON request to the engine. `command` selects the handler. */
export interface EngineRequest {
  command: string;
  [key: string]: unknown;
}

/** Successful engine envelope. */
interface EngineOkResponse {
  ok: true;
  [key: string]: unknown;
}

/** Failure envelope. */
interface EngineErrResponse {
  ok: false;
  error: { code: string; message: string; stderr?: string };
}

type EngineResponse = EngineOkResponse | EngineErrResponse;

/** Low-level process result. */
export interface RunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Raw runner: given the full argv and the stdin payload, run the process and
 * return its captured output. Default uses `docker`; tests inject a fake.
 */
export type EngineRunner = (argv: string[], stdin: string) => Promise<RunnerResult>;

export interface EngineConfig {
  /** Image tag, e.g. `pi-doc-engine:0.1.0`. */
  image: string;
  /** Roots always mounted read-write (the facade puts `stagingDir` here). Created on demand. */
  writable?: string[];
  /** Extra caller-configured roots. Request paths under them are admitted. */
  mounts?: string[];
  /** Workspace root admitting request paths (default `process.cwd()`). */
  workspaceRoot?: string;
  /** Passed through to `docker run -e GEMINI_API_KEY` when set in env. */
  passEnv?: string[];
  /** Override the process runner (tests). */
  runner?: EngineRunner;
  /** docker binary (default `docker`). */
  dockerBin?: string;
}

const defaultRunner: EngineRunner = (argv, stdin) =>
  new Promise((resolve, reject) => {
    const [bin, ...args] = argv;
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    if (!child.stdout || !child.stderr || !child.stdin) {
      reject(
        new DocConverterError({
          code: "DOCKER_UNAVAILABLE",
          message: `spawned ${bin} without piped stdio`,
        }),
      );
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      reject(
        new DocConverterError({
          code: "DOCKER_UNAVAILABLE",
          message: `failed to spawn ${bin}: ${(err as Error).message}`,
        }),
      );
    });
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    child.stdin.end(stdin);
  });

/** One planned bind mount, keyed by its (lexical) container target. */
interface PlannedMount {
  source: string;
  mode: "ro" | "rw";
}

/** Build the `docker run` argv for a request. */
function buildArgv(cfg: EngineConfig, mounts: Map<string, PlannedMount>): string[] {
  const argv = [cfg.dockerBin ?? "docker", "run", "--rm", "-i"];
  for (const [target, { source, mode }] of mounts) {
    argv.push("-v", mode === "ro" ? `${source}:${target}:ro` : `${source}:${target}`);
  }
  for (const key of cfg.passEnv ?? ["GEMINI_API_KEY"]) {
    if (process.env[key] !== undefined) argv.push("-e", key);
  }
  argv.push(cfg.image);
  return argv;
}

/** Sensitive host dirs never mounted unless a containing root opts in. `~` = homedir at call time. */
const DENYLIST = ["/etc", "/root", "/var/run", "/proc", "/sys", "/dev"];
const HOME_DENYLIST = [".ssh", ".aws", ".gnupg", ".config", ".pi", ".docker", ".kube"];

/**
 * Write keys per command (mounted rw), and whether the command's other paths
 * are verified read-only. Unknown commands mount everything rw (within
 * confinement). Engine write sites: design D1 table.
 */
function modeFor(req: EngineRequest): { writeKeys: Set<string>; othersRo: boolean } {
  const apply = req.apply !== false;
  switch (req.command) {
    case "convertToMarkdown":
      return { writeKeys: new Set(), othersRo: true };
    case "renderPdf":
      return { writeKeys: new Set(["output"]), othersRo: true };
    case "renderDocx":
      return { writeKeys: new Set(["output", "cacheDir"]), othersRo: false };
    case "extractForEdit":
    case "mergeBack":
      return { writeKeys: new Set(["output"]), othersRo: false };
    case "fillFrontmatter":
    case "profileTables":
      return apply ? { writeKeys: new Set(["paths"]), othersRo: false } : { writeKeys: new Set(), othersRo: true };
    default:
      return { writeKeys: new Set(), othersRo: false };
  }
}

const isUnder = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** realpath of the nearest existing ancestor, with the non-existent remainder re-appended. */
async function realpathLoose(p: string): Promise<string> {
  let cur = resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(await realpath(cur), ...rest.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      rest.push(basename(cur));
      cur = parent;
    }
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function notAllowed(path: string, why: string, roots: string[]): DocConverterError {
  return new DocConverterError({
    code: "PATH_NOT_ALLOWED",
    message:
      `path not allowed: ${path} (${why}). Configured roots: ${roots.join(", ") || "(none)"}. ` +
      `Pass \`mounts:[dir]\` or \`workspaceRoot\` to admit files outside the workspace.`,
  });
}

/**
 * Plan the bind mounts for a request, enforcing confinement + denylist.
 * Throws `PATH_NOT_ALLOWED` before anything is spawned.
 */
async function planMounts(cfg: EngineConfig, req: EngineRequest): Promise<Map<string, PlannedMount>> {
  const configured = [...(cfg.writable ?? []), ...(cfg.mounts ?? []), cfg.workspaceRoot ?? process.cwd()];
  // Materialise roots: create writable ones, then realpath every root.
  for (const w of cfg.writable ?? []) await mkdir(w, { recursive: true });
  const roots: string[] = [];
  for (const r of configured) {
    const real = await realpathLoose(r);
    if (real === sep || resolve(r) === sep) throw notAllowed(r, "`/` cannot be a root", configured);
    roots.push(real);
  }

  // Denylist entries, lexical + realpath (e.g. /var/run → /run, symlinked ~/.pi).
  const home = homedir();
  const deny: string[][] = [];
  for (const d of [...DENYLIST, ...HOME_DENYLIST.map((h) => join(home, h))]) {
    deny.push([...new Set([d, await realpathLoose(d)])]);
  }

  const plan = new Map<string, PlannedMount>();
  const addMount = (target: string, source: string, mode: "ro" | "rw") => {
    const prev = plan.get(target);
    plan.set(target, { source, mode: prev?.mode === "rw" ? "rw" : mode });
  };
  for (const w of cfg.writable ?? []) addMount(resolve(w), await realpathLoose(w), "rw");

  const { writeKeys, othersRo } = modeFor(req);
  const check = async (p: string, mode: "ro" | "rw") => {
    if (!isAbsolute(p)) return; // engine has no host cwd: relative paths never hit host files
    if (p.split(/[\\/]/).includes("..")) throw notAllowed(p, "`..` segment", configured);
    if (p.includes(":")) throw notAllowed(p, "`:` breaks the bind-mount spec", configured);
    const lexical = resolve(p);
    const globAt = lexical.search(/[*?[]/);
    let target: string;
    if (globAt >= 0) target = dirname(lexical.slice(0, globAt + 1));
    else if (await isDir(lexical)) target = lexical;
    else target = dirname(lexical);
    const realPath = await realpathLoose(lexical.slice(0, globAt >= 0 ? globAt : undefined));
    const source = await realpathLoose(target);

    const containing = roots.filter((r) => isUnder(realPath, r) && isUnder(source, r));
    if (containing.length === 0) throw notAllowed(p, "outside every configured root", configured);
    for (const variants of deny) {
      const hit = variants.some((d) => isUnder(source, d) || isUnder(realPath, d) || (globAt >= 0 && isUnder(d, source)));
      if (!hit) continue;
      const optedIn = containing.some((r) => variants.some((d) => isUnder(r, d)));
      if (!optedIn) throw notAllowed(p, `sensitive directory ${variants[0]}`, configured);
    }
    addMount(target, source, mode);
  };

  for (const [k, v] of Object.entries(req)) {
    if (k === "command") continue;
    const mode = writeKeys.has(k) || !othersRo ? "rw" : "ro";
    for (const item of Array.isArray(v) ? v : [v]) {
      if (typeof item === "string") await check(item, mode);
    }
  }
  // Only after every path passed: create missing rw dirs (else docker creates them as root).
  for (const { source, mode } of plan.values()) {
    if (mode === "rw" && !(await isDir(source))) await mkdir(source, { recursive: true });
  }
  return plan;
}

/**
 * Run one engine command. Resolves with the `ok:true` envelope (minus `ok`),
 * rejects with a `DocConverterError` on any failure.
 */
export async function runEngine<T = Record<string, unknown>>(
  cfg: EngineConfig,
  req: EngineRequest,
): Promise<T> {
  const runner = cfg.runner ?? defaultRunner;
  const argv = buildArgv(cfg, await planMounts(cfg, req));
  const { stdout, stderr, exitCode } = await runner(argv, JSON.stringify(req));

  let parsed: EngineResponse | undefined;
  try {
    parsed = JSON.parse(stdout) as EngineResponse;
  } catch {
    // No parsable envelope — surface the raw failure.
    throw new DocConverterError({
      code: exitCode === 0 ? "BAD_RESPONSE" : "ENGINE_NONZERO",
      message:
        exitCode === 0
          ? "engine returned non-JSON output"
          : `engine exited ${exitCode}`,
      stderr: stderr || stdout,
      exitCode,
    });
  }

  if (parsed.ok === false) {
    const { code, message, stderr: estderr } = parsed.error;
    throw new DocConverterError({
      code: mapEngineCode(code),
      message,
      stderr: estderr ?? stderr,
      exitCode,
    });
  }

  if (exitCode !== 0) {
    throw new DocConverterError({
      code: "ENGINE_NONZERO",
      message: `engine exited ${exitCode} despite ok envelope`,
      stderr,
      exitCode,
    });
  }

  const { ok: _ok, ...rest } = parsed;
  return rest as T;
}

/** Map engine-side error codes to facade error codes. */
function mapEngineCode(code: string): DocConverterError["code"] {
  switch (code) {
    case "INPUT_NOT_FOUND":
      return "INPUT_NOT_FOUND";
    case "OCR_ENGINE_UNKNOWN":
      return "OCR_ENGINE_UNKNOWN";
    case "INGEST_FAILED":
    case "DOCLING_UNAVAILABLE":
      return "INGEST_FAILED";
    case "PRODUCE_FAILED":
    case "MMDC_FAILED":
      return "PRODUCE_FAILED";
    case "FILL_FAILED":
      return "FILL_FAILED";
    case "PROFILE_FAILED":
      return "PROFILE_FAILED";
    default:
      return "INTERNAL";
  }
}
