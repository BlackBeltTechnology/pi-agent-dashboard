import type { ChildProcess } from "node:child_process"; // ban:child_process-ok — types only
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNodeScript } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";
import { killPidWithGroup } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

export interface NestedRunRequest {
  runId: string;
  cwd: string;
  prompt: string;
  model?: unknown;
  thinkingLevel?: string;
  tools?: string[];
}

export interface NestedRunEvent {
  runId: string;
  type: "event" | "result" | "error";
  event?: unknown;
  result?: string;
  error?: string;
}

export interface NestedRunResult {
  runId: string;
  status: "completed" | "aborted" | "forced" | "error";
  result?: string;
  error?: string;
}

export interface NestedProcessSupervisorOptions {
  cooperativeGraceMs?: number;
  killGraceMs?: number;
  idleTimeoutMs?: number;
  spawn?: () => ChildProcess;
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
}

export interface NestedRunOptions {
  signal?: AbortSignal;
  onEvent?: (event: NestedRunEvent) => void;
}

const COOPERATIVE_GRACE_MS = 2_000;
const KILL_GRACE_MS = 1_000;
const IDLE_TIMEOUT_MS = 90_000;

/** One-process-per-run supervisor for independently stoppable nested tools. */
export class NestedProcessSupervisor {
  private readonly cooperativeGraceMs: number;
  private readonly killGraceMs: number;
  private readonly idleTimeoutMs: number;
  private readonly spawn: () => ChildProcess;
  private readonly killGroup: (pid: number, signal: NodeJS.Signals) => void;

  constructor(options: NestedProcessSupervisorOptions = {}) {
    this.cooperativeGraceMs = options.cooperativeGraceMs ?? COOPERATIVE_GRACE_MS;
    this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.spawn = options.spawn ?? spawnWorker;
    this.killGroup = options.killGroup ?? ((pid, signal) => killPidWithGroup(pid, signal));
  }

  run(request: NestedRunRequest, options: NestedRunOptions = {}): Promise<NestedRunResult> {
    const child = this.spawn();
    return new Promise((resolveRun) => {
      let settled = false;
      let abortRequested = false;
      let timedOut = false;
      let termSent = false;
      let cooperativeTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (cooperativeTimer) clearTimeout(cooperativeTimer);
        if (killTimer) clearTimeout(killTimer);
        if (idleTimer) clearTimeout(idleTimer);
        options.signal?.removeEventListener("abort", onAbort);
        child.removeAllListeners("message");
        child.removeAllListeners("error");
        child.removeAllListeners("exit");
      };
      const settle = (result: NestedRunResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveRun(result);
      };
      const signalChild = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          this.killGroup(child.pid, signal);
        } catch {
          settle({ runId: request.runId, status: "aborted" });
        }
      };
      const onAbort = () => {
        if (abortRequested || settled) return;
        abortRequested = true;
        child.send?.({ type: "abort", runId: request.runId });
        cooperativeTimer = setTimeout(() => {
          termSent = true;
          signalChild("SIGTERM");
          killTimer = setTimeout(() => {
            signalChild("SIGKILL");
            settle({
              runId: request.runId,
              status: timedOut ? "error" : "forced",
              error: timedOut ? "Nested run timed out without progress." : "Nested run required SIGKILL",
            });
          }, this.killGraceMs);
        }, this.cooperativeGraceMs);
      };
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled || abortRequested) return;
          timedOut = true;
          onAbort();
        }, this.idleTimeoutMs);
      };

      child.on("message", (message: NestedRunEvent) => {
        if (settled || message.runId !== request.runId) return;
        if (message.type === "event") {
          resetIdleTimer();
          options.onEvent?.(message);
          return;
        }
        if (message.type === "result") {
          settle({
            runId: request.runId,
            status: abortRequested ? "aborted" : "completed",
            result: message.result,
          });
          return;
        }
        settle({ runId: request.runId, status: "error", error: message.error ?? "Nested run failed" });
      });
      child.once("error", (error) => {
        settle({ runId: request.runId, status: "error", error: error.message });
      });
      child.once("exit", (code) => {
        if (settled) return;
        if (abortRequested) {
          settle({
            runId: request.runId,
            status: timedOut ? "error" : termSent ? "forced" : "aborted",
            ...(timedOut
              ? { error: "Nested run timed out without progress." }
              : termSent
                ? { error: "Nested run terminated after abort grace" }
                : {}),
          });
          return;
        }
        settle({ runId: request.runId, status: "error", error: `Nested worker exited with code ${code}` });
      });

      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener("abort", onAbort, { once: true });
      resetIdleTimer();
      child.send?.({ type: "start", request });
    });
  }
}

function spawnWorker(): ChildProcess {
  const here = dirname(fileURLToPath(import.meta.url));
  return spawnNodeScript({
    entry: resolve(here, "nested-process-worker.mjs"),
    spawnOptions: {
      detached: true,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
      // Marker so a nested worker never re-registers dashboard nested tools and
      // therefore cannot spawn a grandchild worker for the same tool call.
      env: {
        ...process.env,
        PI_DASHBOARD_NESTED_WORKER: "1",
        PI_DASHBOARD_NESTED_PARENT_PID: String(process.pid),
      },
    },
  });
}
