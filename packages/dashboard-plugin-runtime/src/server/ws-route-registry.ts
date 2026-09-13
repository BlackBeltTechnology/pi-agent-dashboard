/**
 * Registry of plugin-owned WebSocket route scopes (change: add-browser-relay
 * D1).
 *
 * A plugin's server entry calls `ctx.registerWsRoute(scope, opts)` DURING its
 * activation (the loader opens the activation window; a registration after
 * that window closes throws). The server's upgrade handler consults the
 * registry — AFTER the four core prefixes, via the resolver wired into
 * `routeScopeForUrl` — and applies the core gates before delegating the
 * upgrade to the plugin's `handleUpgrade`.
 *
 * Teardown (plugin disabled via the loader toggle, or activation failure)
 * unregisters the plugin's scopes, closes every socket the plugin tracked
 * with code 1001, and tombstones the prefixes so later upgrades to them see
 * a deliberate 404 instead of an unrouted-path TCP destroy.
 *
 * Singleton (`getWsRouteRegistry`), mirroring the plugin-status store: the
 * loader, the server upgrade handler and the activation routes must all see
 * ONE registry without threading it through every call site.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Minimal structural socket the registry needs, so this package carries no
 * dependency on `ws` — the `ws` WebSocket satisfies it structurally.
 */
export interface WsSocketLike {
  close(code?: number, reason?: string): void;
  once(event: "close", listener: () => void): unknown;
}

/** Context handed to a plugin's `handleUpgrade` after the core gates pass. */
export interface WsRouteMeta {
  /** Owning plugin id (from the manifest, not self-declared). */
  pluginId: string;
  /** The registered scope this upgrade resolved to. */
  scope: string;
  /**
   * Register an accepted socket for teardown. The registry can only close
   * sockets it knows about: a plugin that completes an upgrade MUST hand the
   * resulting socket back here, or a later disable will leave it open.
   */
  trackSocket(ws: WsSocketLike): void;
}

/** The `opts` a plugin passes to `registerWsRoute`. */
export interface WsRouteRegistration {
  /** Route prefix under `/ws/` (trailing slash), unique and non-overlapping. */
  pathPrefix: string;
  /**
   * Exact Origin strings. Non-empty REPLACES the dashboard origin policy for
   * this scope (the core policy is not consulted); empty keeps the core
   * policy unchanged.
   */
  admitOrigins: readonly string[];
  /** Receives the raw upgrade once every core gate has passed. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, meta: WsRouteMeta): void;
}

interface ActiveRegistration {
  pluginId: string;
  scope: string;
  pathPrefix: string;
  admitOrigins: readonly string[];
  handleUpgrade: WsRouteRegistration["handleUpgrade"];
}

/** Core scopes a plugin may never claim (spec: plugin-ws-route). */
export const RESERVED_WS_SCOPES = ["browser", "terminal", "live", "bridge"] as const;

/**
 * Core WS paths a plugin prefix may never equal or nest under.
 *
 * `exact: true` marks a single PATH (`/ws` is the core browser route — it
 * cannot be namespace-reserved because plugin routes legitimately live under
 * `/ws/<scope>/`). The others are core namespaces: `/ws/terminal/<id>`,
 * `/live/<id>`, and the bridge route plus everything under it, so a plugin
 * cannot squat a core-family path a client might mis-dial.
 */
const RESERVED_WS_ROUTES: ReadonlyArray<{ prefix: string; exact: boolean }> = [
  { prefix: "/ws", exact: true },
  { prefix: "/ws/terminal/", exact: false },
  { prefix: "/live/", exact: false },
  { prefix: "/ws/bridge", exact: false },
];

/** Reserved prefixes, flat (spec table / E2). */
export const RESERVED_WS_PATH_PREFIXES = ["/ws", "/ws/terminal/", "/live/", "/ws/bridge"] as const;

const KEBAB_SCOPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PATH_PREFIX = /^\/ws\/[a-z0-9-]+(\/[a-z0-9-]+)*\/$/;

export class WsRouteRegistry {
  private byScope = new Map<string, ActiveRegistration>();
  /** Prefixes of torn-down registrations: later upgrades 404, deterministically. */
  private tombstonedPrefixes = new Set<string>();
  /** Plugin ids whose server-entry activation is currently in progress. */
  private activating = new Set<string>();
  /** Sockets handed to plugins, per plugin id — closed 1001 on teardown. */
  private sockets = new Map<string, Set<WsSocketLike>>();

  /**
   * Open an activation window for a plugin. Only while the window is open may
   * the plugin's `registerWsRoute` calls succeed; the loader opens it around
   * the plugin's server entry, and re-activation (toggle off → on) opens a
   * fresh window so the plugin registers again.
   */
  beginActivation(pluginId: string): void {
    this.activating.add(pluginId);
  }

  /** Close the activation window (loader, after the server entry resolved). */
  endActivation(pluginId: string): void {
    this.activating.delete(pluginId);
  }

