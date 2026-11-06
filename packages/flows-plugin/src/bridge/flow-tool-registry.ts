/**
 * flows-plugin · dashboard tool-registry facade for pi-flows code nodes.
 *
 * pi-flows' `CodeNodeContext` carries no tool handle. Code-node handlers run in
 * this same pi process, so the bridge publishes a narrow facade over the
 * dashboard tool registry on `globalThis[Symbol.for("pi-dashboard.flow-tools")]`.
 * Handlers resolve and run any registered tool by name through the same
 * resolution the dashboard uses (overrides, managed runtimes, bundled bash).
 *
 * - `has` / `resolve` — by name only; no resolve-all `list()` (it would block
 *   the event loop on every probe).
 * - `run` / `shell` — async spawn so the bridge sharing this event loop never
 *   stalls; never throw; 127 unresolved, 130 pre-aborted; timeout / abort /
 *   64 MiB-per-stream cap kill the whole process group within 2 s.
 * - `shell` — registry bash, `--noprofile --norc`, inherited BASH_ENV/ENV dropped.
 *
 * Plugin-scoped: nothing in pi-flows, dashboard core or the registry changes.
 * See change: add-flow-code-node-tools (design D1–D4, D6).
 */
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { spawn as defaultSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { killProcessGroup } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { buildSpawnEnvForArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

/** `Symbol.for` key of the process-global slot code-node handlers read. */
export const FLOW_TOOLS_SYMBOL_KEY = "pi-dashboard.flow-tools";
const SLOT = Symbol.for(FLOW_TOOLS_SYMBOL_KEY);

/** Fixed per-stream output cap (stdout and stderr each). */
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** SIGTERM → SIGKILL grace, keeping termination inside the 2 s bound. */
const KILL_GRACE_MS = 1000;
/** Upper wait for stdio to close after the group is killed. */
const CLOSE_WAIT_MS = 500;

interface FlowToolRunOptions {
  cwd?: string;
  /** Merged over the dashboard spawn env (caller wins). */
  env?: Record<string, string>;
  /** Positive finite ms; anything else means no timeout. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface FlowToolResult {
  /** True only when the process exited 0. */
  ok: boolean;
  /** Exit code; 127 unresolved, 130 aborted, 124 timed out. */
  code: number;
  stdout: string;
  stderr: string;
  /** stdout followed by stderr. */
  out: string;
}

export interface FlowTools {
  has(name: string): boolean;
  /** Absolute resolved path, or null (unregistered, unresolved, path-less, error). */
  resolve(name: string): string | null;
  run(name: string, args?: readonly string[], opts?: FlowToolRunOptions): Promise<FlowToolResult>;
  shell(script: string, opts?: FlowToolRunOptions): Promise<FlowToolResult>;
}

/** The registry surface the facade reads. */
interface RegistryLike {
  has(name: string): boolean;
  resolve(name: string): { ok: boolean; path: string | null };
  resolveExecutor(name: string): { ok: boolean; argv: string[] };
}

export interface FlowToolsDeps {
  registry?: () => RegistryLike;
  spawn?: typeof defaultSpawn;
}

const fail = (code: number, message: string): FlowToolResult => ({
  ok: false,
  code,
  stdout: "",
  stderr: message,
  out: message,
});

const isAbsolutePath = (p: string): boolean => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");

/** Env for a facade spawn: dashboard PATH augmentation, caller overrides, Electron-as-Node when needed. */
function spawnEnv(argv0: string, opts: FlowToolRunOptions | undefined, dropShellInit: boolean): NodeJS.ProcessEnv {
  const base = new ToolResolver({ processExecPath: process.execPath }).buildSpawnEnv(process.env);
  const merged = { ...base, ...(opts?.env ?? {}) };
  // buildSpawnEnvForArgv re-merges process.env, so drop inherited shell-init vars AFTER it.
  const env = buildSpawnEnvForArgv(argv0, merged) ?? merged;
  if (dropShellInit) {
    for (const key of ["BASH_ENV", "ENV"]) {
      if (opts?.env?.[key] === undefined) delete env[key];
    }
  }
  return env;
}

function execArgv(
  argv: string[],
  args: readonly string[],
  opts: FlowToolRunOptions | undefined,
  spawnFn: typeof defaultSpawn,
  dropShellInit: boolean,
): Promise<FlowToolResult> {
  if (opts?.signal?.aborted) return Promise.resolve(fail(130, "aborted before start"));
  const [bin, ...prefix] = argv;
  return new Promise<FlowToolResult>((resolve) => {
    let child: ReturnType<typeof defaultSpawn>;
    try {
      child = spawnFn(bin, [...prefix, ...args], {
        cwd: opts?.cwd,
        env: spawnEnv(bin, opts, dropShellInit),
        detached: process.platform !== "win32", // platform-branch-ok: POSIX own process group so killProcessGroup reaches grandchildren; win32 detach would escape the job object
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      resolve(fail(127, (err as Error).message));
      return;
    }

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let killedFor: "abort" | "timeout" | "cap" | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null, spawnError?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
      const stdout = Buffer.concat(out).toString("utf8");
      let stderr = Buffer.concat(err).toString("utf8");
      if (spawnError) stderr += `${stderr ? "\n" : ""}${spawnError.message}`;
      const code = spawnError
        ? (spawnError as NodeJS.ErrnoException).code === "ENOENT"
          ? 127
          : 126
        : killedFor === "abort"
          ? 130
          : killedFor === "timeout"
            ? 124
            : (exitCode ?? 1);
      resolve({ ok: !spawnError && killedFor === null && exitCode === 0, code, stdout, stderr, out: stdout + stderr });
    };

    const kill = (reason: "abort" | "timeout" | "cap"): void => {
      if (killedFor || settled) return;
      killedFor = reason;
      const pid = child.pid;
      const done = () => {
        // stdio may be held open by an unkillable descendant; never wait past the bound.
        setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(null);
        }, CLOSE_WAIT_MS).unref();
      };
      if (!pid) return done();
      killProcessGroup(pid, { timeoutMs: KILL_GRACE_MS }).then(done, () => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        done();
      });
    };

    const collect = (chunks: Buffer[], stream: "out" | "err") => (chunk: Buffer) => {
      const used = stream === "out" ? outBytes : errBytes;
      const room = MAX_OUTPUT_BYTES - used;
      if (room > 0) chunks.push(room >= chunk.length ? chunk : chunk.subarray(0, room));
      const next = used + chunk.length;
      if (stream === "out") outBytes = next;
      else errBytes = next;
      if (next > MAX_OUTPUT_BYTES) kill("cap");
    };

    function onAbort(): void {
      kill("abort");
    }

    child.stdout?.on("data", collect(out, "out"));
    child.stderr?.on("data", collect(err, "err"));
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code));
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    const t = opts?.timeoutMs;
    if (typeof t === "number" && Number.isFinite(t) && t > 0) timer = setTimeout(() => kill("timeout"), t);
  });
}

