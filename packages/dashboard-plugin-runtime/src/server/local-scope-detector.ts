/**
 * Local-scope plugin detection. For each active session cwd, project-scope pi packages
 * (`<cwd>/.pi/settings.json#packages[]`) that carry a plugin manifest are REPORTED as
 * `source: "local-detected"` rows (`enabled/loaded: false`) and NEVER loaded: no server entry,
 * bridge, client or slot. An id that already has a row gets a `shadowed` entry instead (one row
 * per id). Pure bookkeeping over the status store; the server decides when to rerun it.
 *
 * See change: decouple-plugins-from-core (task 5.9, design D15).
 */
import { listPiPackages } from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";
import { getPluginStatusStore, readPluginCandidate } from "./loader.js";

/** Absorbed error text of a local-detected row. */
export const LOCAL_SCOPE_ERROR =
  "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable.";

export interface LocalScopeDetectorDeps {
  /** Cwds of the currently active sessions (live read; an ended session must already be excluded). */
  listCwds: () => readonly string[];
  /** Test seam: project-scope package dirs of a cwd. Default `listPiPackages({ scope: "project", cwd })`. */
  listProjectPackageDirs?: (cwd: string) => readonly string[];
}

export interface LocalScopeDetector {
  /**
   * Recompute detection for the current cwd set and (re)apply it to the status store.
   * Idempotent. Returns `true` only when the detected set (id + package dir) changed since the
   * previous call, so the caller can broadcast one `plugins_changed`.
   */
  rerun(): boolean;
}

interface Detected {
  id: string;
  displayName: string;
  claims: number;
  packageDir: string;
}

function defaultListProjectPackageDirs(cwd: string): string[] {
  return listPiPackages({ scope: "project", cwd }).map((p) => p.packageDir);
}

/** Detected packages of one cwd; a manifest-less package is skipped silently (a manifest never makes it executable). */
function detectInCwd(cwd: string, listDirs: (cwd: string) => readonly string[], seen: Set<string>): Detected[] {
  let dirs: readonly string[];
  try {
    dirs = listDirs(cwd);
  } catch (e) {
    console.warn(`[plugin-loader] local-scope detection failed for ${cwd}: ${(e as Error).message}`);
    return [];
  }
  const out: Detected[] = [];
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    const candidate = readPluginCandidate(dir, "local-detected");
    if (!candidate) continue;
    seen.add(dir);
    out.push({
      id: candidate.manifest.id,
      displayName: candidate.manifest.displayName,
      claims: candidate.manifest.claims.length,
      packageDir: dir,
    });
  }
  return out;
}

/** Remove every earlier local-detected contribution (rows and `shadowed` entries). */
function stripLocalContributions(): void {
  const store = getPluginStatusStore();
  for (const row of store.listStored()) {
    if (row.source === "local-detected") {
      store.removeStatus(row.id);
    } else if (row.shadowed?.some((s) => s.source === "local-detected")) {
      const rest = row.shadowed.filter((s) => s.source !== "local-detected");
      const { shadowed: _drop, ...without } = row;
      store.setStatus(rest.length > 0 ? { ...without, shadowed: rest } : without);
    }
  }
}

/** An id with a row gets a `shadowed` entry; otherwise a `local-detected` row. */
function applyDetected(found: readonly Detected[]): void {
  const store = getPluginStatusStore();
  for (const d of found) {
    const existing = store.getStoredStatus(d.id);
    if (existing) {
      store.setStatus({
        ...existing,
        shadowed: [...(existing.shadowed ?? []), { source: "local-detected", packageDir: d.packageDir }],
      });
    } else {
      store.setStatus({
        id: d.id,
        displayName: d.displayName,
        enabled: false,
        loaded: false,
        error: LOCAL_SCOPE_ERROR,
        claims: d.claims,
        source: "local-detected",
      });
    }
  }
}

export function createLocalScopeDetector(deps: LocalScopeDetectorDeps): LocalScopeDetector {
  const listDirs = deps.listProjectPackageDirs ?? defaultListProjectPackageDirs;
  let previousKey: string | null = null;

  function detect(): Detected[] {
    const seen = new Set<string>();
    const out = [...new Set(deps.listCwds())].flatMap((cwd) => detectInCwd(cwd, listDirs, seen));
    return out.sort((a, b) => a.id.localeCompare(b.id) || a.packageDir.localeCompare(b.packageDir));
  }

  return {
    rerun() {
      const found = detect();
      stripLocalContributions();
      applyDetected(found);
      const key = JSON.stringify(found.map((d) => [d.id, d.packageDir]));
      const changed = previousKey !== null ? previousKey !== key : found.length > 0;
      previousKey = key;
      return changed;
    },
  };
}
