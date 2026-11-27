/**
 * Template discovery, loader and listing (design D1/D2). Sources, highest precedence first:
 * project `<cwd>/.pi/teams` (only when `host.isProjectTrusted(cwd)`), user `<piAgentDir>/teams`,
 * `bundled` (registered by later changes, trusted). Everything is synchronous and fails closed:
 * an untrusted project is listed by file stem only and its content is never read.
 * The lane/REST ops (`team.templates`, `team.start`) call these functions; this module registers no op.
 * See change: add-agent-teams-templates-hooks.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TemplateIssue, TemplateSource, TemplateSummary } from "../shared/protocol.js";
import type { TeamHooks } from "../shared/types.js";
import { effectiveHookTimeoutMs } from "./config.js";
import { hashHooks } from "./hook-hash.js";
import { entryExists, projectTrusted, readSourceFile, resolveSourceDir } from "./template-fs.js";
import { type ParseOutcome, parseTemplate, type TemplateCore } from "./template-parse.js";
import { checkPlaybookLimits, type ParsedTemplate } from "./template-render.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

export { hashHooks } from "./hook-hash.js";
export { parseTemplate } from "./template-parse.js";
export * from "./template-render.js";

/** What this module needs from the dependency bag (tests pass a plain object). */
export type TemplateDeps = Pick<TemplatesHooksDeps, "config" | "host" | "modes" | "logger">;

const MAX_LISTED_TEMPLATES = 200;
const MAX_CACHE_ENTRIES = 600;
/** A loadable name: no separators, no leading dot; stricter validity is the template's own `name_*` errors. */
const LOOKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

// ── cache (key = realpath + mtime/ino/size; trust and config are re-applied on every call) ──

interface CacheEntry {
  outcome: ParseOutcome;
  hash: string;
}
const cache = new Map<string, CacheEntry>();

export const templateCache = {
  /** Drop every cached parse (called when a team starts so the next listing re-reads). */
  invalidate(): void {
    cache.clear();
  },
  get size(): number {
    return cache.size;
  },
};

const cacheKey = (key: string, stem: string): string => `${stem}\u0000${key}`;

function cachedParse(key: string, text: string, stem: string): CacheEntry {
  const k = cacheKey(key, stem);
  const hit = cache.get(k);
  if (hit) return hit;
  const entry: CacheEntry = { outcome: parseTemplate(text, stem), hash: createHash("sha256").update(text).digest("hex") };
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(k, entry);
  return entry;
}

// ── bundled source ──

const bundled = new Map<string, string>();

/** Register a trusted `bundled` template (markdown text); returns a disposer. Used by later changes. */
export function registerBundledTemplate(name: string, markdown: string): () => void {
  bundled.set(name, markdown);
  cache.clear();
  return () => {
    if (bundled.get(name) === markdown) bundled.delete(name);
  };
}

// ── evaluation of one template file ──

interface Evaluated {
  summary: TemplateSummary;
  template?: ParsedTemplate;
}

const withDefaultTimeout = (hooks: TeamHooks, ms: number): TeamHooks => {
  const out: TeamHooks = {};
  for (const [event, list] of Object.entries(hooks)) out[event as keyof TeamHooks] = (list ?? []).map((h) => ({ command: h.command, timeoutMs: h.timeoutMs ?? ms }));
  return out;
};

/** Checks that depend on live config / the mode registry / the caller; run on every call, never cached. */
function liveErrors(deps: TemplateDeps, core: TemplateCore, callerSessionId: string | undefined): { errors: TemplateIssue[]; mode?: string } {
  const cfg = deps.config();
  const errors: TemplateIssue[] = [];
  const cap = Math.min(core.maxTeammates ?? Number.POSITIVE_INFINITY, cfg.maxTeammates);
  if (core.members.length > cap) errors.push({ code: "roster_exceeds_max", path: "members", message: `the roster expands to ${core.members.length} teammates; the limit is ${cap}` });
  const resolved = deps.modes.resolve(core.declaredMode, cfg.teammateMode, callerSessionId);
  if (!resolved.ok) errors.push({ code: "mode_unavailable", path: "mode", message: resolved.reason });
  const limit = checkPlaybookLimits(core.body, cfg);
  if (!limit.ok) errors.push({ code: "playbook_too_long", path: "body", message: `playbook body is ${limit.chars} characters / ${limit.lines} lines; the limit is ${limit.maxChars} characters / ${limit.maxLines} lines` });
  return resolved.ok ? { errors, mode: resolved.mode } : { errors };
}

