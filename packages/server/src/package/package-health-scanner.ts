/**
 * Classify every `packages[]` entry in pi's settings.json by health:
 * `ok` | `stale-npm` | `missing-path` | `duplicate`.
 *
 * `scanPackageHealth` is pure over injected fs deps (rows come from
 * `packageManagerWrapper.listInstalled()`, which already resolves
 * `installedPath`). Duplicates group by `package.json#name` — NOT by
 * `computeIdentity`, which sees the same extension under four different
 * roots as four identities. An existing dir without a readable
 * `package.json` stays `ok`: pi sources may be plain convention dirs, and
 * we must never suggest dropping a live path.
 *
 * `logPackageHealthAtBoot` is log-only (never mutates, never throws).
 *
 * See change: add-package-health-cleanup.
 */
import fs from "node:fs";
import type {
  PackageHealthDuplicateGroup,
  PackageHealthListResponseData,
  PackageHealthReport,
  PackageHealthSummary,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { readPackageJsonMeta, readPackageJsonName } from "./installed-package-enricher.js";
import { parseSourceKind } from "./package-source-helpers.js";

/** Minimal row shape the scanner needs (a subset of `RawInstalledRow`). */
export interface HealthInputRow {
  source: string;
  installedPath?: string;
}

/** Injectable IO so the classifier is unit-testable without a filesystem. */
export interface PackageHealthDeps {
  existsSync: (p: string) => boolean;
  readMeta: (dir: string) => { name?: string; version?: string };
  statMtime: (dir: string) => string | undefined;
}

const defaultDeps: PackageHealthDeps = {
  existsSync: fs.existsSync,
  readMeta: (dir) => ({ name: readPackageJsonName(dir), version: readPackageJsonMeta(dir).version }),
  statMtime: (dir) => {
    try {
      return fs.statSync(dir).mtime.toISOString();
    } catch {
      return undefined;
    }
  },
};

export function scanPackageHealth(
  rows: readonly HealthInputRow[],
  deps: PackageHealthDeps = defaultDeps,
): PackageHealthListResponseData {
  const entries: PackageHealthReport[] = rows.map((row) => {
    const dir = row.installedPath;
    if (!dir || !deps.existsSync(dir)) {
      return parseSourceKind(row.source) === "npm"
        ? { source: row.source, status: "stale-npm", reason: "npm package is no longer installed" }
        : { source: row.source, status: "missing-path", reason: "install path does not exist" };
    }
    const meta = deps.readMeta(dir);
    return {
      source: row.source,
      status: "ok",
      resolvedPath: dir,
      packageName: meta.name,
      version: meta.version,
      mtime: deps.statMtime(dir),
    };
  });

  // Group live entries by lowercased package.json#name; ≥2 members → duplicate.
  const byName = new Map<string, PackageHealthReport[]>();
  for (const e of entries) {
    if (e.status !== "ok" || !e.packageName) continue;
    const key = e.packageName.toLowerCase();
    const list = byName.get(key);
    if (list) list.push(e);
    else byName.set(key, [e]);
  }
  const duplicateGroups: PackageHealthDuplicateGroup[] = [];
  for (const [key, members] of byName) {
    if (members.length < 2) continue;
    const id = `dup:${key}`;
    for (const m of members) {
      m.status = "duplicate";
      m.duplicateGroupId = id;
      m.reason = `same package.json name as ${members.length - 1} other entr${members.length === 2 ? "y" : "ies"}`;
    }
    duplicateGroups.push({ id, packageName: members[0].packageName as string, count: members.length });
  }

  const count = (s: PackageHealthReport["status"]) => entries.filter((e) => e.status === s).length;
  return {
    entries,
    summary: { ok: count("ok"), staleNpm: count("stale-npm"), missingPath: count("missing-path"), duplicateGroups },
  };
}

/** True when any entry is non-ok. */
export function hasHealthIssues(summary: PackageHealthSummary): boolean {
  return summary.staleNpm > 0 || summary.missingPath > 0 || summary.duplicateGroups.length > 0;
}

/** Single greppable boot line. See design Decision 4. */
export function formatHealthSummaryLine(total: number, s: PackageHealthSummary): string {
  const dup = s.duplicateGroups.map((g) => `${g.packageName} ×${g.count}`).join(", ");
  return (
    `[package-health] ${total} entries: ${s.ok} ok, ${s.staleNpm} stale-npm, ${s.missingPath} missing-path, ` +
    `${s.duplicateGroups.length} duplicate-group${dup ? ` (${dup})` : ""}`
  );
}

/**
 * Boot-time, log-only scan. Silent when clean. Never throws and never
 * mutates settings — a scanner bug must not fail boot.
 */
export async function logPackageHealthAtBoot(opts: {
  listInstalled: () => HealthInputRow[] | Promise<HealthInputRow[]>;
  deps?: PackageHealthDeps;
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<void> {
  const log = opts.log ?? console;
  try {
    const rows = await opts.listInstalled();
    const { summary } = scanPackageHealth(rows, opts.deps);
    if (hasHealthIssues(summary)) log.info(formatHealthSummaryLine(rows.length, summary));
  } catch (err) {
    log.warn(`[package-health] scan failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}
