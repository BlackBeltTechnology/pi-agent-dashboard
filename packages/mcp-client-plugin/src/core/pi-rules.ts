/**
 * mcp-client-plugin · CORE mirror of pi's built-in MCP entry rules.
 *
 * pi 1.0.0 does not export `validateMcpServerConfig` (its exports map has
 * only `.`, `./rpc-entry`, `./client`, `./experimental/plugin`) and this
 * package has no pi dependency, so the checks are mirrored here from
 * `dist/core/mcp-servers.js` + `dist/extensions/mcp/config.js`. The writer
 * runs them before every write so it never persists an entry pi rejects.
 *
 * See change: migrate-mcp-to-pi-builtin (D3 "Validation").
 */

import { isPlainObject } from "./path-utils.js";

export const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];
/** Older exposure names pi still accepts and resolves. */
export const MCP_EXPOSURE_ALIASES: Readonly<Record<string, McpExposure>> = { "codemode-deferred": "codemode" };

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
/** Never usable as an object key (prototype pollution) — pi's regex alone admits `__proto__`. */
const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Adapter-only (`pi-mcp-adapter`) entry keys. pi ignores unknown keys, so these
 * stay in a file but have no effect under the built-in MCP. `disabled: true`
 * is the dangerous one: pi treats such a server as ENABLED.
 */
export const ADAPTER_ONLY_KEYS = [
  "disabled",
  "socket",
  "requestHeadersCommand",
  "bearerToken",
  "bearerTokenEnv",
  "bearerTokenStore",
  "lifecycle",
  "idleTimeout",
  "requestTimeoutMs",
  "exposeResources",
  "directTools",
  "toolPrefix",
  "includeTools",
  "excludeTools",
  "searchKeywords",
  "approveTools",
  "debug",
  "trace",
  "httpTransport",
  "pluginDataDir",
  "literalEnv",
  "protocolVersion",
  "inheritEnv",
  "caFile",
  "tasks",
] as const;

/** Letters, digits, `_`, `-` (pi's rule), ≤128 chars, never a prototype key. */
export function isValidServerName(name: string): boolean {
  return typeof name === "string" && name.length <= 128 && SERVER_NAME.test(name) && !FORBIDDEN_NAMES.has(name);
}

/** pi maps `-` to `_` for tool namespaces, so `a-b` and `a_b` collide. */
export function mcpNamespace(name: string): string {
  return `mcp__${name.replace(/-/g, "_")}`;
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname);
}

function isStringRecord(v: unknown): boolean {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === "string");
}

function isExposure(v: unknown): boolean {
  return typeof v === "string" && (MCP_EXPOSURES as readonly string[]).includes(v);
}

function resolveAlias(v: unknown): unknown {
  return typeof v === "string" ? (MCP_EXPOSURE_ALIASES[v] ?? v) : v;
}

/** Display form of an exposure value: aliases resolved, default `codemode`. */
export function displayExposure(v: unknown): string {
  const r = resolveAlias(v);
  return typeof r === "string" ? r : "codemode";
}

function isLoopbackRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" && isLoopbackHost(url.hostname) && url.search === "" && url.hash === "";
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return "oauth must be an object";
  if (value.clientId !== undefined && typeof value.clientId !== "string") return "oauth.clientId must be a string";
  if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
    return "oauth.clientSecret must be a string";
  }
  const port = value.callbackPort;
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) {
    return "oauth.callbackPort must be a port number";
  }
  if (value.callbackUrl !== undefined) {
    if (typeof value.callbackUrl !== "string" || !isLoopbackRedirectUri(value.callbackUrl)) {
      return "oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment";
    }
    const urlPort = new URL(value.callbackUrl).port;
    if (urlPort && port !== undefined && Number(urlPort) !== port) {
      return "oauth.callbackUrl and oauth.callbackPort name different ports";
    }
  }
  if (value.scope !== undefined && typeof value.scope !== "string") return "oauth.scope must be a string";
  if (value.clientName !== undefined && (typeof value.clientName !== "string" || !value.clientName.trim())) {
    return "oauth.clientName must be a non-empty string";
  }
  const meta = value.authServerMetadataUrl;
  if (meta !== undefined) {
    const url = typeof meta === "string" && URL.canParse(meta) ? new URL(meta) : undefined;
    if (!url || !(url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)))) {
      return "oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]";
    }
  }
  return undefined;
}

