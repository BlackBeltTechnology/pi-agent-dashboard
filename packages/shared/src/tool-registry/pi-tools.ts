/**
 * Skill-package tool manifest ingestion (design D1).
 *
 * A skill package MAY declare an additive `pi.tools` array in its
 * package.json (sibling to `pi.skills`). The manifest carries ONLY
 * `{ id, probe, optional? }` — no shell strings, no recipes. Install
 * recipes stay first-party in the registry's `installHints` for that id.
 *
 * `parseSkillTools` validates strictly (exact key set, tool-id charset,
 * known probe kinds) and names every rejected entry. `ingestSkillTools`
 * ingests into a `ToolRegistry`: an id that already has a registered
 * definition is REFERENCED (never clobbered); anything else is
 * synthesized as a probe-kind def. Unmanifested skills are untouched.
 *
 * See change: add-skill-tool-provisioning.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  dockerImageProbeStrategy,
  envProbeStrategy,
  pwBrowserProbeStrategy,
  type StrategyDeps,
  whereStrategy,
} from "./strategies.js";
import {
  SKILL_TOOL_ENTRY_KEYS,
  SKILL_TOOL_ID_PATTERN,
  type SkillToolManifestEntry,
  type ToolDefinition,
} from "./types.js";
import type { ToolRegistry } from "./registry.js";

/** Probe kinds a manifest entry may declare. */
const PROBE_KINDS = ["resolve", "env", "docker-image", "pw-browser"] as const;

export type ParseSkillToolsResult =
  | { ok: true; tools: SkillToolManifestEntry[] }
  | { ok: false; errors: string[] };

/** Defaults applied to optional manifest fields. */
const DEFAULT_PROBE = "resolve" as const;

/**
 * Validate the `pi` object of a package.json (pass the whole `pi` value —
 * `undefined` safe). Returns the normalized entries or one error per
 * rejected entry, each naming the offender.
 */
export function parseSkillTools(pi: unknown): ParseSkillToolsResult {
  const tools = (pi as { tools?: unknown } | null | undefined)?.tools;
  if (tools === undefined) return { ok: true, tools: [] };
  if (!Array.isArray(tools)) {
    return { ok: false, errors: ["pi.tools must be an array"] };
  }
  const errors: string[] = [];
  const parsed: SkillToolManifestEntry[] = [];
  for (const entry of tools) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`pi.tools entry ${JSON.stringify(entry)} must be an object`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const label = typeof id === "string" ? id : JSON.stringify(entry);
    const keys = Object.keys(record);
    const extra = keys.filter((k) => !(SKILL_TOOL_ENTRY_KEYS as readonly string[]).includes(k));
    if (extra.length > 0) {
      errors.push(
        `pi.tools entry "${label}" carries forbidden key(s) ${extra.join(", ")} — the manifest carries only { id, probe, optional }; install recipes stay first-party in the registry`,
      );
      continue;
    }
    if (typeof id !== "string" || !SKILL_TOOL_ID_PATTERN.test(id)) {
      errors.push(
        `pi.tools entry ${label} has an invalid id — must match ${SKILL_TOOL_ID_PATTERN}`,
      );
      continue;
    }
    const probe = record.probe ?? DEFAULT_PROBE;
    if (typeof probe !== "string" || !(PROBE_KINDS as readonly string[]).includes(probe)) {
      errors.push(
        `pi.tools entry "${id}" has an unknown probe kind ${JSON.stringify(probe)} — expected one of ${PROBE_KINDS.join(", ")}`,
      );
      continue;
    }
    const optional = record.optional ?? false;
    if (typeof optional !== "boolean") {
      errors.push(`pi.tools entry "${id}" has a non-boolean optional`);
      continue;
    }
    parsed.push({ id, probe: probe as SkillToolManifestEntry["probe"], optional });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tools: parsed };
}

/** One row of {@link ingestSkillTools}'s result. */
export interface IngestionRecord {
  id: string;
  probe: SkillToolManifestEntry["probe"];
  optional: boolean;
  /** True when the registry had no definition for the id and one was synthesized. */
  synthesized: boolean;
}

/** Build the synthesized definition for an unregistered manifest id. */
function synthesizeDef(entry: SkillToolManifestEntry, deps?: StrategyDeps): ToolDefinition {
  switch (entry.probe) {
    case "env":
      return {
        name: entry.id,
        kind: "probe",
        strategies: [envProbeStrategy(entry.id, deps)],
      };
    case "docker-image":
      return {
        name: entry.id,
        kind: "probe",
        strategies: [dockerImageProbeStrategy(entry.id, deps)],
      };
    case "pw-browser":
      return {
        name: entry.id,
        kind: "probe",
        strategies: [pwBrowserProbeStrategy(entry.id, deps)],
      };
    case "resolve":
      return {
        name: entry.id,
        kind: "binary",
        strategies: [whereStrategy(entry.id, deps)],
      };
  }
}

