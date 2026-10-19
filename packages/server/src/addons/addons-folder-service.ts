/**
 * Folder mode of the Add-ons hub, I/O side: the folder catalog
 * (`GET /api/addons/catalog?scope=local&cwd=`) and the folder toggle
 * (`POST /api/addons/:id/toggle` with `scope: "local"`).
 *
 * The caller (`routes/addons-routes.ts`) owns HTTP, `admitCwd` admission and the
 * locks (hub queue → project settings file). The pure state / plan logic lives in
 * `addons-folder.ts`.
 *
 * See change: addons-hub-folder-view (design D1–D4, D8).
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AddonFeature,
  AddonFolderInfo,
  AddonFolderToggleResponse,
  AddonLooseCounts,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { enrichInstalledRows } from "../package/installed-package-enricher.js";
import { AGENT_DIR, getPiCore } from "../pi/pi-resource-activation.js";
import { scanLocalResources } from "../pi/pi-resource-scanner.js";
import { packageIdentity } from "../pi/resource-origin.js";
import { canonical, resolveToggleTrust, type TrustGateResult } from "../pi/resource-toggle-trust.js";
import { registerTrustChallenge } from "../pi/trust-challenges.js";
import {
  deleteRestore,
  type RestoreStore,
  readRestoreStore,
  setRestore,
  writeRestoreStore,
} from "./addon-toggle-restore.js";
import { buildAddonCatalog } from "./addons-catalog.js";
import { annotateFeature, type FolderCtx, type FolderPlanOk, loadingOf, packageStateOf, planFolderToggle, projectEntryIndices } from "./addons-folder.js";
import { type AddonsDeps, gatherCatalog, readManagedPaths } from "./addons-service.js";
import { countPackageAgents, readPackageInfo } from "./package-contents.js";
import { entrySource, readSettingsFile, type SettingsRead, serializeSettings, writeSettingsText } from "./settings-entries.js";

/** Restore-record key path: canonical folder + `.pi/settings.json` (the file may not exist yet; design D3). */
function recordSettingsPath(cwd: string): string {
  return path.join(canonical(cwd), ".pi", "settings.json");
}

/**
 * `<cwd>/.pi` resolving outside the folder (a symlink escape) would redirect the settings
 * write to an unrelated directory. An absent `.pi` is created inside `cwd`, so it is fine.
 */
function piDirEscapes(cwd: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(path.join(cwd, ".pi"));
  } catch {
    return false;
  }
  const root = canonical(cwd);
  return real !== root && !real.startsWith(root + path.sep);
}

const PI_DIR_ESCAPES_ERROR = "<cwd>/.pi resolves outside the folder; refusing to write through it";

