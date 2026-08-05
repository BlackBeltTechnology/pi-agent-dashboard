/**
 * Resource activation toggle — writes the pi-standard settings form for the
 * resource's *origin*, so pi itself enforces the result.
 *
 * The dashboard never re-implements pi's activation semantics: it reads
 * `ResolvedResource.enabled` from `PackageManager.resolve()` and persists
 * through pi's `SettingsManager`. What this module owns is picking the correct
 * *form*, which depends on where the resource actually lives:
 *
 *   | origin                          | project-scope form                                     |
 *   |---------------------------------|--------------------------------------------------------|
 *   | loose under `<cwd>/.pi`         | `-<rel to .pi>`                                        |
 *   | loose under an `.agents` base   | `-<rel to that base>`                                  |
 *   | package-contributed             | `{ source, autoload: false, <type>: ["-<rel to root>"] }` |
 *   | loose under a global base       | `~/<agent dir>/<rel>` + an anchored glob exclusion      |
 *
 * `autoload: false` is mandatory on a project delta and destructive to omit:
 * without it pi resolves the entry at project scope, misses the user install
 * path, and drops the package's entire contribution. At *global* scope the
 * delta form is inert instead (a second same-scope entry is discarded by pi's
 * dedupe), so global scope keeps mutating the existing entry in place.
 *
 * The global-loose pair is portable by construction: the `~` path entry is
 * expanded per machine by pi, and the exclusion is an anchored glob rather than
 * an absolute path (machine-local) or a `~` pattern (never expanded, therefore
 * inert everywhere). The resource's own **file** is re-declared, never its
 * directory: prompts, themes and flat `.md` skills have the shared root as
 * their directory, and re-declaring a shared root pulls every sibling into
 * project-scope pattern evaluation.
 *
 * NOTE: pi's write is NOT JSONC-preserving. `persistScopedSettings` does a
 * whole-file `JSON.parse` → `JSON.stringify` round trip, discarding comments
 * and reformatting; a settings file containing comments fails to parse, and pi
 * then silently skips the write. This module therefore fails loudly on a
 * settings load error rather than reporting success.
 *
 * Concurrency: callers serialize per settings-file via a write mutex (see
 * resource-activation-routes.ts). The `SettingsManager` is constructed *and*
 * flushed inside that lock, so each toggle observes the previous one's write.
 *
 * See change: folder-resource-activation-toggle, project-scope-disable-global-resources.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AGENT_DIR,
  getPiCore,
  type PiPackageEntry,
  type PiSettings,
  type PiSettingsManager,
  type ResolvedPaths,
  type ResolvedResource,
} from "./pi-resource-activation.js";
import {
  clearOwnedEntry,
  isOwnedEntry,
  recordOwnedEntry,
} from "./resource-entry-ownership.js";
import {
  type Candidate,
  classifyFrom,
  collectOriginCandidates,
  exactSpellings,
  normalizeExactPattern,
  packageIdentity,
  type ResourceOrigin,
  stripPrefix,
  toPosix,
} from "./resource-origin.js";
import { resolveToggleTrust, type TrustOption } from "./resource-toggle-trust.js";

export type ToggleScope = "local" | "global";
export type ToggleType = "extension" | "skill" | "prompt" | "theme";
type ArrayKey = "extensions" | "skills" | "prompts" | "themes";

const ARRAY_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

const TYPE_TO_KEY: Record<ToggleType, ArrayKey> = {
  extension: "extensions",
  skill: "skills",
  prompt: "prompts",
  theme: "themes",
};

export interface ToggleRequest {
  scope: ToggleScope;
  cwd?: string;
  type: ToggleType;
  filePath: string;
  enabled: boolean;
  packageSource?: string;
}

export interface ToggleFailure {
  ok: false;
  status: number;
  error: string;
  /** Set when the folder needs a trust decision before the write can happen. */
  trustRequired?: true;
  trustOptions?: TrustOption[];
  /** True when the folder is trusted implicitly today and this write changes that. */
  implicitlyTrusted?: boolean;
}

export type ToggleResult = { ok: true } | ToggleFailure;