/**
 * Ingest validated manifest entries into the registry. Idempotent: an id
 * that already has a definition is referenced as-is (no re-registration,
 * no cache invalidation); only unregistered ids are synthesized.
 */
export function ingestSkillTools(
  registry: ToolRegistry,
  tools: readonly SkillToolManifestEntry[],
  deps?: StrategyDeps,
): IngestionRecord[] {
  const records: IngestionRecord[] = [];
  for (const entry of tools) {
    const synthesized = !registry.has(entry.id);
    if (synthesized) {
      registry.register(synthesizeDef(entry, deps));
    }
    records.push({
      id: entry.id,
      probe: entry.probe,
      optional: entry.optional ?? false,
      synthesized,
    });
  }
  return records;
}

/** One discovered manifest: the package dir it came from + its `pi` object. */
export interface DiscoveredSkillManifest {
  pkgDir: string;
  pi: unknown;
}

const SCAN_SCOPES = ["node_modules", "packages"] as const;
const SCAN_SCOPE_PKG = "@blackbelt-technology" as const;

/**
 * Best-effort scan for installed pi-dashboard packages carrying `pi.tools`.
 * Looks under `<root>/node_modules/@blackbelt-technology/<pkg>/package.json`
 * (installed tree) and `<root>/packages/<pkg>/package.json` (monorepo dev).
 * Unreadable files are skipped — a doc bug must never break startup.
 */
export function discoverSkillManifests(root: string): DiscoveredSkillManifest[] {
  const found: DiscoveredSkillManifest[] = [];
  for (const scope of SCAN_SCOPES) {
    const scopeDir = path.join(root, scope);
    let entries: string[] = [];
    try {
      entries =
        scope === "node_modules"
          ? readdirSync(path.join(scopeDir, SCAN_SCOPE_PKG))
          : readdirSync(scopeDir);
    } catch {
      continue; // scope absent — fine
    }
    const base = scope === "node_modules" ? path.join(scopeDir, SCAN_SCOPE_PKG) : scopeDir;
    for (const entry of entries) {
      const pkgDir = path.join(base, entry);
      try {
        const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
          pi?: unknown;
        };
        if (pkg.pi && typeof pkg.pi === "object" && (pkg.pi as { tools?: unknown }).tools) {
          found.push({ pkgDir, pi: pkg.pi });
        }
      } catch {
        // no package.json / unreadable — skip
      }
    }
  }
  return found;
}

export interface IngestInstalledOptions {
  /** Scan root. Default: process.cwd(). */
  root?: string;
  /** Pre-discovered manifests (tests); skips the fs scan when given. */
  manifests?: readonly DiscoveredSkillManifest[];
}

/**
 * Ingest `pi.tools` from every installed pi-dashboard package into the
 * registry — the doctor/Phase-3 wiring that makes a skill tool IS a
 * registry tool. Invalid manifests are skipped (a doc bug, never a host
 * mutation). Returns the ingestion records.
 *
 * See change: add-skill-tool-provisioning (design D1, task 6.2).
 */
export function ingestInstalledSkillTools(
  registry: ToolRegistry,
  opts: IngestInstalledOptions = {},
): IngestionRecord[] {
  const manifests = opts.manifests ?? discoverSkillManifests(opts.root ?? process.cwd());
  const records: IngestionRecord[] = [];
  for (const { pi } of manifests) {
    const parsed = parseSkillTools(pi);
    if (parsed.ok) {
      records.push(...ingestSkillTools(registry, parsed.tools));
    }
  }
  return records;
}

/**
 * Install-tree root containing the scannable package manifests, derived
 * from a file inside the server package. Layout-aware:
 * - monorepo / docker / Electron: `<repo>/packages/server/src/cli.ts` →
 *   `<repo>` (scans `<repo>/packages` + `<repo>/node_modules`);
 * - standalone `npm i -g`: `<prefix>/node_modules/@blackbelt-technology/
 *   pi-dashboard-server/src/cli.ts` → `<prefix>`.
 *
 * Exposed + unit-tested because the two layouts need different up-counts.
 * See change: add-skill-tool-provisioning (review round 2).
 */
export function resolveInstallRoot(serverFilePath: string): string {
  const pkgRoot = path.resolve(serverFilePath, "../..");
  const parent = path.dirname(pkgRoot);
  const grandparent = path.dirname(parent);
  const inNpmInstall =
    path.basename(parent) === "@blackbelt-technology" &&
    path.basename(grandparent) === "node_modules";
  // monorepo: <repo>/packages/server → <repo>; npm: …/@blackbelt-technology/
  // <pkg> → <prefix> (pkg → scope → node_modules → prefix).
  return inNpmInstall ? path.resolve(pkgRoot, "../../..") : path.resolve(pkgRoot, "../..");
}