function themeCount(cwd: string): number {
  try {
    return fs.readdirSync(path.join(cwd, ".pi", "themes")).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function looseCounts(cwd: string): AddonLooseCounts {
  const s = scanLocalResources(cwd);
  return {
    skills: s.skills.length,
    agents: s.agents.length,
    prompts: s.prompts.length,
    extensions: s.extensions.length,
    themes: themeCount(cwd),
  };
}

async function projectRows(deps: AddonsDeps, cwd: string) {
  try {
    const rows = await deps.packageManagerWrapper.listInstalled("local", cwd);
    const project = (rows as Array<{ scope?: string }>).filter((r) => r.scope === "project");
    return enrichInstalledRows(project as never, undefined, { managedPaths: readManagedPaths(deps.log) });
  } catch (err) {
    deps.log.warn(`[addons] could not list folder packages for ${cwd}: ${(err as Error)?.message ?? err}`);
    return [];
  }
}

export interface FolderCatalog {
  features: AddonFeature[];
  folder: AddonFolderInfo;
}

type Orphan = { entry: unknown; i: number };

/** Folder-only packages (normal project entries matching no global package) as `added-here` features. */
async function folderOnlyFeatures(
  deps: AddonsDeps,
  cwd: string,
  ctx: FolderCtx,
  orphans: readonly Orphan[],
  agentsOf: (p: { installedPath?: string }) => number,
): Promise<AddonFeature[]> {
  const rows = await projectRows(deps, cwd);
  const entryByIdentity = new Map<string, unknown>();
  const inputs = orphans.map(({ entry }) => {
    const source = entrySource(entry) as string;
    const identity = packageIdentity(source, ctx.piDir);
    entryByIdentity.set(identity, entry);
    const row = rows.find((r) => packageIdentity(r.source, ctx.piDir) === identity);
    const info = readPackageInfo(row?.installedPath);
    return {
      source,
      scope: "user" as const,
      installedPath: row?.installedPath,
      packageName: info.name,
      version: row?.version,
      description: row?.description,
      displayName: row?.displayName,
      dashboardManaged: row?.dashboardManaged,
      entryOff: false,
      contents: info.contents,
    };
  });
  const built = buildAddonCatalog({ plugins: [], packages: inputs, recommended: [], baseDir: ctx.piDir });
  return built
    .filter((f) => f.kind !== "core")
    .map((f) => {
      const part = f.packages[0];
      const loading = part ? loadingOf(entryByIdentity.get(part.identity), part.contents) : undefined;
      return {
        ...f,
        packages: f.packages.map((p) => ({ ...p, scope: "project" as const })),
        folderState: "added-here" as const,
        restoreRecorded: false,
        packageAgents: f.packages.reduce((n, p) => n + agentsOf(p), 0),
        ...(loading ? { loading } : {}),
      };
    });
}

/** Global features annotated with folder state, plus one feature per folder-only package. */
export async function gatherFolderCatalog(deps: AddonsDeps, cwd: string): Promise<FolderCatalog> {
  const g = await gatherCatalog(deps);
  const piDir = path.join(cwd, ".pi");
  const project = readSettingsFile(path.join(piDir, "settings.json"));
  const ctx: FolderCtx = { projectEntries: project.ok ? project.packages : [], agentDir: g.agentDir, piDir };
  const store = readRestoreStore(deps.log);
  const projectSettingsPath = recordSettingsPath(cwd);
  const agentsOf = (p: { installedPath?: string }) => countPackageAgents(p.installedPath);

  const features = g.features.map((f) => annotateFeature(f, ctx, { store, projectSettingsPath, agentsOf }));

  const matched = new Set<number>();
  for (const f of g.features) for (const part of f.packages) for (const i of projectEntryIndices(ctx, part.source)) matched.add(i);
  // Only normal (`added`) entries become folder-only features; an `autoload:false` project entry that matches no
  // global package is a delta over nothing, so it has no row (the Resources pages own per-file state).
  const orphans = ctx.projectEntries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry, i }) => !matched.has(i) && packageStateOf(entry) === "added" && entrySource(entry));
  if (orphans.length > 0) features.push(...(await folderOnlyFeatures(deps, cwd, ctx, orphans, agentsOf)));

  const folder: AddonFolderInfo = {
    cwd,
    looseCounts: looseCounts(cwd),
    ...(project.ok ? {} : { settingsError: project.error }),
  };
  return { features, folder };
}

async function defaultResolveTrust(cwd: string): Promise<TrustGateResult> {
  const { SettingsManager } = await getPiCore();
  const sm = SettingsManager.create(cwd, AGENT_DIR, { projectTrusted: true });
  return resolveToggleTrust(cwd, AGENT_DIR, sm);
}

