/**
 * REST routes for `packages[]` health: classify entries and drop a
 * user-selected set. The server never decides what to remove — `drop` is an
 * explicit list of verbatim `packages[]` sources.
 *
 * Cleanup runs under the package-manager busy-lock (serialised with
 * install/remove), validates before touching disk (fail closed: any unknown
 * source → 400, no backup, no write), backs up the full file, rewrites
 * atomically, then drops cached package managers so a later install/remove
 * cannot write a stale `packages[]` back.
 *
 * See change: add-package-health-cleanup.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  PackageCleanupRequest,
  PackageCleanupResponse,
  PackageHealthListResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { atomicWriteJson } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { scanPackageHealth } from "../package/package-health-scanner.js";
import type { PackageManagerWrapper } from "../package/package-manager-wrapper.js";
import { PackageOperationBusyError } from "../package/package-manager-wrapper.js";

/** Verbatim source of a `packages[]` entry (string, or object `.source`). */
function entrySource(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const src = (entry as Record<string, unknown>).source;
    if (typeof src === "string") return src;
  }
  return null;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

class CleanupInputError extends Error {
  readonly unknown?: string[];

  constructor(
    message: string,
    unknown?: string[],
  ) {
    super(message);
    this.unknown = unknown;
  }
}

export function registerPackageHealthRoutes(
  fastify: FastifyInstance,
  deps: {
    packageManagerWrapper: Pick<PackageManagerWrapper, "listInstalled" | "runExclusive" | "invalidateAllPackageManagers">;
    /** Defaults to `~/.pi/agent/settings.json` (the file pi's global scope reads). */
    settingsPath?: string;
    now?: () => Date;
  },
) {
  const { packageManagerWrapper } = deps;
  const settingsPath = deps.settingsPath ?? path.join(os.homedir(), ".pi", "agent", "settings.json");
  const now = deps.now ?? (() => new Date());

  fastify.get("/api/packages/health", async () => {
    try {
      const rows = await packageManagerWrapper.listInstalled("global");
      return { success: true, data: scanPackageHealth(rows) } satisfies PackageHealthListResponse;
    } catch (err) {
      return { success: false, error: errorMessage(err) } satisfies ApiResponse;
    }
  });

  fastify.post<{ Body: Partial<PackageCleanupRequest> | undefined }>("/api/packages/cleanup", async (request, reply) => {
    const drop = request.body?.drop;
    if (!Array.isArray(drop) || !drop.every((s) => typeof s === "string")) {
      reply.code(400);
      return { success: false, error: "drop must be an array of source strings" } satisfies ApiResponse;
    }
    try {
      const data = await packageManagerWrapper.runExclusive(async () => cleanupSettings(settingsPath, drop, now()));
      if (data.dropped.length > 0) packageManagerWrapper.invalidateAllPackageManagers();
      return { success: true, data } satisfies ApiResponse<PackageCleanupResponse>;
    } catch (err) {
      if (err instanceof PackageOperationBusyError) {
        reply.code(409);
        return { success: false, error: err.message } satisfies ApiResponse;
      }
      if (err instanceof CleanupInputError) {
        reply.code(400);
        return { success: false, error: err.message, unknown: err.unknown };
      }
      reply.code(500);
      return { success: false, error: errorMessage(err) } satisfies ApiResponse;
    }
  });
}

/** Validate → backup → atomic rewrite. Throws before any write on invalid input. */
function cleanupSettings(settingsPath: string, drop: string[], ts: Date): PackageCleanupResponse {
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(settingsPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  let settings: Record<string, unknown> = {};
  if (raw?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Refusing to rewrite ${settingsPath}: it is not valid JSON`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Refusing to rewrite ${settingsPath}: top level is not an object`);
    }
    settings = parsed as Record<string, unknown>;
  }

  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const known = new Set(packages.map(entrySource).filter((s): s is string => s !== null));
  const dropSet = new Set(drop);
  const unknown = [...dropSet].filter((s) => !known.has(s));
  if (unknown.length > 0) throw new CleanupInputError(`Unknown package sources: ${unknown.join(", ")}`, unknown);

  if (dropSet.size === 0) return { before: packages.length, after: packages.length, dropped: [], backupPath: "" };

  // ISO timestamp, ':' and '.' → '-' so the name is valid on Windows too.
  const backupPath = `${settingsPath}.${ts.toISOString().replace(/[:.]/g, "-")}.bak`;
  fs.copyFileSync(settingsPath, backupPath, fs.constants.COPYFILE_EXCL);

  const next = packages.filter((e) => {
    const src = entrySource(e);
    return src === null || !dropSet.has(src);
  });
  atomicWriteJson(settingsPath, { ...settings, packages: next });
  return { before: packages.length, after: next.length, dropped: [...dropSet], backupPath };
}
