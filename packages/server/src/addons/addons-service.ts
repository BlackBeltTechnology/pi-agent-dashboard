/**
 * Add-ons feature catalog + combined feature toggle, I/O side.
 *
 * `gatherCatalog` collects the joiner inputs (installed global packages with
 * entry state, discovered plugins, managed bridges, recommended links) and runs
 * the pure `buildAddonCatalog`. `planToggle` computes the report of a toggle
 * (cascade, filtered/restored entries, keptOn, requiredBy, restoreSkipped,
 * stillLoadedIn) without writing; `applyToggle` performs it with compensation.
 * The route (`routes/addons-routes.ts`) owns HTTP + locks.
 *
 * See change: addons-hub-feature-catalog (design D4–D13).
 */
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  discoverPlugins,
  getPluginStatusStore,
  resolvePluginEnabled,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { AdmitCwdOptions } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  listManagedBridges,
  listManagedPackageOwnership,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import type {
  AddonFeature,
  AddonKeptOn,
  AddonRestoreSkipped,
  AddonStillLoadedIn,
  AddonToggleResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { attachPublishedVariants, enrichInstalledRows } from "../package/installed-package-enricher.js";
import type { PackageManagerWrapper } from "../package/package-manager-wrapper.js";
import { packageIdentity } from "../pi/resource-origin.js";
import type { TrustGateResult } from "../pi/resource-toggle-trust.js";
import { readRawConfig, type setPluginsEnabled as SetPluginsEnabledFn } from "../routes/plugin-activation-routes.js";
import {
  deleteRestore,
  gcRestore,
  getRestore,
  type RestoreRecord,
  type RestoreStore,
  setRestore,
  writeRestoreStore,
} from "./addon-toggle-restore.js";
import {
  buildAddonCatalog,
  type CatalogInputs,
  type CatalogPackageInput,
  type CatalogPluginInput,
  orphanManagedSources,
  pluginsRequiringPart,
} from "./addons-catalog.js";
import { readPackageInfo } from "./package-contents.js";
import {
  entriesEqual,
  entryIndicesFor,
  entrySource,
  filteredEntry,
  isAllEmptyFilter,
  readSettingsFile,
  type SettingsRead,
  scanFolderIdentities,
  serializeSettings,
  writeSettingsText,
} from "./settings-entries.js";

export interface AddonsLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface AddonsDeps {
  packageManagerWrapper: Pick<PackageManagerWrapper, "listInstalled" | "runExclusive"> & {
    invalidateAllPackageManagers?: () => void;
  };
  broadcast: (msg: ServerToBrowserMessage) => void;
  repoRoot?: string;
  knownDirectories: () => string[];
  /** npm lookup for published-variant resolution (cached upstream). */
  lookupNpm?: (name: string) => Promise<{ version?: string } | null>;
  /** `~/.pi/agent`, resolved lazily so tests may override $HOME. */
  agentDir?: () => string;
  log: AddonsLogger;
  /** `setPluginsEnabled` of the plugin routes; injected so tests can fail it. */
  setPluginsEnabled: typeof SetPluginsEnabledFn;
  /** Test seam for the settings-file writer. */
  writeSettingsText?: (file: string, text: string) => void;
  /** Folder mode: cwds the shared `admitCwd` guard knows (sessions + pinned); defaults to `knownDirectories`. */
  knownCwds?: () => string[];
  /** Folder mode: `admitCwd` options (host `onIndeterminate` logger; test seams). */
  admitOptions?: AdmitCwdOptions;
  /** Folder toggle: project-trust gate; defaults to `resolveToggleTrust` against the real agent dir. */
  resolveTrust?: (cwd: string) => Promise<TrustGateResult>;
}

function agentDirOf(deps: Pick<AddonsDeps, "agentDir">): string {
  return deps.agentDir?.() ?? path.join(os.homedir(), ".pi", "agent");
}

export function settingsPathOf(deps: Pick<AddonsDeps, "agentDir">): string {
  return path.join(agentDirOf(deps), "settings.json");
}

/** Paths the dashboard recorded as its own bridges; unreadable registry → none. */
export function readManagedPaths(log: AddonsLogger): string[] {
  try {
    return [...new Set([...Object.values(listManagedBridges()), ...Object.keys(listManagedPackageOwnership())])];
  } catch (err) {
    log.warn(`[addons] could not read the dashboard bridge registry: ${(err as Error)?.message ?? err}`);
    return [];
  }
}

function gatherPlugins(deps: AddonsDeps): CatalogPluginInput[] {
  const config = readRawConfig();
  const configPlugins = (config.plugins as Record<string, unknown> | undefined) ?? {};
  const statusById = new Map(getPluginStatusStore().listAll().map((s) => [s.id, s] as const));
  return discoverPlugins(deps.repoRoot).map((p) => {
    const m = p.manifest;
    const status = statusById.get(m.id);
    return {
      id: m.id,
      displayName: m.displayName,
      packageName: p.packageName,
      ...(p.bridgeEntryPath ? { bridgeEntryPath: p.bridgeEntryPath } : {}),
      requiresPiExtensions: m.requires?.piExtensions ?? [],
      dependsOn: m.dependsOn ?? [],
      enabled: resolvePluginEnabled(configPlugins[m.id], m.defaultEnabled),
      loaded: status?.loaded ?? false,
      ...(status?.error ? { error: status.error } : {}),
      hasSettings: m.claims.some((c) => c.slot === "settings-section"),
      missingRequirements: status?.missingRequirements ?? [],
    };
  });
}

export interface Gathered {
  settingsPath: string;
  agentDir: string;
  settings: SettingsRead;
  inputs: CatalogInputs;
  features: AddonFeature[];
}

export async function gatherCatalog(deps: AddonsDeps, opts: { skipRegistry?: boolean } = {}): Promise<Gathered> {
  const agentDir = agentDirOf(deps);
  const settingsPath = settingsPathOf(deps);
  const settings = readSettingsFile(settingsPath);
  const rows = await deps.packageManagerWrapper.listInstalled("global");
  const enriched = enrichInstalledRows(rows as never, undefined, { managedPaths: readManagedPaths(deps.log) });
  // The toggle path never reads published variants; skip the registry lookup under its locks.
  await attachPublishedVariants(enriched, { lookupNpm: opts.skipRegistry ? undefined : deps.lookupNpm });

  const packages: CatalogPackageInput[] = enriched.map((row) => {
    const info = readPackageInfo(row.installedPath);
    const identity = packageIdentity(row.source, agentDir);
    const idx = settings.ok ? entryIndicesFor(settings.packages, identity, agentDir) : [];
    return {
      source: row.source,
      scope: row.scope,
      installedPath: row.installedPath,
      packageName: info.name,
      version: row.version,
      description: row.description,
      displayName: row.displayName,
      dashboardManaged: row.dashboardManaged,
      entryOff: settings.ok && idx.length > 0 && isAllEmptyFilter(settings.packages[idx[0]]),
      publishedVariantSource: row.publishedVariantSource,
      publishedVariantVersion: row.publishedVariantVersion,
      contents: info.contents,
    };
  });

  const inputs: CatalogInputs = {
    plugins: gatherPlugins(deps),
    packages,
    recommended: RECOMMENDED_EXTENSIONS.map((r) => ({ source: r.source, dashboardPlugin: r.dashboardPlugin })),
    baseDir: agentDir,
  };
  const orphans = orphanManagedSources(inputs);
  if (orphans.length > 0) {
    deps.log.warn(
      `[addons] ${orphans.length} dashboard-managed package row(s) match no discovered plugin bridge: ${orphans.join(", ")}`,
    );
  }
  return { settingsPath, agentDir, settings, inputs, features: buildAddonCatalog(inputs) };
}

/** Drop restore records whose package is no longer a global entry. Caller holds the settings lock. */
export function gcRestoreRecords(g: Gathered, log: AddonsLogger): void {
  if (!g.settings.ok) return;
  const live = new Set<string>();
  for (const e of g.settings.packages) {
    const src = entrySource(e);
    if (src) live.add(packageIdentity(src, g.agentDir));
  }
  gcRestore(g.settingsPath, live, log);
}

// ── Toggle planning ────────────────────────────────────────────────────────

type ReportBody = Omit<AddonToggleResponse, "success" | "dryRun" | "confirmToken" | "consistent">;

export interface PlanOk {
  ok: true;
  feature: AddonFeature;
  enabled: boolean;
  affected: AddonFeature[];
  pluginIds: string[];
  /** `packages[]` index → replacement entry. */
  edits: Array<{ index: number; next: unknown }>;
  recordsToSet: RestoreRecord[];
  recordsToDelete: Array<{ settingsPath: string; identity: string }>;
  report: ReportBody;
  token: string;
}

export interface PlanErr {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

function digestReport(featureId: string, enabled: boolean, report: ReportBody): string {
  return createHash("sha256").update(JSON.stringify({ featureId, enabled, report })).digest("hex").slice(0, 32);
}

export function planToggle(
  deps: AddonsDeps,
  g: Gathered,
  store: RestoreStore,
  featureId: string,
  enabled: boolean,
): PlanOk | PlanErr {
  const feature = g.features.find((f) => f.id === featureId);
  if (!feature) return { ok: false, status: 404, body: { success: false, error: `Feature "${featureId}" not found` } };
  if (feature.kind === "core") {
    return { ok: false, status: 400, body: { success: false, error: "core features cannot be toggled" } };
  }
  if (!g.settings.ok) {
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        reason: "settings-unparseable",
        error: `settings file cannot be parsed: ${g.settings.error}`,
      },
    };
  }
  const settings = g.settings;

  // Plugin cascade → affected features (requested first).
  let pluginIds: string[] = [];
  const affected: AddonFeature[] = [feature];
  const pluginId = feature.plugin?.id;
  if (pluginId) {
    const dry = deps.setPluginsEnabled(
      pluginId,
      enabled,
      { broadcast: deps.broadcast, repoRoot: deps.repoRoot },
      { dryRun: true },
    );
    if (!dry.ok) {
      return dry.status === 404
        ? { ok: false, status: 404, body: { success: false, error: dry.error } }
        : { ok: false, status: 409, body: { success: false, reason: "blockers", blockers: dry.blockers } };
    }
    pluginIds = dry.flips.map((f) => f.id);
    for (const id of pluginIds) {
      const f = g.features.find((x) => x.id === `plugin:${id}`);
      if (f && !affected.includes(f)) affected.push(f);
    }
  }

  const edits: PlanOk["edits"] = [];
  const recordsToSet: RestoreRecord[] = [];
  const recordsToDelete: PlanOk["recordsToDelete"] = [];
  const filtered: string[] = [];
  const restored: string[] = [];
  const keptOn: AddonKeptOn[] = [];
  const restoreSkipped: AddonRestoreSkipped[] = [];
  const filteredIdentities: Array<{ source: string; identity: string }> = [];
  const enabledOutside = g.inputs.plugins.filter((p) => p.enabled && !pluginIds.includes(p.id));

  for (const f of affected) {
    for (const part of f.packages) {
      const idxs = entryIndicesFor(settings.packages, part.identity, g.agentDir);
      if (idxs.length > 1) {
        return {
          ok: false,
          status: 409,
          body: {
            success: false,
            reason: "duplicate-entries",
            error: `more than one packages[] entry for ${part.source}`,
          },
        };
      }
      if (idxs.length === 0) continue;
      const index = idxs[0];
      const cur = settings.packages[index];
      const rec = getRestore(store, g.settingsPath, part.identity);

      if (!enabled) {
        if (pluginId) {
          const by = pluginsRequiringPart(enabledOutside, part).map((p) => `plugin:${p.id}`);
          if (by.length > 0) {
            keptOn.push({ source: part.source, by });
            continue;
          }
        }
        if (isAllEmptyFilter(cur)) continue; // already off — never overwrite a record
        const next = filteredEntry(cur);
        recordsToSet.push({ settingsPath: g.settingsPath, identity: part.identity, original: cur, filtered: next });
        edits.push({ index, next });
        filtered.push(part.source);
        filteredIdentities.push({ source: part.source, identity: part.identity });
      } else if (rec) {
        if (entriesEqual(cur, rec.filtered)) {
          edits.push({ index, next: rec.original });
          recordsToDelete.push({ settingsPath: g.settingsPath, identity: part.identity });
          restored.push(part.source);
        } else if (entriesEqual(cur, rec.original)) {
          recordsToDelete.push({ settingsPath: g.settingsPath, identity: part.identity });
          restored.push(part.source);
        } else {
          restoreSkipped.push({ source: part.source, reason: "edited" });
        }
      } else if (isAllEmptyFilter(cur)) {
        restoreSkipped.push({ source: part.source, reason: "no-record" });
      }
    }
  }

  const stillLoadedIn: AddonStillLoadedIn[] = [];
  if (!enabled && filteredIdentities.length > 0) {
    const scans = scanFolderIdentities(deps.knownDirectories());
    for (const { source, identity } of filteredIdentities) {
      const folders = scans.filter((s) => s.identities.has(identity)).map((s) => s.dir);
      if (folders.length > 0) stillLoadedIn.push({ source, folders });
    }
  }

  const report: ReportBody = {
    restartRequired: Boolean(pluginId) || filtered.length > 0 || restored.length > 0,
    cascaded: affected.slice(1).map((f) => f.id),
    filtered,
    restored,
    keptOn,
    requiredBy: !enabled && !pluginId ? feature.requiredBy : [],
    restoreSkipped,
    stillLoadedIn,
  };
  return {
    ok: true,
    feature,
    enabled,
    affected,
    pluginIds,
    edits,
    recordsToSet,
    recordsToDelete,
    report,
    token: digestReport(featureId, enabled, report),
  };
}

