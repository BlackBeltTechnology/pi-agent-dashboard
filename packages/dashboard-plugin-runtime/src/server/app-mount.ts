/**
 * Plugin static-app mounts (`ctx.serveApp`): `GET|HEAD /apps/<appId>` (308) and
 * `/apps/<appId>/*` serving a realpath-confined directory with an extension
 * allowlist, an `index.html` SPA fallback, precompressed `.gz` negotiation, an
 * enforced per-response CSP and optional cross-origin-frame headers.
 *
 * The TRUST decision (is this plugin allowed to mount at all) is the host's: it
 * calls `mountApp` only for a trusted plugin. This module owns everything after
 * that — id/dir validation, the mount registry (read by the auth plugin and the
 * namespace-coverage test) and the request handler.
 *
 * Guardrails against accidents, not a boundary against a malicious in-process
 * plugin (which holds the root Fastify instance anyway).
 *
 * See change: add-plugin-capability-routes (D5, D7), edit-office-in-pane-with-craft-web (D3).
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PluginLogger } from "../plugin-context.js";

/** Policy for a mount's responses: fixed, or computed per request (names the public origin). */
export type ServeAppCsp = string | ((request: FastifyRequest) => string);

/** Options a plugin passes to `ctx.serveApp`. */
export interface ServeAppOptions {
  /** Directory to serve. Must realpath inside the plugin package root or `ctx.dataDir`; may be absent until provisioned. */
  dir: string;
  /** REQUIRED enforced `Content-Security-Policy` for every file response. */
  csp: ServeAppCsp;
  /** Mount id (`/apps/<appId>/`). Defaults to the plugin id; `^[a-z0-9-]+$`, unique. */
  appId?: string;
  /** Add `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` (never credentials). */
  crossOriginFrame?: boolean;
  /**
   * Extra file extensions to serve beyond the built-in allowlist, each as INERT data only:
   * `{ ".txt": "text/plain; charset=utf-8", ".part-aa": "application/octet-stream" }`. Keys
   * `^\.[a-z0-9][a-z0-9-]{0,15}$`, not already allowlisted; values from {@link EXTRA_TYPE_VALUES}.
   * See change: extend-craft-web-to-all-apps (a web build that fetches split wasm parts).
   */
  extraTypes?: Readonly<Record<string, string>>;
}

/** The only content types `extraTypes` may assign: never executable or renderable as a document. */
export const EXTRA_TYPE_VALUES: ReadonlySet<string> = new Set(["text/plain; charset=utf-8", "application/octet-stream"]);
const EXTRA_EXT = /^\.[a-z0-9][a-z0-9-]{0,15}$/;

export interface AppMountRecord {
  appId: string;
  pluginId: string;
  /** `/apps/<appId>` (no trailing slash). */
  prefix: string;
}

const APP_ID = /^[a-z0-9-]+$/;
const MOUNT_BASE = "/apps/";

/** Extension allowlist → content type. Everything else (`.json`, `.map`, `.gz`, …) is refused. */
const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** Content-hashed name: `app.3f9a.js`, `index-DQ3x9a1B.js`, `x-1a2b3c4d_bg.wasm` (hash token holds a digit). */
const HASHED_NAME = /[.-](?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,}(?:_bg)?\.[a-z0-9]+$/;

const IMMUTABLE = "public, max-age=31536000, immutable";

// ── Registry ────────────────────────────────────────────────────────────────

/**
 * Process-wide record of `serveApp` mounts. The auth plugin skips a mounted
 * path; the namespace-coverage test passes only routes it covers. Singleton
 * (`getAppMountRegistry`), mirroring `getWsRouteRegistry`.
 */
export class AppMountRegistry {
  private byId = new Map<string, AppMountRecord>();

  has(appId: string): boolean {
    return this.byId.has(appId);
  }

  /** Record a mount; a second mount of the same id throws. */
  add(record: AppMountRecord): void {
    if (this.byId.has(record.appId)) {
      throw new Error(`serveApp: appId "${record.appId}" is already mounted`);
    }
    this.byId.set(record.appId, record);
  }

  list(): AppMountRecord[] {
    return [...this.byId.values()];
  }

