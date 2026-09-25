/**
 * Core browser-login gate decision logic (D16). Pure of React + DOM so it
 * unit-tests directly. Core owns exactly three things here: which provider may
 * mount (trust-bound, by pluginId — never priority), where a post-login
 * navigation is allowed to land (open-redirect defence), and nothing about OIDC.
 *
 * The resolver plugin owns all OIDC mechanics (see keycloak-resolver-plugin);
 * this module never imports discovery/PKCE/token code.
 */

import type React from "react";

/** Minimal shape of a generated `PLUGIN_REGISTRY` entry this gate reads. */
export interface LoginRegistryEntry {
  manifest: { id: string };
  claims: ReadonlyArray<{
    slot: string;
    pluginId: string;
    Component?: React.ComponentType<unknown>;
  }>;
}

/**
 * Resolve a post-login return target that is safe to navigate to (F1/H6).
 *
 * Accepted only when it resolves — against the current origin — to the SAME
 * origin AND a pathname that is neither the callback route nor the dead legacy
 * login banner. Everything else (absolute URLs, scheme-relative `//host`,
 * backslash `/\host` — which the URL parser normalises to `//host` — callback
 * recursion, `/auth/login` re-entry) collapses to `"/"`. Query + hash of a
 * same-origin deep link are preserved so `/session/abc?tab=x` round-trips.
 */
export function safeReturnTo(raw: string | null | undefined, origin: string): string {
  if (!raw) return "/";
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  if (url.pathname === "/callback" || url.pathname === "/auth/login") return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Select the login-provider component core may mount (B3/F6/LG-5/LG-7/LG-17).
 *
 * Selection is by EXACT `pluginId` match against the id the host vouched for in
 * `GET /api/identity/login-config` — never by manifest priority. The host only
 * ever registers a *trusted* resolver's descriptor (trust is a host-owned grant,
 * D4), so matching that id is what binds the mount to trust: an untrusted plugin
 * that also claims `login-provider`, even at higher priority, is never the id
 * the host returned and so is never selected. A disabled plugin contributes
 * nothing (enable-filter, B5). Returns `null` when login is inactive
 * (`configPluginId` absent) or the owning plugin is absent/disabled/unclaimed.
 */
export function selectLoginProvider(opts: {
  registry: ReadonlyArray<LoginRegistryEntry>;
  configPluginId: string | undefined;
  isEnabled: (pluginId: string) => boolean;
}): React.ComponentType<unknown> | null {
  const { registry, configPluginId, isEnabled } = opts;
  if (!configPluginId) return null;
  if (!isEnabled(configPluginId)) return null;
  const entry = registry.find((e) => e.manifest.id === configPluginId);
  if (!entry) return null;
  const claim = entry.claims.find((c) => c.slot === "login-provider");
  return claim?.Component ?? null;
}

/**
 * Validate a SEPARATE-VIEW provider URL (D19) — same-origin path only.
 *
 * A plugin advertises `loginUrl`/`logoutUrl` and core redirects the browser
 * there, so this is an open-redirect boundary: only a same-origin path
 * survives. Absolute URLs, scheme-relative `//host`, and backslash `/\host`
 * (which the URL parser normalises to `//host`) all collapse to `null`, as do
 * core's own gate routes (`/callback`, `/logout`) — pointing a redirect at
 * them would loop.
 */
export function providerRedirect(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname === "/callback" || url.pathname === "/logout") return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Resolve the redirect core issues for a gate phase, or `null` to mount the
 * bundled `login-provider` component instead (D19).
 *
 * `start` → `loginUrl`; `logout` → `logoutUrl` ONLY (never falling back to
 * `loginUrl` — signing out must not sign straight back in); `callback` → the
 * plugin owns its own callback, so a stray hit recovers to `loginUrl`.
 */
export function resolveGateRedirect(
  phase: "start" | "callback" | "logout",
  urls: { loginUrl?: string; logoutUrl?: string },
  origin: string,
): string | null {
  if (phase === "logout") return providerRedirect(urls.logoutUrl, origin);
  return providerRedirect(urls.loginUrl, origin);
}
