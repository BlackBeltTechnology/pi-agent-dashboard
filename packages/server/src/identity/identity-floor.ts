/**
 * D24 signed-out floor. While identity is ENFORCED, every browser-facing road
 * requires a signed-in principal, localhost included (D23: loopback is not
 * identity). Only the pre-auth set stays reachable, and only same-user PROCESS
 * callers presenting the host-only local token (CLI, bridge) pass without a
 * principal. A device bearer is not a person (D2) and does not count.
 *
 * Scope: `/api/`, `/editor/`, `/live/`. The SPA shell, static assets, the
 * login plugin's own pages, `/auth/*`, the WS upgrade path and the model proxy
 * (`/v1/`, its own credential) are NOT governed here.
 *
 * Paths are parsed exactly like the network guard (`parseGuardTarget`): a
 * target is governed when EITHER its raw or dot-resolved form is, and public
 * only when BOTH are. Unparseable ⇒ governed (fail closed).
 */
import { parseGuardTarget } from "../auth/localhost-guard.js";

const FLOOR_PREFIXES = ["/api/", "/editor/", "/live/"] as const;
const PRE_AUTH_PATHS: ReadonlySet<string> = new Set(["/api/health", "/api/identity/login-config"]);

const governed = (p: string) => FLOOR_PREFIXES.some((prefix) => p.startsWith(prefix));

export function identityFloorAllows(input: {
  enforced: boolean;
  path: string;
  method: string;
  hasPrincipal: boolean;
  hasLocalToken: boolean;
}): boolean {
  if (!input.enforced || input.hasPrincipal || input.hasLocalToken) return true;
  const target = parseGuardTarget(input.path);
  if (!target) return false;
  if (!governed(target.raw) && !governed(target.resolved)) return true;
  const readOnly = input.method === "GET" || input.method === "HEAD";
  return readOnly && PRE_AUTH_PATHS.has(target.raw) && PRE_AUTH_PATHS.has(target.resolved);
}
