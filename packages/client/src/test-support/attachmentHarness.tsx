/**
 * Test harness for attachment resolution: provides `openspecMap` through
 * `OpenSpecMapContext` and stubs `GET /api/openspec-archive` per cwd.
 * See change: resolve-archived-attached-proposal.
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import type { OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { vi } from "vitest";
import { __resetArchiveCache } from "../lib/openspec/archive-cache.js";
import { OpenSpecMapContext } from "../lib/openspec/OpenSpecMapContext.js";

export const archiveEntry = (name: string, ids: string[] = ["proposal", "design", "tasks"]): ArchiveEntry => ({
  name,
  date: name.slice(0, 10),
  artifacts: ids.map((id) => ({ id, status: "done" as const })),
});

export const knownData = (...changes: OpenSpecChange[]): OpenSpecData => ({ initialized: true, changes });

export const absentData = (): OpenSpecData =>
  ({ initialized: false, pending: false, changes: [], readiness: { state: "ABSENT" } }) as OpenSpecData;

export const makeChange = (name: string, ids: string[] = ["proposal", "design"]): OpenSpecChange => ({
  name,
  status: "in-progress",
  completedTasks: 0,
  totalTasks: 0,
  artifacts: ids.map((id) => ({ id, status: "done" as const })),
});

/** Reset the cache and stub fetch. `archives[cwd] === "error"` → HTTP-level failure. */
export function stubArchiveApi(archives: Record<string, ArchiveEntry[] | "error">): ReturnType<typeof vi.fn> {
  __resetArchiveCache();
  const fn = vi.fn((url: string) => {
    const cwd = decodeURIComponent(new URL(url, "http://x").searchParams.get("cwd") ?? "");
    const a = archives[cwd] ?? [];
    const body = a === "error" ? { success: false, error: "boom" } : { success: true, data: a };
    return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function withOpenSpecMap(map: Record<string, OpenSpecData>, ui: React.ReactElement): React.ReactElement {
  return <OpenSpecMapContext.Provider value={new Map(Object.entries(map))}>{ui}</OpenSpecMapContext.Provider>;
}
