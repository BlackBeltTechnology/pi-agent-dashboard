/**
 * REST client + URL helpers for the skill atlas.
 * Folder routes use the runtime `./sdk` codec (`folderRouteHref`).
 * See change: add-skill-atlas-screen.
 */
import { folderRouteHref } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import type { SkillAtlasScope, SkillGraphResponse } from "../shared/types.js";

const GRAPH_URL = "/api/plugins/skill-atlas/graph";

export async function fetchSkillGraph(scope: SkillAtlasScope, cwd?: string, signal?: AbortSignal): Promise<SkillGraphResponse> {
  const q = new URLSearchParams({ scope });
  if (scope === "project" && cwd) q.set("cwd", cwd);
  const res = await fetch(`${GRAPH_URL}?${q.toString()}`, { signal });
  const type = res.headers?.get?.("content-type") ?? "application/json";
  if (!type.includes("json")) throw new Error(`http_${res.status}`);
  const body = (await res.json()) as { success?: boolean; data?: SkillGraphResponse; error?: string };
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? `http_${res.status}`);
  return body.data;
}

/** Probe the restricted resource-file read path before opening the viewer. */
export async function canOpenSkillFile(filePath: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/pi-resource-file?path=${encodeURIComponent(filePath)}`);
    return res.ok;
  } catch {
    return false;
  }
}

export function piResourceViewerUrl(filePath: string, title: string): string {
  const q = new URLSearchParams({ path: filePath, title });
  return `/pi-resource?${q.toString()}`;
}

/** Atlas URL; `sel` + `hops` preselect a skill (most-connected chips). */
export function atlasUrl(scope: SkillAtlasScope, cwd?: string, sel?: string, hops?: number): string {
  const base = scope === "project" && cwd ? folderRouteHref(cwd, "/atlas") : "/atlas";
  if (!sel) return base;
  const q = new URLSearchParams({ sel });
  if (hops) q.set("hops", String(hops));
  return `${base}?${q.toString()}`;
}
