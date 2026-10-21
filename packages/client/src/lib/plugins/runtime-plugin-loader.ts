/**
 * Runtime plugin loader (shell-owned): fetches `GET /api/plugins/runtime-clients` and registers each
 * admitted plugin's prebuilt client entry into the live slot registry — claims, reducers, i18n catalog,
 * route descriptors, display names, event-type ownership — then nudges every mounted consumer.
 *
 * Skips entirely (no listing fetch, no import) when the client targets a remote server (non-empty API base)
 * or the page carries no import map (Vite-served `--dev` page, design D21); the reason is exposed through
 * `useRuntimeLoaderState()` for the Plugins tab. A build-time plugin id always wins. A later
 * `plugins-changed` re-fetches the listing and adds newly admitted plugins; a loaded plugin that is gone
 * or whose hash changed is NEVER re-imported — it raises the "Plugin changes need a reload" notice.
 *
 * See change: decouple-plugins-from-core (tasks 6.14, 6.15, 6.17, 6.18).
 */
import { bumpSlotClaimsVersion, lazyClaim } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  type ClaimEntry,
  registerSessionEventReducer,
  registerToolRowFinalizer,
  type SlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { EventTypeOwner } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import { claimsToRouteDescriptors, type RouteDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import { type ComponentType, createElement, useLayoutEffect, useSyncExternalStore } from "react";
import { getApiBase } from "../api/api-context.js";
import { regroupOwnedEvents, type SessionState } from "../chat/event-reducer.js";
import { registerPluginCatalog } from "../i18n/i18n.js";
import { registerPluginRouteDescriptors } from "../nav/back-target.js";
import { setEventTypeOwners } from "./event-type-owners.js";

/** One claim as the listing forwards it: every manifest field, `module` already an asset URL. */
interface ListingClaim {
  slot: string;
  component?: string;
  module?: string;
  predicate?: string;
  shouldRender?: string;
  resultPending?: string;
  labelComponent?: string;
  [field: string]: unknown;
}

/** Mirror of the server's `RuntimeClientListingEntry` (kept structural: the client never imports server code). */
export interface RuntimeListingEntry {
  id: string;
  displayName: string;
  priority: number;
  sha256: string;
  entry: string;
  styles?: string;
  i18nCatalog?: string;
  eventTypes: string[];
  claims: ListingClaim[];
  routes: Array<{ pattern: string; depth: 1 | 2; parentPath?: string }>;
}

export type RuntimeLoaderStatus = "idle" | "ready" | "remote-server" | "no-import-map";

export interface RuntimeLoaderState {
  status: RuntimeLoaderStatus;
  /** A loaded runtime plugin was removed, refused or changed hash: only a page reload applies it. */
  reloadNeeded: boolean;
  /** `{id: displayName}` of loaded runtime plugins (immutable snapshot, replaced on change). */
  names: Readonly<Record<string, string>>;
}

export interface RuntimeLoaderDeps {
  registry: SlotRegistry;
  /** Ids of build-time (bundled) plugins; a runtime listing entry with one of these ids is ignored. */
  buildTimeIds: ReadonlySet<string>;
  /** Build-time route descriptors; re-registered together with the runtime ones (the back-target store REPLACES its list). */
  buildTimeRoutes: readonly RouteDescriptor[];
  getApiBase?: () => string;
  hasImportMap?: () => boolean;
  fetchListing?: () => Promise<RuntimeListingEntry[]>;
  importModule?: (url: string) => Promise<Record<string, unknown>>;
  registerRoutes?: (descriptors: RouteDescriptor[]) => void;
}

/** DOM event fired after one or more runtime plugins registered (detail: `{ ids, owners }`). */
export const RUNTIME_PLUGINS_REGISTERED_EVENT = "runtime-plugins-registered";

// ── Module store ────────────────────────────────────────────────────────────
const EMPTY_NAMES: Readonly<Record<string, string>> = Object.freeze({});
let state: RuntimeLoaderState = { status: "idle", reloadNeeded: false, names: EMPTY_NAMES };
const listeners = new Set<() => void>();
/** id → content hash of the module that is LIVE in this page (never re-imported). */
const loaded = new Map<string, string>();
/** Runtime route descriptors registered so far (build-time ones come from deps). */
let runtimeRoutes: RouteDescriptor[] = [];
const styleLinks = new Set<string>();

function setState(patch: Partial<RuntimeLoaderState>): void {
  const next = { ...state, ...patch };
  if (next.status === state.status && next.reloadNeeded === state.reloadNeeded && next.names === state.names) return;
  state = next;
  for (const l of listeners) l();
}

export function getRuntimeLoaderState(): RuntimeLoaderState {
  return state;
}

function subscribeRuntimeLoaderState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRuntimeLoaderState(): RuntimeLoaderState {
  return useSyncExternalStore(subscribeRuntimeLoaderState, getRuntimeLoaderState);
}

/** Test-only: forget everything the loader remembers. */
export function __resetRuntimeLoaderForTests(): void {
  state = { status: "idle", reloadNeeded: false, names: EMPTY_NAMES };
  loaded.clear();
  runtimeRoutes = [];
  styleLinks.clear();
  listeners.clear();
  chain = Promise.resolve();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function defaultHasImportMap(): boolean {
  return typeof document !== "undefined" && document.querySelector('script[type="importmap"]') !== null;
}

async function defaultFetchListing(): Promise<RuntimeListingEntry[]> {
  const res = await fetch("/api/plugins/runtime-clients");
  if (!res.ok) throw new Error(`GET /api/plugins/runtime-clients failed: ${res.status}`);
  const body = (await res.json()) as { plugins?: RuntimeListingEntry[] };
  return Array.isArray(body.plugins) ? body.plugins : [];
}

/** Dynamic `import()` of a served asset URL: a bare-specifier-free ES module resolved through the import map. */
function defaultImportModule(url: string): Promise<Record<string, unknown>> {
  return import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;
}

/** Attach a plugin's stylesheet once (idempotent per URL). */
function ensureStyles(pluginId: string, href: string): void {
  if (styleLinks.has(href) || typeof document === "undefined") return;
  styleLinks.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-plugin-styles", pluginId);
  document.head.appendChild(link);
}

/** Wrap a claim component so its plugin's stylesheet attaches on the first render of any of its claims. */
function withStyles(pluginId: string, href: string, Inner: ComponentType<Record<string, unknown>>): ComponentType<Record<string, unknown>> {
  const WithStyles = (props: Record<string, unknown>) => {
    useLayoutEffect(() => {
      ensureStyles(pluginId, href);
    }, []);
    return createElement(Inner, props);
  };
  WithStyles.displayName = `RuntimeClaim(${pluginId})`;
  return WithStyles;
}

function namedFunction(mod: Record<string, unknown>, name: string, what: string, id: string): (...args: never[]) => unknown {
  const fn = mod[name];
  if (typeof fn !== "function") throw new Error(`entry of "${id}" does not export ${what} "${name}"`);
  return fn as (...args: never[]) => unknown;
}

const PASS_THROUGH_FIELDS = ["tab", "toolName", "customType", "pathPrefix", "resourceType", "command", "path", "sessionParam", "depth", "parentPath", "presentation", "config"] as const;

/** `fileHandler` claim metadata, shaped as the generated build-time registry shapes it. */
function fileHandlerMeta(claim: ListingClaim): Record<string, unknown> {
  const { id, extensions, mode, label, keepAlive, maxBytes, firstOverwriteNotice, copySuffix, validator } = claim as Record<string, unknown>;
  return {
    id,
    extensions,
    mode,
    label,
    ...(keepAlive ? { keepAlive } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(firstOverwriteNotice ? { firstOverwriteNotice } : {}),
    ...(copySuffix ? { copySuffix } : {}),
    ...(validator !== undefined ? { validator } : {}),
  };
}

/** The claim's static functions, read from the entry module by the names the manifest gives. */
function claimFunctions(id: string, claim: ListingClaim, mod: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (claim.predicate) out.predicate = namedFunction(mod, claim.predicate, "predicate", id);
  if (claim.shouldRender) out.shouldRender = namedFunction(mod, claim.shouldRender, "shouldRender", id);
  if (claim.resultPending) out.resultPending = namedFunction(mod, claim.resultPending, "resultPending", id);
  if (claim.labelComponent) {
    out.labelComponentName = claim.labelComponent;
    out.LabelComponent = namedFunction(mod, claim.labelComponent, "labelComponent", id);
  }
  return out;
}

/** The claim component: lazy for a `module` claim, else the entry export; wrapped to attach styles. */
function claimComponent(
  entry: RuntimeListingEntry,
  claim: ListingClaim & { component: string },
  mod: Record<string, unknown>,
  load: (url: string) => Promise<Record<string, unknown>>,
): ComponentType<Record<string, unknown>> {
  let Component: ComponentType<Record<string, unknown>>;
  if (claim.module) {
    const moduleUrl = claim.module;
    Component = lazyClaim(() => load(moduleUrl), claim.component) as ComponentType<Record<string, unknown>>;
  } else {
    const c = mod[claim.component];
    if (typeof c !== "function" && (typeof c !== "object" || c === null)) {
      throw new Error(`entry of "${entry.id}" does not export component "${claim.component}"`);
    }
    Component = c as ComponentType<Record<string, unknown>>;
  }
  return entry.styles ? withStyles(entry.id, entry.styles, Component) : Component;
}

/** Build one registry claim from a listing claim and the plugin's entry module (throws on a missing export). */
function buildClaim(
  entry: RuntimeListingEntry,
  claim: ListingClaim,
  mod: Record<string, unknown>,
  load: (url: string) => Promise<Record<string, unknown>>,
): ClaimEntry {
  const out: Record<string, unknown> = { pluginId: entry.id, priority: entry.priority ?? 1000, slot: claim.slot };
  for (const key of PASS_THROUGH_FIELDS) if (claim[key] !== undefined) out[key] = claim[key];
  if (claim.expandWhileRunning) out.expandWhileRunning = true;
  if (claim.slot === "editor-pane-file-handler" && typeof claim.id === "string") out.fileHandler = fileHandlerMeta(claim);
  Object.assign(out, claimFunctions(entry.id, claim, mod));
  if (claim.component) out.Component = claimComponent(entry, claim as ListingClaim & { component: string }, mod, load);
  return out as unknown as ClaimEntry;
}

// ── The loader ──────────────────────────────────────────────────────────────
/** Serialises `load()` runs so a `plugins-changed` burst never imports one id twice. */
let chain: Promise<void> = Promise.resolve();

/** Import one entry and register it whole or not at all (every lookup that can throw runs before any mutation). */
async function registerEntry(
  deps: RuntimeLoaderDeps,
  entry: RuntimeListingEntry,
  importModule: (url: string) => Promise<Record<string, unknown>>,
): Promise<void> {
  const mod = await importModule(entry.entry);
  const claims = entry.claims.map((c) => buildClaim(entry, c, mod, importModule));
  const catalog = entry.i18nCatalog ? mod[entry.i18nCatalog] : undefined;
  const slice = mod.sessionEventReducer;
  const finalizers = Array.isArray(mod.toolRowFinalizers) ? mod.toolRowFinalizers : [];
  deps.registry.registerPlugin({ id: entry.id, displayName: entry.displayName, eventTypes: entry.eventTypes });
  for (const claim of claims) deps.registry.addClaim(claim);
  if (slice) registerSessionEventReducer(entry.id, slice as never);
  for (const f of finalizers) registerToolRowFinalizer(entry.id, f as never);
  registerPluginCatalog(entry.id, catalog as never);
  runtimeRoutes = [
    ...runtimeRoutes,
    ...claimsToRouteDescriptors(entry.routes.map((r) => ({ slot: "shell-overlay-route", path: r.pattern, depth: r.depth, parentPath: r.parentPath }))),
  ];
  loaded.set(entry.id, entry.sha256);
}

/** Why this load pass must not touch the network or the registry (remote API base wins over a missing import map). */
function blockedStatus(deps: RuntimeLoaderDeps): "remote-server" | "no-import-map" | null {
  if ((deps.getApiBase ?? getApiBase)()) return "remote-server";
  if (!(deps.hasImportMap ?? defaultHasImportMap)()) return "no-import-map";
  return null;
}

/** Register every listed plugin not yet live; flag a loaded one that vanished or changed hash. */
async function registerListing(deps: RuntimeLoaderDeps, listing: RuntimeListingEntry[]) {
  const importModule = deps.importModule ?? defaultImportModule;
  const listed = new Set(listing.map((p) => p.id));
  let reloadNeeded = [...loaded.keys()].some((id) => !listed.has(id));
  const registered: string[] = [];
  const names: Record<string, string> = { ...state.names };
  for (const entry of listing) {
    if (deps.buildTimeIds.has(entry.id)) continue; // the build-time plugin wins
    const liveSha = loaded.get(entry.id);
    if (liveSha !== undefined) {
      if (liveSha !== entry.sha256) reloadNeeded = true; // never swap a loaded module in place
      continue;
    }
    try {
      await registerEntry(deps, entry, importModule);
      names[entry.id] = entry.displayName;
      registered.push(entry.id);
    } catch (err) {
      console.error(`[runtime-plugins] "${entry.id}" skipped: its client entry failed to load`, err);
    }
  }
  return { registered, names, reloadNeeded };
}

/** After new plugins registered: routes union, owners, state, then nudge the enabled set and every mounted reader. */
function publishRegistered(deps: RuntimeLoaderDeps, registered: string[], names: Record<string, string>, reloadNeeded: boolean): void {
  (deps.registerRoutes ?? registerPluginRouteDescriptors)([...deps.buildTimeRoutes, ...runtimeRoutes]);
  const owners = deps.registry.getEventTypeOwners();
  setEventTypeOwners(owners);
  setState({ names, reloadNeeded: state.reloadNeeded || reloadNeeded });
  // Owners first, then the enabled set and every mounted reader see the new plugin.
  window.dispatchEvent(new CustomEvent(RUNTIME_PLUGINS_REGISTERED_EVENT, { detail: { ids: registered, owners } }));
  bumpSlotClaimsVersion();
}

async function loadOnce(deps: RuntimeLoaderDeps): Promise<void> {
  const blocked = blockedStatus(deps);
  if (blocked) {
    setState({ status: blocked });
    return;
  }
  let listing: RuntimeListingEntry[];
  try {
    listing = await (deps.fetchListing ?? defaultFetchListing)();
  } catch (err) {
    console.error("[runtime-plugins] listing fetch failed", err);
    return;
  }
  setState({ status: "ready" });
  const { registered, names, reloadNeeded } = await registerListing(deps, listing);
  if (registered.length > 0) publishRegistered(deps, registered, names, reloadNeeded);
  else if (reloadNeeded) setState({ reloadNeeded: true });
}

/** One serialised load pass (initial boot or `plugins-changed`). Never rejects. */
export function loadRuntimePlugins(deps: RuntimeLoaderDeps): Promise<void> {
  chain = chain.then(() => loadOnce(deps)).catch((err) => {
    console.error("[runtime-plugins] load failed", err);
  });
  return chain;
}

/**
 * Boot the loader: one load pass now, one more on every `plugins-changed` DOM event (the WS
 * `plugins_changed` re-emit). Returns the unsubscribe.
 */
export function startRuntimePluginLoader(deps: RuntimeLoaderDeps): () => void {
  const onChanged = () => {
    void loadRuntimePlugins(deps);
  };
  window.addEventListener("plugins-changed", onChanged);
  void loadRuntimePlugins(deps);
  return () => window.removeEventListener("plugins-changed", onChanged);
}

/**
 * Why runtime plugins cannot load on this page right now (read live; null = they can). A remote API base
 * wins over a missing import map. Drives the Plugins-tab notices.
 */
export function getRuntimeLoadingBlocker(): "remote-server" | "no-import-map" | null {
  return blockedStatus({} as RuntimeLoaderDeps);
}

/** `{id: displayName}` hook for name lookups (build-time names are merged by the caller). */
export function useRuntimePluginNames(): Readonly<Record<string, string>> {
  return useRuntimeLoaderState().names;
}

/**
 * Late owner over every loaded session: earlier raw rows of newly owned event types become one group row
 * at the first row's position (`regroupOwnedEvents`, pure). Returns the SAME map when nothing changed.
 */
export function regroupAllSessionStates(states: Map<string, SessionState>, owners: readonly EventTypeOwner[]): Map<string, SessionState> {
  let next: Map<string, SessionState> | null = null;
  for (const [id, st] of states) {
    const regrouped = regroupOwnedEvents(st, owners);
    if (regrouped !== st) {
      next ??= new Map(states);
      next.set(id, regrouped);
    }
  }
  return next ?? states;
}