  /**
   * Register a WS route scope for `pluginId`. Throws on: registration outside
   * the plugin's activation window, duplicate scope (any plugin), overlapping
   * or nested `pathPrefix` (any plugin or a reserved core prefix), reserved
   * core scope names, and malformed scope/prefix.
   */
  register(pluginId: string, scope: string, opts: WsRouteRegistration): void {
    if (!this.activating.has(pluginId)) {
      throw new Error(
        `registerWsRoute(${scope}) outside activation: WS routes may only be registered during the plugin's server-entry activation`,
      );
    }
    if (typeof scope !== "string" || !KEBAB_SCOPE.test(scope)) {
      throw new Error(`registerWsRoute: invalid scope "${scope}" (kebab-case required)`);
    }
    if ((RESERVED_WS_SCOPES as readonly string[]).includes(scope)) {
      throw new Error(`registerWsRoute: scope "${scope}" is reserved for core WS routes`);
    }
    const pathPrefix = opts?.pathPrefix;
    if (typeof pathPrefix !== "string" || !PATH_PREFIX.test(pathPrefix)) {
      throw new Error(
        `registerWsRoute(${scope}): pathPrefix must be "/ws/<segment>/..." with a trailing slash, got "${pathPrefix}"`,
      );
    }
    if (typeof opts?.handleUpgrade !== "function") {
      throw new Error(`registerWsRoute(${scope}): handleUpgrade must be a function`);
    }
    if (!Array.isArray(opts?.admitOrigins)) {
      throw new Error(`registerWsRoute(${scope}): admitOrigins must be an array of strings`);
    }
    for (const reserved of RESERVED_WS_ROUTES) {
      const nested = reserved.exact
        ? pathPrefix === reserved.prefix
        : pathPrefix === reserved.prefix || pathPrefix.startsWith(reserved.prefix.endsWith("/") ? reserved.prefix : reserved.prefix + "/");
      if (nested) {
        throw new Error(
          `registerWsRoute(${scope}): pathPrefix "${pathPrefix}" collides with reserved core prefix "${reserved.prefix}"`,
        );
      }
    }
    if (this.byScope.has(scope)) {
      throw new Error(`registerWsRoute: scope "${scope}" is already registered`);
    }
    for (const existing of this.byScope.values()) {
      if (pathPrefix.startsWith(existing.pathPrefix) || existing.pathPrefix.startsWith(pathPrefix)) {
        throw new Error(
          `registerWsRoute(${scope}): pathPrefix "${pathPrefix}" overlaps "${existing.pathPrefix}" (scope "${existing.scope}")`,
        );
      }
    }
    this.byScope.set(scope, {
      pluginId,
      scope,
      pathPrefix,
      admitOrigins: [...opts.admitOrigins],
      handleUpgrade: opts.handleUpgrade,
    });
    this.tombstonedPrefixes.delete(pathPrefix);
  }

  /** The active registration for a scope, or undefined (never registered / torn down). */
  get(scope: string): Readonly<ActiveRegistration> | undefined {
    return this.byScope.get(scope);
  }

  /**
   * Map a WS request path (query stripped) to its ACTIVE plugin scope, or
   * null. Wired into `routeScopeForUrl` by the server; consulted only after
   * the four core prefixes, so a core path can never resolve here.
   */
  resolveScope(pathOnly: string): string | null {
    for (const reg of this.byScope.values()) {
      if (pathOnly.startsWith(reg.pathPrefix)) return reg.scope;
    }
    return null;
  }

  /** True when the path sits under a prefix whose plugin was torn down. */
  isTombstonedPath(url: string | undefined): boolean {
    if (!url) return false;
    const pathOnly = url.split("?")[0];
    for (const prefix of this.tombstonedPrefixes) {
      if (pathOnly.startsWith(prefix)) return true;
    }
    return false;
  }

  /**
   * Track a socket a plugin accepted (called via `meta.trackSocket`). Removed
   * again when the socket closes, so teardown only closes live sockets.
   */
  trackSocket(pluginId: string, ws: WsSocketLike): void {
    let set = this.sockets.get(pluginId);
    if (!set) {
      set = new Set();
      this.sockets.set(pluginId, set);
    }
    set.add(ws);
    try {
      ws.once("close", () => {
        set?.delete(ws);
      });
    } catch {
      /* a socket without event wiring is still closable */
    }
  }

  /**
   * Teardown for disable or activation failure (spec: plugin-ws-route
   * "Plugin disable tears down its routes"): close tracked sockets with 1001,
   * unregister the plugin's scopes, tombstone their prefixes, and close the
   * activation window. Idempotent — a no-op for a plugin that owns no routes.
   */
  teardownPlugin(pluginId: string): void {
    this.activating.delete(pluginId);
    const sockets = this.sockets.get(pluginId);
    if (sockets) {
      for (const ws of sockets) {
        try {
          ws.close(1001, "plugin disabled");
        } catch {
          /* a half-open socket must not block the rest of teardown */
        }
      }
      this.sockets.delete(pluginId);
    }
    for (const reg of this.byScope.values()) {
      if (reg.pluginId === pluginId) {
        this.byScope.delete(reg.scope);
        this.tombstonedPrefixes.add(reg.pathPrefix);
      }
    }
  }
}

let _registry: WsRouteRegistry | null = null;

/** Process-wide registry (loader, server upgrade handler, activation routes). */
export function getWsRouteRegistry(): WsRouteRegistry {
  if (!_registry) _registry = new WsRouteRegistry();
  return _registry;
}

/** Reset the singleton (tests). */
export function clearWsRouteRegistry(): void {
  _registry = null;
}