// ── Toggle application ─────────────────────────────────────────────────────

export interface ApplyResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Apply a plan. The caller holds the hub queue, `runExclusive`, the
 * settings-file lock and the plugin-config lock, and computed `plan` under them.
 *
 * Off: records → entries → plugin flip; a failure restores the settings file and
 * the records. On: plugin flip → entries → records; a failure puts the plugin
 * config back too. A compensating write that itself fails keeps the records and
 * answers 500 `consistent: false` (design D5).
 */
export function applyToggle(deps: AddonsDeps, g: Gathered, store: RestoreStore, plan: PlanOk): ApplyResult {
  if (!g.settings.ok) throw new Error("settings must be parseable here");
  const settings = g.settings;
  const write = deps.writeSettingsText ?? writeSettingsText;
  const { feature, enabled } = plan;
  const pluginId = feature.plugin?.id;
  const pluginDeps = { broadcast: deps.broadcast, repoRoot: deps.repoRoot };
  const rawBefore = settings.raw;
  const storeBefore = structuredClone(store);
  let settingsWritten = false;
  let rollbackPlugins: (() => void) | undefined;

  const writeEntries = () => {
    if (plan.edits.length === 0) return;
    const packages = [...settings.packages];
    for (const e of plan.edits) packages[e.index] = e.next;
    write(g.settingsPath, serializeSettings({ ...settings.json, packages }));
    settingsWritten = true;
  };
  const nextStore = structuredClone(store);
  for (const r of plan.recordsToSet) setRestore(nextStore, r);
  for (const r of plan.recordsToDelete) deleteRestore(nextStore, r.settingsPath, r.identity);
  const writeRecords = () => {
    if (JSON.stringify(nextStore) !== JSON.stringify(store)) writeRestoreStore(nextStore);
  };

  try {
    if (!enabled) {
      writeRecords();
      writeEntries();
      if (pluginId) {
        const res = deps.setPluginsEnabled(pluginId, false, pluginDeps);
        if (!res.ok) throw new Error(`plugin step refused (${res.status})`);
      }
    } else {
      if (pluginId) {
        const res = deps.setPluginsEnabled(pluginId, true, pluginDeps);
        if (!res.ok) {
          return res.status === 404
            ? { status: 404, body: { success: false, error: res.error } }
            : { status: 409, body: { success: false, reason: "blockers", blockers: res.blockers } };
        }
        rollbackPlugins = res.rollback;
      }
      writeEntries();
      writeRecords();
    }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    try {
      if (settingsWritten && rawBefore !== undefined) write(g.settingsPath, rawBefore);
      rollbackPlugins?.();
      writeRestoreStore(storeBefore);
    } catch (compErr) {
      deps.log.error(
        `[addons] toggle of ${feature.id} failed (${message}) and compensation failed (${(compErr as Error)?.message ?? compErr}); restore records kept`,
      );
      return { status: 500, body: { success: false, error: message, consistent: false } };
    }
    deps.log.error(`[addons] toggle of ${feature.id} failed and was rolled back: ${message}`);
    return { status: 500, body: { success: false, error: message } };
  }

  deps.packageManagerWrapper.invalidateAllPackageManagers?.();
  const r = plan.report;
  deps.log.info(
    `[addons] toggle ${feature.id} ${enabled ? "on" : "off"}: cascaded=[${r.cascaded.join(",")}] plugins=[${plan.pluginIds.join(",")}] filtered=[${r.filtered.join(",")}] restored=[${r.restored.join(",")}] keptOn=[${r.keptOn.map((k) => k.source).join(",")}] stillLoadedIn=[${r.stillLoadedIn.map((s) => `${s.source}@${s.folders.join("|")}`).join(",")}]`,
  );
  return { status: 200, body: { success: true, ...r } };
}