  /** True when a request URL (query allowed) is the mount path or sits under it. */
  isMountPath(url: string): boolean {
    const pathname = url.split(/[?#]/, 1)[0];
    return this.coversRoute(pathname);
  }

  /** True when a ROUTE url (`/apps/<id>`, `/apps/<id>/*`) belongs to a registered mount (prefix match). */
  coversRoute(routeUrl: string): boolean {
    for (const m of this.byId.values()) {
      if (routeUrl === m.prefix || routeUrl.startsWith(`${m.prefix}/`)) return true;
    }
    return false;
  }

  clear(): void {
    this.byId.clear();
  }
}

let _registry: AppMountRegistry | null = null;

/** Process-wide mount registry (auth plugin, coverage test, `mountApp`). */
export function getAppMountRegistry(): AppMountRegistry {
  if (!_registry) _registry = new AppMountRegistry();
  return _registry;
}

/** Reset the singleton (tests). */
export function clearAppMountRegistry(): void {
  _registry = null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isWithin(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** `realpath` of the deepest existing ancestor + the not-yet-existing tail (a `dir` may be absent). */
function canonicalize(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  return value.split(",").some((part) => {
    const [name, ...params] = part.trim().split(";");
    if (name.trim().toLowerCase() !== "gzip") return false;
    const q = params.map((s) => s.trim()).find((s) => s.startsWith("q="));
    return q === undefined || Number.parseFloat(q.slice(2)) > 0;
  });
}

function realFileWithin(file: string, root: string): { real: string; size: number } | null {
  try {
    const real = fs.realpathSync(file);
    if (!isWithin(real, root)) return null;
    const st = fs.statSync(real);
    return st.isFile() ? { real, size: st.size } : null;
  } catch {
    return null;
  }
}

/** Everything `mountApp` needs from the host, bound to one plugin. */
export interface MountAppEnv {
  fastify: FastifyInstance;
  pluginId: string;
  /** The plugin's package directory (confinement root #1). */
  packageRoot: string;
  /** The plugin's data directory (confinement root #2). */
  dataDir: string;
  logger: PluginLogger;
  /** Defaults to the process-wide registry. */
  registry?: AppMountRegistry;
}

// ── Request pipeline helpers (pure) ─────────────────────────────────────────

/** Decoded path segments under the mount, or null when the request must be refused (NUL, `\\`, bad escape, dotfile / `..`). */
function parseSegments(rawPath: string, prefix: string, types: Readonly<Record<string, string>>): string[] | null {
  if (!rawPath.startsWith(`${prefix}/`)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath.slice(prefix.length + 1));
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((s) => s !== "");
  // Dotfiles and any `.`/`..` segment: never served, never resolved.
  if (segments.some((s) => s.startsWith("."))) return null;
  const ext = path.extname(segments[segments.length - 1] ?? "").toLowerCase();
  if (ext && !types[ext]) return null;
  return segments;
}

type Resolved = { kind: "index" } | { kind: "file"; real: string } | { kind: "notfound" };

/** Map segments to the file to serve under `root`: shell for the root / an unmatched client route, a 404 for everything unsafe. */
function resolveTarget(root: string, segments: string[]): Resolved {
  if (segments.length === 0) return { kind: "index" };
  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  let real: string;
  try {
    real = fs.realpathSync(path.join(root, ...segments));
  } catch {
    // Nothing there: an extensionless path is a client-side route (shell); a missing asset is a 404.
    return ext ? { kind: "notfound" } : { kind: "index" };
  }
  if (!isWithin(real, root)) return { kind: "notfound" }; // symlink escape
  return realFileWithin(real, root) ? { kind: "file", real } : { kind: "notfound" }; // directories never served
}

/** The file variant to send: the `.gz` sibling for a gzip client, else the plain file. `null` → not servable. */
function pickVariant(
  real: string,
  root: string,
  acceptEncoding: string | string[] | undefined,
): { file: { real: string; size: number }; gzipped: boolean; hasVariant: boolean } | null {
  const plain = realFileWithin(real, root);
  if (!plain) return null;
  const gz = realFileWithin(`${real}.gz`, root);
  if (gz && acceptsGzip(acceptEncoding)) return { file: gz, gzipped: true, hasVariant: true };
  return { file: plain, gzipped: false, hasVariant: gz !== null };
}

function evaluateCsp(csp: ServeAppCsp, request: FastifyRequest): string {
  const policy = typeof csp === "function" ? csp(request) : csp;
  if (typeof policy !== "string" || policy === "" || /[\r\n]/.test(policy)) throw new Error("invalid policy value");
  return policy;
}

function cacheControl(real: string, isIndex: boolean): string {
  if (isIndex) return "no-store";
  return HASHED_NAME.test(path.basename(real)) ? IMMUTABLE : "no-cache";
}

interface FileHeaders {
  type: string;
  policy: string;
  real: string;
  isIndex: boolean;
  variant: { file: { size: number }; gzipped: boolean; hasVariant: boolean };
  crossOriginFrame: boolean;
}

function setFileHeaders(reply: FastifyReply, h: FileHeaders): void {
  if (h.variant.hasVariant) {
    // `Vary` whenever a precompressed variant exists, even if this client takes the plain file.
    const vary = reply.getHeader("vary");
    reply.header("Vary", vary ? `${String(vary)}, Accept-Encoding` : "Accept-Encoding");
  }
  if (h.variant.gzipped) reply.header("Content-Encoding", "gzip");
  reply
    .header("Content-Type", h.type)
    .header("Content-Length", h.variant.file.size)
    .header("Cache-Control", cacheControl(h.real, h.isIndex))
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Security-Policy", h.policy);
  if (h.crossOriginFrame) {
    // CORS-mode module/preload/wasm loads from an opaque-origin sandboxed frame. Public bytes; never credentials.
    reply
      .header("Access-Control-Allow-Origin", "*")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .removeHeader("Access-Control-Allow-Credentials");
  }
}

// ── Mount ───────────────────────────────────────────────────────────────────

/**
 * Validate and register one app mount. Throws on a bad `appId`, a duplicate id,
 * a missing/odd `csp`, or a `dir` outside the package root and `dataDir`; on a
 * throw nothing is mounted. `dir` need not exist yet: requests get 503 until it does.
 */
function validateMount(
  env: MountAppEnv,
  opts: ServeAppOptions,
  registry: AppMountRegistry,
): { appId: string; roots: string[]; types: Readonly<Record<string, string>> } {
  if (!opts || typeof opts !== "object") throw new Error("serveApp: options object required");
  const appId = opts.appId ?? env.pluginId;
  if (typeof appId !== "string" || !APP_ID.test(appId)) {
    throw new Error(`serveApp: invalid appId "${String(appId)}" (must match ^[a-z0-9-]+$)`);
  }
  if (typeof opts.csp !== "function" && (typeof opts.csp !== "string" || opts.csp.trim() === "")) {
    throw new Error("serveApp: csp is required (a non-empty string or a function of the request)");
  }
  if (typeof opts.dir !== "string" || opts.dir === "") throw new Error("serveApp: dir is required");
  const roots = [canonicalize(env.packageRoot), canonicalize(env.dataDir)];
  const dir = canonicalize(opts.dir);
  if (!roots.some((r) => isWithin(dir, r))) {
    throw new Error(`serveApp: dir "${opts.dir}" must be inside the plugin package or its data directory`);
  }
  if (registry.has(appId)) throw new Error(`serveApp: appId "${appId}" is already mounted`);
  return { appId, roots, types: mountTypes(opts.extraTypes) };
}

/** Built-in allowlist + validated `extraTypes` (throws on a bad key or a non-inert type). */
function mountTypes(extra: ServeAppOptions["extraTypes"]): Readonly<Record<string, string>> {
  if (extra === undefined) return MIME;
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("serveApp: extraTypes must be an object");
  const out: Record<string, string> = { ...MIME };
  for (const [ext, type] of Object.entries(extra)) {
    if (!EXTRA_EXT.test(ext) || Object.hasOwn(MIME, ext)) throw new Error(`serveApp: extraTypes key "${ext}" is not a new lower-case extension`);
    if (!EXTRA_TYPE_VALUES.has(type)) throw new Error(`serveApp: extraTypes "${ext}" type "${type}" is not an inert data type`);
    out[ext] = type;
  }
  return out;
}

export function mountApp(env: MountAppEnv, opts: ServeAppOptions): void {
  const { fastify, logger } = env;
  const registry = env.registry ?? getAppMountRegistry();
  const { appId, roots, types } = validateMount(env, opts, registry);
  const prefix = `${MOUNT_BASE}${appId}`;
  const { csp } = opts;
  const crossOriginFrame = opts.crossOriginFrame === true;
  const warned = { missing: false, escape: false, csp: false };

  const text = (reply: FastifyReply, code: number, body: string): void => {
    void reply.code(code).header("Content-Type", "text/plain; charset=utf-8").header("Cache-Control", "no-store").send(body);
  };
  const notFound = (reply: FastifyReply): void => text(reply.header("X-Content-Type-Options", "nosniff"), 404, "Not found");
  const missingBuild = (reply: FastifyReply): void => {
    if (!warned.missing) {
      warned.missing = true;
      logger.warn(`serveApp(${appId}): build missing at "${opts.dir}"; answering 503 until it exists`);
    }
    text(reply.header("Retry-After", "5"), 503, `${appId} build missing`);
  };

  /** Resolve the served root per request, so a `current` symlink swap takes effect. Null → a response was sent. */
  const resolveRoot = (reply: FastifyReply): string | null => {
    let root: string;
    try {
      root = fs.realpathSync(opts.dir);
    } catch {
      missingBuild(reply);
      return null;
    }
    if (roots.some((r) => isWithin(root, r))) return root;
    if (!warned.escape) {
      warned.escape = true;
      logger.warn(`serveApp(${appId}): dir now resolves outside the plugin package and data directory; refusing`);
    }
    notFound(reply);
    return null;
  };

  const sendFile = (request: FastifyRequest, reply: FastifyReply, root: string, real: string, isIndex: boolean): void => {
    const type = types[path.extname(real).toLowerCase()];
    const variant = type ? pickVariant(real, root, request.headers["accept-encoding"]) : null;
    if (!type || !variant) return notFound(reply);
    let policy: string;
    try {
      policy = evaluateCsp(csp, request);
    } catch (err) {
      if (!warned.csp) {
        warned.csp = true;
        logger.error(`serveApp(${appId}): csp threw; answering 500`, err);
      }
      return text(reply, 500, "app policy error");
    }
    warned.missing = false;
    setFileHeaders(reply, { type, policy, real, isIndex, variant, crossOriginFrame });
    void reply.send(request.method === "HEAD" ? undefined : fs.createReadStream(variant.file.real));
  };

  const serveIndex = (request: FastifyRequest, reply: FastifyReply, root: string): void => {
    const idx = realFileWithin(path.join(root, "index.html"), root);
    if (!idx) return missingBuild(reply);
    sendFile(request, reply, root, idx.real, true);
  };

  // `compress:false` keeps the global @fastify/compress hook off these responses (no `.br`, stable Content-Length).
  const routeExtras: Record<string, unknown> = { compress: false };

  fastify.route({
    method: ["GET", "HEAD"],
    url: prefix,
    ...routeExtras,
    handler: (request, reply) => {
      const raw = request.raw.url ?? "";
      const qi = raw.indexOf("?");
      return reply.redirect(`${prefix}/${qi >= 0 ? raw.slice(qi) : ""}`, 308);
    },
  });

  fastify.route({
    method: ["GET", "HEAD"],
    url: `${prefix}/*`,
    ...routeExtras,
    handler: (request, reply) => {
      const segments = parseSegments((request.raw.url ?? "").split(/[?#]/, 1)[0], prefix, types);
      if (segments === null) return notFound(reply);
      const root = resolveRoot(reply);
      if (root === null) return;
      const target = resolveTarget(root, segments);
      if (target.kind === "notfound") return notFound(reply);
      if (target.kind === "index") return serveIndex(request, reply, root);
      sendFile(request, reply, root, target.real, path.basename(target.real) === "index.html" && path.dirname(target.real) === root);
    },
  });

  registry.add({ appId, pluginId: env.pluginId, prefix });
}
