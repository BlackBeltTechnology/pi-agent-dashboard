/**
 * Docker invocation layer.
 *
 * Spawns `docker run -i pi-doc-engine`, pipes one JSON request to stdin, reads
 * one JSON response from stdout, and maps exit codes + the response envelope to
 * typed errors. Mounts are **path-identical** (`-v dir:dir -w dir`) so host
 * paths equal container paths — no path rewriting needed.
 *
 * The raw runner is injectable so unit tests can mock the Docker boundary
 * without a container.
 */
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { dirname } from "node:path";
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
  /** Host dirs to bind-mount path-identically (parents of all referenced files). */
  mounts?: string[];
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

/** Build the `docker run` argv for a request. */
function buildArgv(cfg: EngineConfig, mounts: Set<string>): string[] {
  const argv = [cfg.dockerBin ?? "docker", "run", "--rm", "-i"];
  for (const m of mounts) argv.push("-v", `${m}:${m}`);
  for (const key of cfg.passEnv ?? ["GEMINI_API_KEY"]) {
    if (process.env[key] !== undefined) argv.push("-e", key);
  }
  argv.push(cfg.image);
  return argv;
}

/** Collect every filesystem path referenced by a request so we can mount its dir. */
function collectMountDirs(cfg: EngineConfig, req: EngineRequest): Set<string> {
  const dirs = new Set<string>(cfg.mounts ?? []);
  const add = (p: unknown) => {
    if (typeof p === "string" && p.startsWith("/")) dirs.add(dirname(p));
  };
  for (const [k, v] of Object.entries(req)) {
    if (k === "command") continue;
    if (Array.isArray(v)) v.forEach(add);
    else add(v);
  }
  return dirs;
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
  const argv = buildArgv(cfg, collectMountDirs(cfg, req));
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