/**
 * Mirror of pi 1.0.0 `validateMcpServerConfig(name, raw)`: `null` when pi
 * accepts the entry, else pi's error message.
 */
export function validatePiEntry(name: string, raw: unknown): string | null {
  if (!SERVER_NAME.test(name)) return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  if (!isPlainObject(raw)) return `server "${name}" must be an object`;
  const v = raw as Record<string, unknown>;
  const exposure = resolveAlias(v.exposure);
  const exposures = MCP_EXPOSURES.map((e) => `"${e}"`).join(", ");
  if (v.exposure !== undefined && !isExposure(exposure)) return `server "${name}": exposure must be one of ${exposures}`;
  if (v.toolExposure !== undefined) {
    if (!isPlainObject(v.toolExposure)) return `server "${name}": toolExposure must map tool names to exposures`;
    for (const [tool, e] of Object.entries(v.toolExposure)) {
      if (!isExposure(resolveAlias(e))) return `server "${name}": toolExposure "${tool}" must be one of ${exposures}`;
    }
  }
  if (v.enabled !== undefined && typeof v.enabled !== "boolean") return `server "${name}": enabled must be a boolean`;
  if (v.description !== undefined && typeof v.description !== "string") {
    return `server "${name}": description must be a string`;
  }
  if (v.timeout !== undefined && (typeof v.timeout !== "number" || !(v.timeout > 0))) {
    return `server "${name}": timeout must be a positive number of seconds`;
  }
  const type = v.type;
  if (type === "sse") return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;
  if (typeof v.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    if (!URL.canParse(v.url) || !/^https?:$/.test(new URL(v.url).protocol)) {
      return `server "${name}": url must be an http or https URL`;
    }
    if (v.headers !== undefined && !isStringRecord(v.headers)) return `server "${name}": headers must map names to strings`;
    const oauthError = validateOAuth(v.oauth);
    if (oauthError) return `server "${name}": ${oauthError}`;
    if (v.auth !== undefined) {
      if (!isPlainObject(v.auth) || typeof v.auth.provider !== "string" || !v.auth.provider) {
        return `server "${name}": auth.provider must be a provider name`;
      }
      const url = new URL(v.url);
      if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
        return `server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`;
      }
    }
    return null;
  }
  if (typeof v.command === "string" && (type === undefined || type === "stdio")) {
    if (v.args !== undefined && !(Array.isArray(v.args) && v.args.every((a) => typeof a === "string"))) {
      return `server "${name}": args must be an array of strings`;
    }
    if (v.env !== undefined && !isStringRecord(v.env)) return `server "${name}": env must map names to strings`;
    if (v.cwd !== undefined && typeof v.cwd !== "string") return `server "${name}": cwd must be a string`;
    return null;
  }
  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

/** The transport pi picks: HTTP when `url` is set unless `type` is `stdio`. */
export function transportOf(entry: Record<string, unknown>): "stdio" | "http" {
  if (typeof entry.url === "string" && entry.type !== "stdio") return "http";
  return "stdio";
}

/** Adapter-only keys present on an entry (plus non-object `auth` / `oauth: false`). */
export function adapterLeftovers(entry: Record<string, unknown>): string[] {
  const keys: string[] = ADAPTER_ONLY_KEYS.filter((k) => Object.hasOwn(entry, k));
  if (entry.auth !== undefined && !isPlainObject(entry.auth)) keys.push("auth");
  if (entry.oauth === false) keys.push("oauth");
  return keys;
}

/** Keys pi ignores on this entry: adapter leftovers + the losing key of a dual transport. */
export function ignoredKeys(entry: Record<string, unknown>): string[] {
  const keys = adapterLeftovers(entry);
  if (typeof entry.command === "string" && typeof entry.url === "string") {
    keys.push(transportOf(entry) === "http" ? "command" : "url");
  }
  return keys;
}

export type AuthMode = { kind: "provider"; provider: string } | { kind: "header" } | { kind: "oauth" };

/** How pi authenticates an HTTP entry; `undefined` for stdio. */
export function authModeOf(entry: Record<string, unknown>): AuthMode | undefined {
  if (transportOf(entry) !== "http") return undefined;
  if (isPlainObject(entry.auth) && typeof entry.auth.provider === "string" && entry.auth.provider) {
    return { kind: "provider", provider: entry.auth.provider };
  }
  if (isPlainObject(entry.headers) && Object.keys(entry.headers).some((k) => k.toLowerCase() === "authorization")) {
    return { kind: "header" };
  }
  return { kind: "oauth" };
}
