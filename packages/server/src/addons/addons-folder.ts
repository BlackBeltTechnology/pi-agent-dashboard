/**
 * Folder mode of the Add-ons hub: what a session started in one folder loads.
 *
 * Pure (no I/O): classifies each global feature's pi packages against the
 * folder's `<cwd>/.pi/settings.json` `packages[]` entries, rolls the package
 * states up into one `AddonFolderState`, counts how many resources an added
 * package loads, and plans the folder toggle (the all-empty project delta and
 * its restore records). `addons-service.ts` gathers the inputs and applies the
 * plan.
 *
 * Identity follows pi's path rule (design D8): relative local sources resolve
 * from the directory of the settings file that contains them, then the single
 * shared predicate `sourcesMatch` decides.
 *
 * See change: addons-hub-folder-view (design D1–D3, D8).
 */
import type {
  AddonFeature,
  AddonFolderNotOwned,
  AddonFolderState,
  AddonKeptOn,
  AddonPackageContents,
  AddonPackagePart,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
import { packageIdentity } from "../pi/resource-origin.js";
import { getRestore, type RestoreRecord, type RestoreStore } from "./addon-toggle-restore.js";
import { type CatalogPluginInput, pluginsRequiringPart } from "./addons-catalog.js";
import { entriesEqual, entrySource, isAllEmptyFilter } from "./settings-entries.js";

const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

/** A relative local source resolved from `baseDir`; npm/git sources unchanged. */
function rebaseSource(source: string, baseDir: string): string {
  const id = packageIdentity(source, baseDir);
  return id.startsWith("local:") ? id.slice("local:".length) : source;
}

/** Project entry that loads nothing: `autoload: false` + the four resource arrays all `[]`. */
function isFolderOff(entry: unknown): boolean {
  return (
    !!entry && typeof entry === "object" && (entry as { autoload?: unknown }).autoload === false && isAllEmptyFilter(entry)
  );
}

function isAutoloadFalse(entry: unknown): boolean {
  return !!entry && typeof entry === "object" && (entry as { autoload?: unknown }).autoload === false;
}

/** The delta the folder toggle writes: pi documents `[]` as "load none of that type". */
function folderOffEntry(source: string): Record<string, unknown> {
  return { source, autoload: false, extensions: [], skills: [], prompts: [], themes: [] };
}

export type PackageFolderState = "added" | "off" | "narrowed" | "inherited";

export function packageStateOf(entry: unknown): PackageFolderState {
  if (entry === undefined) return "inherited";
  if (isFolderOff(entry)) return "off";
  if (isAutoloadFalse(entry)) return "narrowed";
  return "added";
}

export interface FolderCtx {
  /** `packages[]` of `<cwd>/.pi/settings.json` (empty when missing or unparseable). */
  projectEntries: readonly unknown[];
  /** `~/.pi/agent`: global relative sources resolve from here. */
  agentDir: string;
  /** `<cwd>/.pi`: project relative sources resolve from here. */
  piDir: string;
}

/** Indices of project entries that refer to the same package as `source` (a global source). */
export function projectEntryIndices(ctx: FolderCtx, source: string): number[] {
  const target = rebaseSource(source, ctx.agentDir);
  const out: number[] = [];
  ctx.projectEntries.forEach((e, i) => {
    const src = entrySource(e);
    if (src && sourcesMatch(rebaseSource(src, ctx.piDir), target)) out.push(i);
  });
  return out;
}

function hasGlob(p: string): boolean {
  return /[*?[]/.test(p);
}

/** Resources of one type an entry array lets through, best effort without listing files. */
function loadedOfType(patterns: unknown[], total: number): number {
  const strs = patterns.filter((p): p is string => typeof p === "string");
  const excludes = strs.filter((p) => p.startsWith("!") || p.startsWith("-")).length;
  const includes = strs.filter((p) => !p.startsWith("!") && !p.startsWith("-"));
  const base = includes.length === 0 ? (excludes > 0 ? total : 0) : includes.some(hasGlob) ? total : Math.min(total, includes.length);
  return Math.max(0, base - excludes);
}

/** How many of a package's resources a (normal) project entry loads. */
export function loadingOf(entry: unknown, contents: AddonPackageContents): { loaded: number; total: number } {
  let loaded = 0;
  let total = 0;
  for (const k of RESOURCE_KEYS) {
    const t = contents[k];
    total += t;
    const arr = entry && typeof entry === "object" ? (entry as Record<string, unknown>)[k] : undefined;
    loaded += Array.isArray(arr) ? loadedOfType(arr, t) : t;
  }
  return { loaded, total };
}

interface PartState {
  part: AddonPackagePart;
  state: PackageFolderState;
  /** Matching project entry indices (more than one is refused by the toggle). */
  indices: number[];
}

function partStates(feature: AddonFeature, ctx: FolderCtx): PartState[] {
  return feature.packages.map((part) => {
    const indices = projectEntryIndices(ctx, part.source);
    return { part, indices, state: packageStateOf(indices.length > 0 ? ctx.projectEntries[indices[0]] : undefined) };
  });
}

/** Roll-up, first match wins: folder-local facts before the global switch (spec: folder catalog). */
function rollUp(feature: AddonFeature, states: readonly PartState[]): AddonFolderState {
  if (feature.packages.length === 0) return "dashboard-only";
  if (states.some((s) => s.state === "added")) return "added-here";
  if (states.every((s) => s.state === "off")) return "off-here";
  if (states.some((s) => s.state === "off" || s.state === "narrowed")) return "partly-off-here";
  if (feature.state === "off") return "off-globally";
  return "inherited";
}

/** Annotate a global feature for folder mode. Core features carry no folder state. */
export function annotateFeature(
  feature: AddonFeature,
  ctx: FolderCtx,
  opts: { store: RestoreStore; projectSettingsPath: string; agentsOf: (part: AddonPackagePart) => number },
): AddonFeature {
  if (feature.kind === "core") return feature;
  const states = partStates(feature, ctx);
  const folderState = rollUp(feature, states);
  const packageAgents = feature.packages.reduce((n, p) => n + opts.agentsOf(p), 0);
  const off = states.filter((s) => s.state === "off");
  const restoreRecorded =
    off.length > 0 && off.every((s) => !!getRestore(opts.store, opts.projectSettingsPath, s.part.identity));
  const added = states.filter((s) => s.state === "added");
  let loading: AddonFeature["loading"];
  if (added.length > 0) {
    loading = { loaded: 0, total: 0 };
    for (const s of added) {
      const l = loadingOf(ctx.projectEntries[s.indices[0]], s.part.contents);
      loading.loaded += l.loaded;
      loading.total += l.total;
    }
  }
  return { ...feature, folderState, restoreRecorded, packageAgents, ...(loading ? { loading } : {}) };
}

// ── Folder toggle planning ─────────────────────────────────────────────────

export interface FolderPlanOk {
  ok: true;
  /** Whole-array replacement of the project `packages[]`. */
  nextPackages: unknown[];
  recordsToSet: RestoreRecord[];
  recordsToDelete: Array<{ settingsPath: string; identity: string }>;
  filtered: string[];
  restored: string[];
  removed: string[];
  keptOn: AddonKeptOn[];
  notOwned: AddonFolderNotOwned[];
  /** Anything to write (entries or records). */
  changed: boolean;
}

export interface FolderPlanErr {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

export interface FolderPlanInput {
  feature: AddonFeature;
  enabled: boolean;
  removeUnowned: boolean;
  ctx: FolderCtx;
  /** Canonical project settings path: the restore-record key. */
  projectSettingsPath: string;
  store: RestoreStore;
  /** Plugins whose own requirement may keep a package on (own plugin already excluded). */
  otherEnabledPlugins: readonly CatalogPluginInput[];
}

interface PlanAcc {
  next: unknown[];
  drop: Set<number>;
  recordsToSet: RestoreRecord[];
  recordsToDelete: FolderPlanOk["recordsToDelete"];
  filtered: string[];
  restored: string[];
  removed: string[];
  keptOn: AddonKeptOn[];
  notOwned: AddonFolderNotOwned[];
}

/** Turn one package off here: keep it on when another enabled plugin needs it, else write the all-empty delta. */
function planOffPart(s: PartState, input: FolderPlanInput, acc: PlanAcc): void {
  const { part } = s;
  const index = s.indices[0];
  const cur = index === undefined ? undefined : input.ctx.projectEntries[index];
  const by = pluginsRequiringPart(input.otherEnabledPlugins, part).map((p) => `plugin:${p.id}`);
  if (by.length > 0) {
    acc.keptOn.push({ source: part.source, by });
    return;
  }
  if (isFolderOff(cur)) return; // already off — never overwrite a record
  if (s.state === "added") return; // a normal entry is removed by uninstalling, not here
  const delta = folderOffEntry(rebaseSource(part.source, input.ctx.agentDir));
  // A record whose `filtered` no longer matches was made stale by a hand edit: replace it so the
  // newer entry is never lost. An up-to-date record is kept (off stays idempotent).
  const rec = getRestore(input.store, input.projectSettingsPath, part.identity);
  if (!rec || !entriesEqual(cur, rec.filtered)) {
    acc.recordsToSet.push({
      settingsPath: input.projectSettingsPath,
      identity: part.identity,
      original: cur === undefined ? null : cur,
      filtered: delta,
    });
  }
  if (index === undefined) acc.next.push(delta);
  else acc.next[index] = delta;
  acc.filtered.push(part.source);
}

/** Turn one package back on: restore the recorded entry, or leave an `autoload:false` entry we cannot prove we wrote. */
function planOnPart(s: PartState, input: FolderPlanInput, acc: PlanAcc): void {
  const { part } = s;
  const index = s.indices[0];
  const cur = index === undefined ? undefined : input.ctx.projectEntries[index];
  const rec = getRestore(input.store, input.projectSettingsPath, part.identity);
  const forget = () => acc.recordsToDelete.push({ settingsPath: input.projectSettingsPath, identity: part.identity });
  if (cur === undefined) {
    if (rec) forget();
    return;
  }
  if (s.state === "added") return; // normal entry: never touched here
  if (isFolderOff(cur) && rec) {
    if (rec.original === null) acc.drop.add(index);
    else acc.next[index] = rec.original;
    forget();
    acc.restored.push(part.source);
    return;
  }
  if (rec) forget();
  if (input.removeUnowned) {
    acc.drop.add(index);
    acc.removed.push(part.source);
  } else {
    acc.notOwned.push({ source: part.source, reason: notOwnedReason(cur, !!rec), entry: cur });
  }
}

function notOwnedReason(entry: unknown, hadRecord: boolean): AddonFolderNotOwned["reason"] {
  if (hadRecord) return "edited";
  return isFolderOff(entry) ? "no-record" : "narrowed";
}

function duplicateError(states: readonly PartState[]): FolderPlanErr | null {
  const dup = states.find((s) => s.indices.length > 1);
  if (!dup) return null;
  return {
    ok: false,
    status: 409,
    body: { success: false, reason: "duplicate-entries", error: `more than one packages[] entry for ${dup.part.source}` },
  };
}

export function planFolderToggle(input: FolderPlanInput): FolderPlanOk | FolderPlanErr {
  const states = partStates(input.feature, input.ctx);
  const refused = duplicateError(states);
  if (refused) return refused;
  const acc: PlanAcc = {
    next: [...input.ctx.projectEntries],
    drop: new Set(),
    recordsToSet: [],
    recordsToDelete: [],
    filtered: [],
    restored: [],
    removed: [],
    keptOn: [],
    notOwned: [],
  };
  const planPart = input.enabled ? planOnPart : planOffPart;
  for (const s of states) planPart(s, input, acc);

  const { recordsToSet, recordsToDelete, filtered, restored, removed, keptOn, notOwned } = acc;
  return {
    ok: true,
    nextPackages: acc.next.filter((_, i) => !acc.drop.has(i)),
    recordsToSet,
    recordsToDelete,
    filtered,
    restored,
    removed,
    keptOn,
    notOwned,
    changed: [filtered, restored, removed, recordsToSet, recordsToDelete].some((a) => a.length > 0),
  };
}
