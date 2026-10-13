/**
 * Map the host's resolved pi resources to skill-atlas inputs (no bodies yet).
 *
 * project scope = local skills (origin `project`) ∪ global skills (`global`) ∪
 * every package's skills (`package`); global scope = global skills ∪ packages
 * resolved from the global scope. Disabled skills are excluded (pi does not
 * load them). A local/global skill carrying `packageSource` (package row not
 * matched) counts as a package skill under that source. See change:
 * add-skill-atlas-screen (design D8).
 */
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { SkillAtlasScope, SkillOrigin } from "../shared/types.js";

/** Builder input minus the body (filled in after the fingerprint check). */
export interface SkillEntry {
  id: string;
  description: string;
  filePath: string;
  origin: SkillOrigin;
  pkg?: string;
}

function entry(r: PiResource, origin: SkillOrigin, pkg?: string): SkillEntry | null {
  if (r.enabled === false) return null;
  const packaged = pkg ?? r.packageSource;
  return {
    id: r.name,
    description: r.description ?? "",
    filePath: r.filePath,
    origin: packaged ? "package" : origin,
    ...(packaged ? { pkg: packaged } : {}),
  };
}

export function skillEntries(result: PiResourcesResult, scope: SkillAtlasScope): SkillEntry[] {
  const out: Array<SkillEntry | null> = [];
  if (scope === "project") for (const r of result.local?.skills ?? []) out.push(entry(r, "project"));
  for (const r of result.global?.skills ?? []) out.push(entry(r, "global"));
  for (const p of result.packages ?? []) {
    if (scope === "global" && p.scope === "local") continue;
    for (const r of p.resources?.skills ?? []) out.push(entry(r, "package", p.name));
  }
  return out.filter((e): e is SkillEntry => e !== null);
}