/** Absolute settings.json path a toggle for this scope will write. */
export function settingsPathForScope(scope: ToggleScope, cwd?: string): string {
  return scope === "local"
    ? path.join(cwd ?? process.cwd(), ".pi", "settings.json")
    : path.join(AGENT_DIR, "settings.json");
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isValidType(t: unknown): t is ToggleType {
  return t === "extension" || t === "skill" || t === "prompt" || t === "theme";
}

function validate(req: ToggleRequest): ToggleResult | null {
  const { scope, type, filePath, enabled } = req;
  if (scope !== "local" && scope !== "global") {
    return { ok: false, status: 400, error: "scope must be 'local' or 'global'" };
  }
  if (!isValidType(type)) {
    return { ok: false, status: 400, error: "type must be extension|skill|prompt|theme" };
  }
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, status: 400, error: "filePath is required" };
  }
  if (typeof enabled !== "boolean") {
    return { ok: false, status: 400, error: "enabled must be a boolean" };
  }
  if (scope === "local" && !req.cwd) {
    return { ok: false, status: 400, error: "cwd is required for local scope" };
  }
  return null;
}

/**
 * Remove exclusion entries addressing this resource, by **exact spelling**.
 *
 * `+` force-includes are never removed: a force-include outranks an exclusion,
 * so a user holding both has deliberately enabled the resource, and stripping
 * the include would flip it off across a disable/enable round trip.
 *
 * A user's glob is never *evaluated* against the resource — only the exact
 * spellings this module itself can produce are removed. Evaluating a broad
 * `!skills/**` would delete it and thereby enable every sibling it excluded.
 */
function stripExclusions(current: string[], spellings: Set<string>, ownGlobs: string[]): string[] {
  const globBodies = new Set(ownGlobs.map((g) => normalizeExactPattern(stripPrefix(g))));
  return current.filter((entry) => {
    if (!entry.startsWith("-") && !entry.startsWith("!")) return true;
    const body = normalizeExactPattern(entry.slice(1));
    return !spellings.has(body) && !globBodies.has(body);
  });
}

function spellingSet(filePath: string, baseDir: string): Set<string> {
  return new Set(exactSpellings(filePath, baseDir).map(normalizeExactPattern));
}

/**
 * Apply an activation toggle. Reuses pi's `PackageManager.resolve()` to locate
 * the resource (404 when absent — this also rejects `../` escapes, since an
 * out-of-tree path is never in the scanned set) and pi's `SettingsManager` to
 * persist. Returns a structured result; never throws on validation failures.
 */
