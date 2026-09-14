/**
 * mcp-client-plugin · default adapter port.
 *
 * The adapter's `loadMcpConfig` / `getServerProvenance` are SYNCHRONOUS, so a
 * stalled read would block the dashboard event loop and no in-thread timeout
 * can interrupt it. This port runs them in one lazily-spawned `worker_threads`
 * Worker per port instance, serialised; on deadline expiry it terminates the
 * worker and rejects with {@link AdapterTimeoutError}; the next load respawns.
 * The pure path helpers (and every write-only operation) never touch the worker.
 *
 * See change: extract-mcp-client-plugin (design D10).
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  getConfigDiscoveryPaths,
  getPiGlobalConfigPath,
  getProjectPiConfigPath,
} from "pi-mcp-adapter/config";
import type { AdapterPort, ConfigDiscoveryPath, LoadOptions, McpConfig, ServerProvenance } from "./types.js";

export class AdapterTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`adapter load did not complete within ${timeoutMs}ms`);
    this.name = "AdapterTimeoutError";
  }
}

export interface WorkerAdapterPortOptions {
  /** Worker entry module. Defaults to `./adapter-worker-entry.mjs` beside this file. */
  workerEntryUrl?: URL | string;
  /** Absolute URL/path of `pi-mcp-adapter/config`, passed to the worker. */
  adapterUrl?: string;
  /** Factory injection for tests. */
  workerFactory?: (url: URL | string, workerData: unknown) => Worker;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const require = createRequire(import.meta.url);

function defaultAdapterUrl(): string {
  return pathToFileURL(require.resolve("pi-mcp-adapter/config")).href;
}

function defaultWorkerEntry(): URL {
  return new URL("./adapter-worker-entry.mjs", import.meta.url);
}

export function createDefaultAdapterPort(opts: WorkerAdapterPortOptions = {}): AdapterPort {
  const workerEntry = opts.workerEntryUrl ?? defaultWorkerEntry();
  const adapterUrl = opts.adapterUrl ?? defaultAdapterUrl();
  const makeWorker =
    opts.workerFactory ?? ((url: URL | string, workerData: unknown) => new Worker(url, { workerData }));

  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function rejectAll(err: Error): void {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    const w = makeWorker(workerEntry, { adapterUrl });
    w.unref?.();
    w.on("message", (msg: { id: number; result?: unknown; error?: { message: string } }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
    w.on("error", (err) => {
      worker = null;
      rejectAll(err instanceof Error ? err : new Error(String(err)));
    });
    w.on("exit", () => {
      if (worker === w) worker = null;
      // A terminated worker rejects its in-flight call via the timeout path.
    });
    worker = w;
    return w;
  }

  function call<T>(method: string, args: unknown[], timeoutMs: number): Promise<T> {
    const w = ensureWorker();
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        // The stalled load cannot be interrupted in-thread; terminate + respawn.
        worker = null;
        void w.terminate();
        reject(new AdapterTimeoutError(timeoutMs));
      }, timeoutMs);
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      w.postMessage({ id, method, args });
    });
  }

  return {
    loadMcpConfig(overridePath: string | undefined, cwd: string, o: LoadOptions): Promise<McpConfig> {
      return call<McpConfig>("loadMcpConfig", [overridePath, cwd], o.timeoutMs);
    },
    getServerProvenance(
      overridePath: string | undefined,
      cwd: string,
      o: LoadOptions,
    ): Promise<Map<string, ServerProvenance>> {
      return call<Map<string, ServerProvenance>>("getServerProvenance", [overridePath, cwd], o.timeoutMs);
    },
    getConfigDiscoveryPaths(overridePath: string | undefined, cwd: string): ConfigDiscoveryPath[] {
      return getConfigDiscoveryPaths(overridePath, cwd);
    },
    getPiGlobalConfigPath(): string {
      return getPiGlobalConfigPath();
    },
    getProjectPiConfigPath(cwd: string): string {
      return getProjectPiConfigPath(cwd);
    },
  };
}