function buildTemplate(deps: TemplateDeps, source: TemplateSource, core: TemplateCore, mode: string, entry: CacheEntry): ParsedTemplate {
  const cfg = deps.config();
  const defaultTimeout = effectiveHookTimeoutMs(cfg);
  const hooks = core.hooks ? withDefaultTimeout(core.hooks, defaultTimeout) : undefined;
  return {
    name: core.name,
    source,
    mode,
    hash: entry.hash,
    spawn: core.spawn,
    members: core.members,
    body: core.body,
    warnings: entry.outcome.warnings,
    ...(core.description !== undefined ? { description: core.description } : {}),
    ...(core.lead !== undefined ? { lead: core.lead } : {}),
    ...(core.maxTeammates !== undefined ? { maxTeammates: Math.min(core.maxTeammates, cfg.maxTeammates) } : {}),
    ...(core.autoDispatch !== undefined ? { autoDispatch: core.autoDispatch } : {}),
    ...(core.notifyCoalesceMs !== undefined ? { notifyCoalesceMs: core.notifyCoalesceMs } : {}),
    ...(core.requirePlanApproval !== undefined ? { requirePlanApproval: core.requirePlanApproval } : {}),
    ...(core.defaultModel !== undefined ? { defaultModel: core.defaultModel } : {}),
    ...(core.defaultTools !== undefined ? { defaultTools: core.defaultTools } : {}),
    ...(core.defaultSkills !== undefined ? { defaultSkills: core.defaultSkills } : {}),
    ...(hooks ? { hooks, hooksHash: hashHooks(hooks, defaultTimeout) } : {}),
  };
}

function finish(deps: TemplateDeps, source: TemplateSource, stem: string, entry: CacheEntry, callerSessionId: string | undefined): Evaluated {
  const { outcome } = entry;
  const core = outcome.core;
  const live = core ? liveErrors(deps, core, callerSessionId) : { errors: [] as TemplateIssue[], mode: undefined };
  // The parse already reports an oversized `count` as roster_exceeds_max; do not repeat it.
  const errors = [...outcome.errors, ...live.errors.filter((e) => !(e.code === "roster_exceeds_max" && outcome.errors.some((o) => o.code === e.code)))];
  const summary: TemplateSummary = {
    name: stem,
    source,
    trusted: true,
    valid: errors.length === 0,
    errors,
    warnings: outcome.warnings,
    ...(core?.description !== undefined ? { description: core.description } : {}),
    ...(live.mode !== undefined ? { mode: live.mode } : {}),
    ...(core ? { members: core.members.map((m) => ({ name: m.name, ...(m.agent !== undefined ? { agent: m.agent } : {}) })), hasHooks: core.hooks !== undefined } : {}),
  };
  if (errors.length > 0 || !core || live.mode === undefined) return { summary };
  return { summary, template: buildTemplate(deps, source, core, live.mode, entry) };
}

const failSummary = (source: TemplateSource, stem: string, code: string, message: string): Evaluated => ({
  summary: { name: stem, source, trusted: true, valid: false, errors: [{ code, message }], warnings: [] },
});

/** A readable source entry for `stem`, or null when it vanished / is not a regular file (caller falls through). */
interface Source {
  source: TemplateSource;
  /** Real directory; absent for `bundled`. */
  dir?: string;
}

function evaluate(deps: TemplateDeps, src: Source, stem: string, callerSessionId: string | undefined): Evaluated | null {
  if (src.source === "bundled") {
    const text = bundled.get(stem);
    if (text === undefined) return null;
    return finish(deps, "bundled", stem, cachedParse(`bundled|${text.length}|${createHash("sha256").update(text).digest("hex")}`, text, stem), callerSessionId);
  }
  const dir = src.dir as string;
  const read = readSourceFile(dir, `${stem}.md`, deps.config().maxTemplateBytes, (key) => cache.has(cacheKey(key, stem)));
  if (read.ok) return finish(deps, src.source, stem, cachedParse(read.key, read.text, stem), callerSessionId);
  switch (read.code) {
    case "too_large":
      return failSummary(src.source, stem, "template_too_large", `template is larger than ${deps.config().maxTemplateBytes} bytes`);
    case "outside_source_dir":
      return failSummary(src.source, stem, "outside_source_dir", "template resolves outside its source directory");
    case "unreadable":
      return failSummary(src.source, stem, "unreadable", "template could not be read");
    default:
      return null;
  }
}

// ── directories ──

function userDir(deps: TemplateDeps): ReturnType<typeof resolveSourceDir> {
  try {
    return resolveSourceDir(deps.host.resolvePiAgentDir(), "teams");
  } catch {
    return { ok: false, code: "not_found" };
  }
}

const projectDir = (cwd: string): ReturnType<typeof resolveSourceDir> => resolveSourceDir(cwd, path.join(".pi", "teams"));