export interface FolderToggleArgs {
  cwd: string;
  featureId: string;
  enabled: boolean;
  removeUnowned: boolean;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** 404 / 400 for a feature the folder toggle cannot act on (before any file is read). */
function rejectFeature(feature: AddonFeature | undefined, featureId: string): Reply | null {
  if (!feature) return { status: 404, body: { success: false, error: `Feature "${featureId}" not found` } };
  if (feature.kind === "core") return { status: 400, body: { success: false, error: "core features cannot be toggled" } };
  if (feature.packages.length === 0) {
    return {
      status: 400,
      body: { success: false, error: "dashboard-only features have no AI-agent part to turn off per folder" },
    };
  }
  return null;
}

/** Turning off needs a folder that is neither off globally nor added here (re-enabling is lenient, design D3). */
function rejectOffState(state: AddonFeature["folderState"]): Reply | null {
  if (state === "off-globally") return { status: 400, body: { success: false, error: "this feature is turned off globally" } };
  if (state === "added-here") {
    return { status: 400, body: { success: false, error: "added in this folder: uninstall it from the folder instead" } };
  }
  return null;
}

/** Trust before any write (D4): pi ignores an untrusted folder's settings. Null = proceed. */
async function trustGate(deps: AddonsDeps, cwd: string): Promise<Reply | null> {
  const trust = await (deps.resolveTrust ?? defaultResolveTrust)(cwd);
  if (trust.outcome === "refused") return { status: 403, body: { success: false, error: trust.error } };
  if (trust.outcome !== "prompt") return null;
  registerTrustChallenge(cwd);
  return {
    status: 403,
    body: {
      success: false,
      error: trust.message,
      data: {
        trustRequired: true,
        trustOptions: trust.options,
        implicitlyTrusted: trust.implicitlyTrusted,
        ...(trust.preselected ? { preselected: trust.preselected } : {}),
        ...(trust.dashboardSource ? { dashboardSource: trust.dashboardSource } : {}),
      },
    },
  };
}

/** Write the restore records, then the project file; a failure puts the records back. Null = written. */
function commitPlan(
  deps: AddonsDeps,
  args: { cwd: string; featureId: string; projectFile: string },
  project: Extract<SettingsRead, { ok: true }>,
  store: RestoreStore,
  plan: FolderPlanOk,
): Reply | null {
  // Re-check just before the first write: `.pi` can be replaced during the awaited trust gate.
  if (piDirEscapes(args.cwd)) return { status: 400, body: { success: false, error: PI_DIR_ESCAPES_ERROR } };
  const write = deps.writeSettingsText ?? writeSettingsText;
  const nextStore = structuredClone(store);
  for (const r of plan.recordsToSet) setRestore(nextStore, r);
  for (const r of plan.recordsToDelete) deleteRestore(nextStore, r.settingsPath, r.identity);
  try {
    if (JSON.stringify(nextStore) !== JSON.stringify(store)) writeRestoreStore(nextStore);
    const json: Record<string, unknown> = { ...project.json, packages: plan.nextPackages };
    if (plan.nextPackages.length === 0) delete json.packages;
    if (JSON.stringify(plan.nextPackages) !== JSON.stringify(project.packages)) {
      // An empty object means "nothing configured" to pi, same as no file: turning a feature back on
      // in a folder that had no settings file leaves it as it was found.
      if (Object.keys(json).length === 0) fs.rmSync(args.projectFile, { force: true });
      else write(args.projectFile, serializeSettings(json));
    }
    return null;
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    try {
      writeRestoreStore(structuredClone(store));
    } catch (compErr) {
      deps.log.error(
        `[addons] folder toggle of ${args.featureId} failed (${message}) and the record rollback failed (${(compErr as Error)?.message ?? compErr})`,
      );
      return { status: 500, body: { success: false, error: message, consistent: false } };
    }
    deps.log.error(`[addons] folder toggle of ${args.featureId} in ${args.cwd} failed and was rolled back: ${message}`);
    return { status: 500, body: { success: false, error: message } };
  }
}

/**
 * Turn a global feature's pi part off (or back on) for one folder. The caller
 * holds the hub queue lock and the project settings-file lock.
 */
export async function folderToggle(deps: AddonsDeps, args: FolderToggleArgs): Promise<Reply> {
  const { cwd, featureId, enabled, removeUnowned } = args;
  const g = await gatherCatalog(deps, { skipRegistry: true });
  const feature = g.features.find((f) => f.id === featureId);
  const rejected = rejectFeature(feature, featureId);
  if (rejected || !feature) return rejected as Reply;
  if (piDirEscapes(cwd)) return { status: 400, body: { success: false, error: PI_DIR_ESCAPES_ERROR } };

  const piDir = path.join(cwd, ".pi");
  const projectFile = path.join(piDir, "settings.json");
  const project = readSettingsFile(projectFile);
  if (!project.ok) {
    return {
      status: 409,
      body: { success: false, reason: "settings-unparseable", error: `settings file cannot be parsed: ${project.error}` },
    };
  }
  const ctx: FolderCtx = { projectEntries: project.packages, agentDir: g.agentDir, piDir };
  const projectSettingsPath = recordSettingsPath(cwd);

  if (!enabled) {
    const state = annotateFeature(feature, ctx, { store: {}, projectSettingsPath, agentsOf: () => 0 }).folderState;
    const bad = rejectOffState(state);
    if (bad) return bad;
  }

  const store = readRestoreStore(deps.log);
  const plan = planFolderToggle({
    feature,
    enabled,
    removeUnowned,
    ctx,
    projectSettingsPath,
    store,
    otherEnabledPlugins: g.inputs.plugins.filter((p) => p.enabled && p.id !== feature.plugin?.id),
  });
  if (!plan.ok) return { status: plan.status, body: plan.body };

  if (plan.changed) {
    const blocked = (await trustGate(deps, cwd)) ?? commitPlan(deps, { cwd, featureId, projectFile }, project, store, plan);
    if (blocked) return blocked;
    deps.packageManagerWrapper.invalidateAllPackageManagers?.();
  }
  logToggle(deps, featureId, enabled, cwd, plan);
  const body: AddonFolderToggleResponse = {
    success: true,
    scope: "local",
    cwd,
    changed: plan.changed,
    filtered: plan.filtered,
    restored: plan.restored,
    removed: plan.removed,
    keptOn: plan.keptOn,
    notOwned: plan.notOwned,
  };
  return { status: 200, body: { ...body } };
}

function logToggle(
  deps: AddonsDeps,
  featureId: string,
  enabled: boolean,
  cwd: string,
  p: { filtered: string[]; restored: string[]; removed: string[]; keptOn: Array<{ source: string }> },
): void {
  deps.log.info(
    `[addons] folder toggle ${featureId} ${enabled ? "on" : "off"} cwd=${cwd}: written=[${p.filtered.join(",")}] restored=[${p.restored.join(",")}] removed=[${p.removed.join(",")}] keptOn=[${p.keptOn.map((k) => k.source).join(",")}]`,
  );
}
