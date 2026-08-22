/**
 * The bridge's local credential for a loopback TCP gateway (D6, task 5.3).
 *
 * Windows has no unix-socket transport, so its local bridge dials
 * `127.0.0.1:<piPort>` — and an address is not a credential. The dashboard
 * writes `~/.pi/dashboard/local/token` readable only by the same OS user; a
 * bridge that can read it proves same-user, which is exactly the entitlement
 * the socket's `0600` mode proves on POSIX.
 *
 * Scope is deliberately narrow: the token rides ONLY a loopback TCP dial. Over
 * a unix socket it is redundant, and to a remote endpoint it would be a secret
 * leak — the remote path authenticates with a ticket and a pinned identity
 * instead (D7/D8).
 *
 * See change: add-pi-gateway-transport-identity (D6).
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isRemoteEndpoint } from "./remote-registration-gate.js";

/** Header name; matches the server's `LOCAL_TOKEN_HEADER` (case-insensitive). */
const LOCAL_TOKEN_HEADER = "X-Pi-Local-Token";

/** Read this HOME's local token, or `undefined` when there is none to present. */
export function readLocalToken(env?: { homedir?: string }): string | undefined {
  try {
    const value = fs.readFileSync(path.join(getDashboardConfigDir(env), "local", "token"), "utf-8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Upgrade headers for `endpoint`, or `undefined` when none should be sent. */
export function localTokenHeaders(
  endpoint: string,
  env?: { homedir?: string },
): Record<string, string> | undefined {
  if (endpoint.startsWith("ws+unix:")) return undefined;
  if (isRemoteEndpoint(endpoint)) return undefined;
  const token = readLocalToken(env);
  return token ? { [LOCAL_TOKEN_HEADER]: token } : undefined;
}