export async function applyResourceToggle(req: ToggleRequest): Promise<ToggleResult> {
  const invalid = validate(req);
  if (invalid) return invalid;

  const { type, filePath, enabled } = req;
  const cwd = req.cwd ?? process.cwd();
  const agentDir = AGENT_DIR;
  const homeDir = os.homedir();
  const isProject = req.scope === "local";
  const arrKey = TYPE_TO_KEY[type];

  const { DefaultPackageManager, SettingsManager } = await getPiCore();
  // `projectTrusted: true` is required for the *write* primitive: an untrusted
  // manager loads `{}` and refuses to flush. The trust decision itself is made
  // by the gate below, which every write must pass through.
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });

  let resolved: ResolvedPaths;
  try {
    resolved = await pm.resolve(async () => "skip");
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: `failed to resolve resources for ${cwd}: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  const list = resolved[arrKey] ?? [];
  const targetReal = realpathOr(filePath);
  const item = list.find((r) => r.path === filePath || realpathOr(r.path) === targetReal);
  if (!item) {
    return { ok: false, status: 404, error: "resource not found in scanned set for scope" };
  }

  const candidates = collectOriginCandidates({ cwd, agentDir, homeDir, resolved });
  const origin = classifyFrom(item.path, candidates);
  if (!origin) {
    return { ok: false, status: 400, error: "resource lies outside every known resource base directory" };
  }

  // Directional guard: a global-scope toggle of a project-local resource has no
  // pi-standard form — the machine-wide settings file cannot reach into one
  // checkout. The reverse direction (local scope, global resource) is exactly
  // what this capability exists to support and is NOT rejected.
  if (!isProject && (origin.kind === "project-loose" || origin.kind === "agents-loose")) {
    return {
      ok: false,
      status: 400,
      error: "scope mismatch: a project-local resource cannot be toggled at global scope",
    };
  }

  // pi silently skips the write when the settings file failed to parse, while
  // still reporting nothing to the caller. Fail loudly instead.
  const loadError = isProject
    ? settingsManager.projectSettingsLoadError
    : settingsManager.globalSettingsLoadError;
  if (loadError) {
    return {
      ok: false,
      status: 409,
      error: `cannot write ${settingsPathForScope(req.scope, cwd)}: the settings file could not be parsed (${
        (loadError as Error)?.message ?? String(loadError)
      })`,
    };
  }

  if (isProject) {
    const trust = await resolveToggleTrust(cwd, agentDir, settingsManager);
    if (trust.outcome === "refused") return { ok: false, status: 403, error: trust.error };
    if (trust.outcome === "prompt") {
      return {
        ok: false,
        status: 403,
        error: trust.message,
        trustRequired: true,
        trustOptions: trust.options,
        implicitlyTrusted: trust.implicitlyTrusted,
      };
    }
  }

  const settings = isProject ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();

  const ctx: WriteContext = {
    sm: settingsManager,
    settings,
    isProject,
    arrKey,
    item,
    origin,
    enabled,
    cwd,
    agentDir,
    homeDir,
    candidates,
    resolved,
    afterFlush: [],
  };

  const failure =
    origin.kind === "package"
      ? writePackage(ctx, req.packageSource)
      : origin.kind === "global-loose"
        ? writeGlobalLoose(ctx)
        : writeProjectLoose(ctx);
  if (failure) return failure;

  await settingsManager.flush();
  // Ownership is recorded only once the settings write actually landed, so a
  // failed flush cannot leave a record claiming an entry that was never written.
  for (const commit of ctx.afterFlush) commit();
  return { ok: true };
}

interface WriteContext {
  sm: PiSettingsManager;
  settings: PiSettings;
  isProject: boolean;
  arrKey: ArrayKey;
  item: ResolvedResource;
  origin: ResourceOrigin;
  enabled: boolean;
  cwd: string;
  agentDir: string;
  homeDir: string;
  candidates: Candidate[];
  resolved: ResolvedPaths;
  /** Side effects to run only after the settings write has landed. */
  afterFlush: Array<() => void>;
}

/** The base directory pi evaluates this scope's array against. */
function evaluationBase(ctx: WriteContext): string {
  if (ctx.origin.kind === "agents-loose") return ctx.origin.baseDir;
  return ctx.isProject ? path.join(ctx.cwd, ".pi") : ctx.agentDir;
}

function persistLoose(sm: PiSettingsManager, isProject: boolean, arrKey: ArrayKey, updated: string[]): void {
  if (isProject) {
    if (arrKey === "extensions") sm.setProjectExtensionPaths(updated);
    else if (arrKey === "skills") sm.setProjectSkillPaths(updated);
    else if (arrKey === "prompts") sm.setProjectPromptTemplatePaths(updated);
    else sm.setProjectThemePaths(updated);
  } else {
    if (arrKey === "extensions") sm.setExtensionPaths(updated);
    else if (arrKey === "skills") sm.setSkillPaths(updated);
    else if (arrKey === "prompts") sm.setPromptTemplatePaths(updated);
    else sm.setThemePaths(updated);
  }
}

/**
 * True when another resource of the same type would produce the identical
 * relative string against its own base directory. pi evaluates each resource
 * with *its own* base, so a bare relative pattern would disable both.
 */
function isRelativePatternAmbiguous(ctx: WriteContext, relPattern: string): boolean {
  for (const other of ctx.resolved[ctx.arrKey] ?? []) {
    if (other.path === ctx.item.path) continue;
    const o = classifyFrom(other.path, ctx.candidates);
    if (!o || (o.kind !== "project-loose" && o.kind !== "agents-loose")) continue;
    if (toPosix(path.relative(o.baseDir, other.path)) === relPattern) return true;
  }
  return false;
}

/**
 * Loose resource already inside project-scope resolution (`<cwd>/.pi` or an
 * `.agents` base). Only the exclusion is written — no re-declaration is needed.
 */
function writeProjectLoose(ctx: WriteContext): ToggleResult | null {
  const base = ctx.origin.baseDir;
  const relPattern = toPosix(path.relative(base, ctx.item.path));
  // Anchored on the base-dir leaf plus the path within it: home- and
  // checkout-independent, and distinct per base dir.
  const anchoredGlob = `!**/${path.basename(base)}/${relPattern}`;
  const spellings = spellingSet(ctx.item.path, evaluationBase(ctx));

  const current = [...(ctx.settings[ctx.arrKey] ?? [])];
  const updated = stripExclusions(current, spellings, [anchoredGlob]);
  if (!ctx.enabled) {
    updated.push(isRelativePatternAmbiguous(ctx, relPattern) ? anchoredGlob : `-${relPattern}`);
  }
  persistLoose(ctx.sm, ctx.isProject, ctx.arrKey, updated);
  return null;
}

/** `~`-relative form of a path under the home directory, or `null` when outside it. */
function tildeForm(target: string, homeDir: string): string | null {
  const rel = path.relative(homeDir, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/**
 * Global-loose resource. At project scope the resource's own file is
 * re-declared with a `~` path entry (expanded per machine) and disabled with an
 * anchored glob (matches the absolute path without naming any home directory).
 * At global scope the ordinary relative form applies.
 */
function writeGlobalLoose(ctx: WriteContext): ToggleResult | null {
  if (!ctx.isProject) return writeProjectLoose(ctx);

  const anchorRel = tildeForm(ctx.origin.baseDir, ctx.homeDir);
  if (anchorRel === null) {
    return {
      ok: false,
      status: 400,
      error:
        `the agent directory ${ctx.origin.baseDir} is not under the home directory, so a project-scope ` +
        "disable of a resource under it cannot be expressed portably; nothing was written",
    };
  }
  const relWithin = toPosix(path.relative(ctx.origin.baseDir, ctx.item.path));
  const plainEntry = `~/${anchorRel}/${relWithin}`;
  const globEntry = `!**/${anchorRel}/${relWithin}`;
  const spellings = spellingSet(ctx.item.path, evaluationBase(ctx));

  const current = [...(ctx.settings[ctx.arrKey] ?? [])];
  let updated = stripExclusions(current, spellings, [globEntry]);

  if (ctx.enabled) {
    // Only remove the plain entry when this dashboard wrote it. A
    // byte-identical user-authored entry is left alone; the residue is inert,
    // since a plain entry alone changes reported scope, not activation.
    if (isOwnedEntry(ctx.cwd, ctx.arrKey, plainEntry)) {
      updated = updated.filter((e) => e !== plainEntry);
      ctx.afterFlush.push(() => clearOwnedEntry(ctx.cwd, ctx.arrKey, plainEntry));
    }
  } else {
    if (!updated.includes(plainEntry)) {
      updated.push(plainEntry);
      ctx.afterFlush.push(() => recordOwnedEntry(ctx.cwd, ctx.arrKey, plainEntry));
    }
    updated.push(globEntry);
  }
  persistLoose(ctx.sm, ctx.isProject, ctx.arrKey, updated);
  return null;
}

function entrySource(entry: PiPackageEntry): string {
  return typeof entry === "string" ? entry : entry.source;
}

/** Package-contributed resource: project-scope delta, or global in-place mutation. */
function writePackage(ctx: WriteContext, packageSource?: string): ToggleResult | null {
  const source = ctx.origin.packageSource;
  if (!source) {
    return { ok: false, status: 500, error: "package resource has no declared source" };
  }
  // Guard: a caller-supplied packageSource must match the resolved resource's
  // own package source, else we could rewrite an unrelated package's filters
  // using this resource's relative path.
  if (packageSource !== undefined && packageSource !== source) {
    return { ok: false, status: 400, error: "packageSource does not match the resolved resource" };
  }

  const base = ctx.isProject ? ctx.cwd : ctx.agentDir;
  const identity = packageIdentity(source, base);
  const packages: PiPackageEntry[] = [...(ctx.settings.packages ?? [])];
  const idx = packages.findIndex((p) => packageIdentity(entrySource(p), base) === identity);

  const rel = toPosix(path.relative(ctx.origin.baseDir, ctx.item.path));
  const spellings = spellingSet(ctx.item.path, ctx.origin.baseDir);

  if (idx === -1) {
    if (ctx.enabled) return null; // nothing addressing this resource to remove
    if (!ctx.isProject) {
      return { ok: false, status: 404, error: "package not found in settings for scope" };
    }
    // A project-scope delta over the globally-declared package. `autoload: false`
    // is what redirects resolution to the user install; without it pi looks for
    // a project install that does not exist and drops the whole package.
    packages.push({ source, autoload: false, [ctx.arrKey]: [`-${rel}`] });
  } else {
    const raw = packages[idx];
    const pkg: Exclude<PiPackageEntry, string> = typeof raw === "string" ? { source: raw } : { ...raw };
    const isDelta = pkg.autoload === false;
    const updated = stripExclusions([...(pkg[ctx.arrKey] ?? [])], spellings, []);
    if (!ctx.enabled) updated.push(`-${rel}`);
    if (updated.length > 0) pkg[ctx.arrKey] = updated;
    else delete pkg[ctx.arrKey];

    const hasFilters = ARRAY_KEYS.some((k) => pkg[k] !== undefined);
    if (isDelta && !hasFilters) {
      // The delta existed only to carry this exclusion.
      packages.splice(idx, 1);
    } else if (hasFilters || pkg.autoload !== undefined) {
      packages[idx] = pkg;
    } else {
      // Collapse back to a bare string when no filters remain.
      packages[idx] = pkg.source;
    }
  }

  if (ctx.isProject) ctx.sm.setProjectPackages(packages);
  else ctx.sm.setPackages(packages);
  return null;
}
