/**
 * Config load (spec: system-one-config). User file `~/.pi/agent/system-one.json`
 * plus an optional project override `<cwd>/.pi/system-one.json`, read only for
 * `project.trusted === true`. Every layer parses into null-prototype objects
 * with `__proto__`/`constructor`/`prototype` dropped (design D12). The project
 * layer may only set `presets.<activePreset>.consumers.<id>.chain`, restricted
 * to user-defined on-machine backends. Files are re-read only when their mtime
 * (or size) changes. See change: add-system-one-registry.
 */
import { readFileSync, statSync } from "node:fs";
import { isOffMachine, parseBackendUrl } from "./egress.js";
import { projectConfigPath, userConfigPath } from "./paths.js";
import { isObj, own, type Plain, safeParse } from "./safe-json.js";
import type { Backend, CalibrationRecord, Capabilities, Preset, Primitive, ProjectRef, SystemOneConfig } from "./types.js";
import { _resetWarnings, warnOnce } from "./warn.js";

export { userConfigPath } from "./paths.js";

// ---------- reset hooks (tests) ----------
const resetHooks: Array<() => void> = [];
export function onReset(fn: () => void): void {
  resetHooks.push(fn);
}
/** Clear caches, per-process warning and registration memory. Tests only. */
export function _resetForTests(): void {
  cache.clear();
  _resetWarnings();
  for (const fn of resetHooks) fn();
}

// ---------- raw file cache ----------
interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: Plain | null;
}
const cache = new Map<string, CacheEntry>();

/** Parsed file (null-prototype) or `null` when absent/invalid. mtime-cached. */
function readLayer(path: string): Plain | null {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(path);
  } catch {
    cache.delete(path);
    return null;
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  let value: Plain | null = null;
  try {
    const parsed = safeParse(readFileSync(path, "utf8"), (p) => warnOnce(`${path}: dropped forbidden key "${p}"`));
    if (!isObj(parsed)) warnOnce(`${path}: not a JSON object; ignoring file`);
    else if (own(parsed, "version") !== 1) warnOnce(`${path}: unsupported version ${JSON.stringify(own(parsed, "version"))}; ignoring file`);
    else value = parsed;
  } catch {
    warnOnce(`${path}: invalid JSON; ignoring file`);
  }
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

// ---------- normalization ----------
const BACKEND_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY_LIKE = ["apiKey", "key", "token"];
const PRIMITIVES = new Set<Primitive>(["choice", "score", "noul"]);

const map = <T>(): Record<string, T> => Object.create(null);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const posNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const strArr = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v] : undefined);

function normCapabilities(v: unknown): Capabilities | undefined {
  if (!isObj(v)) return undefined;
  const out: Capabilities = {};
  for (const k of ["maxContextTokens", "maxOptions"] as const) {
    if (!Object.hasOwn(v, k)) continue;
    const n = own(v, k);
    out[k] = n === null ? null : (posNum(n) ?? null);
  }
  if (Object.hasOwn(v, "languages")) out.languages = own(v, "languages") === null ? null : (strArr(own(v, "languages")) ?? null);
  if (Object.hasOwn(v, "primitives")) {
    const p = strArr(own(v, "primitives"));
    out.primitives = p ? (p.filter((x) => PRIMITIVES.has(x as Primitive)) as Primitive[]) : null;
  }
  return out;
}

type Common = Pick<Backend, "timeoutMs" | "capabilities">;

function normHttp(id: string, v: Plain, file: string, common: Common): Backend | null {
  const url = str(own(v, "url"));
  if (!url || !parseBackendUrl(url)) {
    warnOnce(`${file}: backend "${id}" needs an http: or https: url; ignoring it`);
    return null;
  }
  const keyRef = str(own(v, "keyRef"));
  return { kind: "http", url, model: str(own(v, "model")) ?? "", ...(keyRef ? { keyRef } : {}), ...common };
}

const validPort = (p: unknown): p is number => Number.isInteger(p) && (p as number) > 0 && (p as number) < 65536;

function normManaged(id: string, v: Plain, file: string, common: Common): Backend | null {
  const engine = own(v, "engine");
  if (engine !== "von" && engine !== "laya") {
    warnOnce(`${file}: managed backend "${id}" needs engine "von" or "laya"; ignoring it`);
    return null;
  }
  const port = own(v, "port");
  const checkpoint = str(own(v, "checkpoint"));
  return {
    kind: "managed",
    engine,
    ...(checkpoint ? { checkpoint } : {}),
    ...(validPort(port) ? { port } : {}),
    ...(own(v, "autostart") === true ? { autostart: true } : {}),
    ...common,
  };
}

function normLlm(id: string, v: Plain, file: string, common: Common): Backend | null {
  const role = str(own(v, "role"));
  if (!role) {
    warnOnce(`${file}: llm backend "${id}" needs a role; ignoring it`);
    return null;
  }
  return { kind: "llm", role, ...common };
}

const KIND_NORMALIZERS: Record<string, (id: string, v: Plain, file: string, common: Common) => Backend | null> = {
  http: normHttp,
  managed: normManaged,
  llm: normLlm,
};

export function normBackend(id: string, v: unknown, file: string): Backend | null {
  if (!BACKEND_ID.test(id)) {
    warnOnce(`${file}: backend id "${id}" is invalid; ignoring it`);
    return null;
  }
  if (!isObj(v)) return null;
  for (const k of KEY_LIKE.filter((k) => Object.hasOwn(v, k)))
    warnOnce(`${file}: backend "${id}" has key-like field "${k}"; ignored (keys never live in the config)`);
  const kind = own(v, "kind");
  const norm = typeof kind === "string" && Object.hasOwn(KIND_NORMALIZERS, kind) ? KIND_NORMALIZERS[kind] : undefined;
  if (!norm) {
    warnOnce(`${file}: backend "${id}" has unknown kind ${JSON.stringify(kind)}; ignoring it`);
    return null;
  }
  const timeoutMs = posNum(own(v, "timeoutMs"));
  const capabilities = normCapabilities(own(v, "capabilities"));
  return norm(id, v, file, { ...(timeoutMs ? { timeoutMs } : {}), ...(capabilities ? { capabilities } : {}) });
}