/** Build a facade. Defaults: the process-wide dashboard registry and the windowsHide spawn wrapper. */
export function createFlowTools(deps: FlowToolsDeps = {}): FlowTools {
  const registry = deps.registry ?? getDefaultRegistry;
  const spawnFn = deps.spawn ?? defaultSpawn;

  const argvFor = (name: string): string[] => {
    try {
      const reg = registry();
      if (!reg.has(name)) return [];
      const exec = reg.resolveExecutor(name);
      return exec.ok ? exec.argv : [];
    } catch {
      return [];
    }
  };

  return {
    has(name) {
      try {
        return registry().has(name);
      } catch {
        return false;
      }
    },
    resolve(name) {
      try {
        const reg = registry();
        if (!reg.has(name)) return null;
        const r = reg.resolve(name);
        return r.ok && typeof r.path === "string" && isAbsolutePath(r.path) ? r.path : null;
      } catch {
        return null;
      }
    },
    async run(name, args = [], opts) {
      if (opts?.signal?.aborted) return fail(130, "aborted before start");
      const argv = argvFor(name);
      if (!argv.length) return fail(127, `${name}: not registered or not resolved`);
      return execArgv(argv, args, opts, spawnFn, false);
    },
    async shell(script, opts) {
      if (opts?.signal?.aborted) return fail(130, "aborted before start");
      const argv = argvFor("bash");
      if (!argv.length) return fail(127, "bash: not registered or not resolved");
      // Inherited BASH_ENV/ENV are dropped from the base; an explicit opts.env value is merged back on top.
      return execArgv(argv, ["--noprofile", "--norc", "-c", script], opts, spawnFn, true);
    },
  };
}

/**
 * Publish the facade on the process-global slot. Builds the registry eagerly so
 * a broken registry leaves the slot as it was. Never throws.
 */
export function publishFlowTools(): void {
  try {
    const reg = getDefaultRegistry();
    (globalThis as unknown as Record<symbol, FlowTools>)[SLOT] = createFlowTools({ registry: () => reg });
  } catch {
    /* registry unavailable — handlers take their own fallback path */
  }
}

/** Remove the facade (session_shutdown). Idempotent, never throws. */
export function clearFlowTools(): void {
  try {
    delete (globalThis as unknown as Record<symbol, FlowTools | undefined>)[SLOT];
  } catch {
    /* nothing to clear */
  }
}