/** `*.md` entries that could be regular files (symlinks resolve on read); dotfiles skipped. */
function listStems(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name.endsWith(".md") && !e.name.startsWith(".") && (e.isFile() || e.isSymbolicLink()))
      .map((e) => e.name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

// ── listing ──

export interface ListTemplatesInput {
  cwd: string;
  deps: TemplateDeps;
  /** The calling session (for per-caller mode availability); the lane op passes its caller. */
  caller?: { sessionId?: string };
}

type Candidates = Map<string, Source[]>;

/** Gather per-name candidates (highest precedence first) and the untrusted project stems. */
function collectSources(cwd: string, deps: TemplateDeps, warnings: string[]): { sources: Candidates; stubs: string[] } {
  const sources: Candidates = new Map();
  const add = (name: string, s: Source): void => void sources.set(name, [...(sources.get(name) ?? []), s]);
  const trusted = projectTrusted(deps, cwd);
  const stubs: string[] = [];
  const proj = projectDir(cwd);
  if (proj.ok) {
    for (const stem of listStems(proj.dir)) {
      if (trusted) add(stem, { source: "project", dir: proj.dir });
      else stubs.push(stem);
    }
  } else if (proj.code === "outside_source_dir") warnings.push("project template directory .pi/teams resolves outside the project and was ignored");
  const user = userDir(deps);
  if (user.ok) for (const stem of listStems(user.dir)) add(stem, { source: "user", dir: user.dir });
  else if (user.code === "outside_source_dir") warnings.push("user template directory resolves outside the pi agent directory and was ignored");
  for (const name of bundled.keys()) add(name, { source: "bundled" });
  return { sources, stubs };
}

const untrustedStub = (name: string): TemplateSummary => ({
  name,
  source: "project",
  trusted: false,
  valid: false,
  errors: [{ code: "project_untrusted", message: "the project is not trusted; trust it to read this template" }],
  warnings: [],
});

export function listTemplates({ cwd, deps, caller }: ListTemplatesInput): { templates: TemplateSummary[]; warnings: string[] } {
  const warnings: string[] = [];
  const { sources, stubs } = collectSources(cwd, deps, warnings);
  type Item = { name: string; stub: boolean };
  const items: Item[] = [...[...sources.keys()].map((name) => ({ name, stub: false })), ...stubs.map((name) => ({ name, stub: true }))];
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : Number(a.stub) - Number(b.stub)));
  if (items.length > MAX_LISTED_TEMPLATES) warnings.push(`template listing is capped at ${MAX_LISTED_TEMPLATES} (${items.length} found); showing the first ${MAX_LISTED_TEMPLATES} by name`);

  const templates: TemplateSummary[] = [];
  for (const item of items.slice(0, MAX_LISTED_TEMPLATES)) {
    if (item.stub) {
      templates.push(untrustedStub(item.name));
      continue;
    }
    const ev = firstEvaluated(deps, sources.get(item.name) ?? [], item.name, caller?.sessionId);
    if (ev) templates.push(ev.summary);
  }
  return { templates, warnings };
}

/** The first candidate (precedence order) that is actually readable. */
function firstEvaluated(deps: TemplateDeps, candidates: readonly Source[], name: string, callerSessionId: string | undefined): Evaluated | null {
  for (const src of candidates) {
    const ev = evaluate(deps, src, name, callerSessionId);
    if (ev) return ev;
  }
  return null;
}

// ── loading ──

type LoadTemplateCode = "template_not_found" | "template_invalid" | "project_untrusted" | "mode_unavailable";
export type LoadTemplateResult =
  | { ok: true; template: ParsedTemplate }
  | { ok: false; code: LoadTemplateCode; message: string; issues: TemplateIssue[] };

/**
 * Resolve one template by name for a start: project (when trusted) → user → bundled. An untrusted project
 * file never shadows a user/bundled one; only-untrusted ⇒ `project_untrusted`. Invalid ⇒ `template_invalid`
 * with the issue list (a lone `mode_unavailable` surfaces as that code).
 */
export function loadTemplate(name: string, cwd: string, deps: TemplateDeps, opts: { caller?: { sessionId?: string } } = {}): LoadTemplateResult {
  const notFound: LoadTemplateResult = { ok: false, code: "template_not_found", message: `template "${String(name).slice(0, 80)}" was not found`, issues: [] };
  if (typeof name !== "string" || !LOOKUP_NAME_RE.test(name)) return notFound;
  const trusted = projectTrusted(deps, cwd);
  const proj = projectDir(cwd);
  const user = userDir(deps);
  const order: Source[] = [
    ...(trusted && proj.ok ? [{ source: "project" as const, dir: proj.dir }] : []),
    ...(user.ok ? [{ source: "user" as const, dir: user.dir }] : []),
    { source: "bundled" },
  ];
  const ev = firstEvaluated(deps, order, name, opts.caller?.sessionId);
  if (ev?.template) return { ok: true, template: ev.template };
  if (ev) return invalidResult(name, ev.summary.errors);
  if (!trusted && proj.ok && entryExists(proj.dir, `${name}.md`)) {
    return { ok: false, code: "project_untrusted", message: `template "${name}" is a project template and the project is not trusted`, issues: [{ code: "project_untrusted" }] };
  }
  return notFound;
}

function invalidResult(name: string, issues: TemplateIssue[]): LoadTemplateResult {
  const code: LoadTemplateCode = issues.length > 0 && issues.every((i) => i.code === "mode_unavailable") ? "mode_unavailable" : "template_invalid";
  return { ok: false, code, message: `template "${name}" is invalid: ${issues.map((i) => i.code).join(", ")}`, issues };
}

/** Registrar: wires cache cleanup only; the ops that use this module are registered by the start module. */
export function registerTemplates(deps: TemplatesHooksDeps): void {
  deps.onDispose(() => templateCache.invalidate());
}