function normChain(v: unknown): string[] {
  return strArr(v) ?? [];
}

function normPreset(v: unknown): Preset | null {
  if (!isObj(v)) return null;
  const preset: Preset = { chain: normChain(own(v, "chain")) };
  const consumers = own(v, "consumers");
  if (isObj(consumers)) {
    preset.consumers = map();
    for (const cid of Object.keys(consumers)) {
      const c = own(consumers, cid);
      if (isObj(c)) preset.consumers[cid] = { chain: normChain(own(c, "chain")) };
    }
  }
  return preset;
}

function normCalibration(v: unknown): CalibrationRecord | null {
  if (!isObj(v)) return null;
  const mode = own(v, "mode");
  const model = str(own(v, "model"));
  if ((mode !== "shadow" && mode !== "enforce") || !model) return null;
  const thresholds: Record<string, number> = map();
  const t = own(v, "thresholds");
  if (isObj(t)) for (const k of Object.keys(t)) if (typeof t[k] === "number") thresholds[k] = t[k] as number;
  return { mode, thresholds, model, measuredAt: str(own(v, "measuredAt")) ?? "" };
}

/** Normalize every own entry of an object-valued key into a null-prototype map. */
function mapOwn<T>(raw: Plain, key: string, norm: (k: string, v: unknown) => T | null): Record<string, T> {
  const out = map<T>();
  const src = own(raw, key);
  if (!isObj(src)) return out;
  for (const k of Object.keys(src)) {
    const v = norm(k, own(src, k));
    if (v) out[k] = v;
  }
  return out;
}

/** Normalize a parsed user layer into a full config. Exported for the plugin server. */
export function normalizeUser(raw: Plain | null, file: string): SystemOneConfig {
  if (!raw) return { version: 1, allowOffMachine: false, backends: map(), presets: map(), activePreset: "", calibration: map() };
  return {
    version: 1,
    allowOffMachine: own(raw, "allowOffMachine") === true,
    backends: mapOwn(raw, "backends", (id, v) => normBackend(id, v, file)),
    presets: mapOwn(raw, "presets", (_n, v) => normPreset(v)),
    activePreset: str(own(raw, "activePreset")) ?? "",
    calibration: mapOwn(raw, "calibration", (_k, v) => normCalibration(v)),
  };
}

const PROJECT_RULE = "project files may only set presets.<activePreset>.consumers.<id>.chain";

/** Warn once for every key of `obj` outside `allowed`, prefixed by `path`. */
function warnIgnored(file: string, obj: Plain, allowed: string[], path: string): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) warnOnce(`${file}: ignoring "${path}${k}" (${PROJECT_RULE})`);
}

/** Project chain entries kept only when user-defined AND on-machine (no LlmCaller here → llm is off-machine). */
function projectChain(cfg: SystemOneConfig, cid: string, raw: unknown, file: string): string[] {
  return normChain(raw).filter((id) => {
    const b = Object.hasOwn(cfg.backends, id) ? cfg.backends[id] : undefined;
    const why = !b ? "not a backend in the user config" : isOffMachine(b) ? "a project cannot select an off-machine backend" : null;
    if (why) warnOnce(`${file}: dropping "${id}" from consumer "${cid}": ${why}`);
    return why === null;
  });
}

function applyProjectConsumers(cfg: SystemOneConfig, name: string, consumers: Plain, file: string): void {
  for (const cid of Object.keys(consumers)) {
    const c = own(consumers, cid);
    if (!isObj(c)) continue;
    warnIgnored(file, c, ["chain"], `presets.${name}.consumers.${cid}.`);
    const raw = own(c, "chain");
    const chain = projectChain(cfg, cid, raw, file);
    // Every requested id dropped → no override: the user's chain stays in force.
    if (chain.length === 0 && normChain(raw).length > 0) continue;
    if (!Object.hasOwn(cfg.presets, name)) cfg.presets[name] = { chain: [] };
    const target = cfg.presets[name];
    target.consumers ??= map();
    target.consumers[cid] = { chain };
  }
}

/** Merge the permitted project keys onto `cfg` (mutates). */
function applyProject(cfg: SystemOneConfig, raw: Plain, file: string): void {
  warnIgnored(file, raw, ["version", "presets"], "");
  const presets = own(raw, "presets");
  if (!isObj(presets)) return;
  warnIgnored(file, presets, [cfg.activePreset], "presets.");
  const p = Object.hasOwn(presets, cfg.activePreset) ? own(presets, cfg.activePreset) : undefined;
  if (!isObj(p)) return;
  warnIgnored(file, p, ["consumers"], `presets.${cfg.activePreset}.`);
  const consumers = own(p, "consumers");
  if (isObj(consumers)) applyProjectConsumers(cfg, cfg.activePreset, consumers, file);
}

export interface LoadOptions {
  project?: ProjectRef;
}

/** The effective config for one call. Cheap on repeat (mtime cache). */
export function loadConfig(opts: LoadOptions = {}): SystemOneConfig {
  const file = userConfigPath();
  const cfg = normalizeUser(readLayer(file), file);
  if (opts.project?.trusted === true) {
    const pfile = projectConfigPath(opts.project.cwd);
    const raw = readLayer(pfile);
    if (raw) applyProject(cfg, raw, pfile);
  }
  return cfg;
}
