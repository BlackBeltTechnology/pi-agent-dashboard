/**
 * Local-proof headers for the dashboard skill's scripts.
 *
 * The strict `requireLocalProof` default refuses a bare-loopback caller on every non-observe route
 * (including the `/api/ws-ticket` mint the bus client starts with). A script running on the dashboard's
 * own host proves it by minting an `X-Pi-Local-Proof` from the local token, bound to the exact request.
 * The proof binds an address LITERAL, so scripts dial `127.0.0.1`, never `localhost` (`dialHost`).
 *
 * Node built-ins + the shared proof primitive only. No token (the dashboard never ran here) ⇒ `{}`.
 *
 * See change: close-container-loopback-impersonation (D5).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { httpProofHeaders, localDialHost } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";

function localToken(): string | null {
  try {
    return readFileSync(join(homedir(), ".pi", "dashboard", "local", "token"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The literal to dial for a configured host (`localhost` → `127.0.0.1`). */
export function dialHost(configured: string | undefined = process.env.DASHBOARD_HOST): string {
  return localDialHost(configured);
}

/** A `BusClient` `proofHeaders` provider. */
export function proofHeaders(method: string, url: string): Record<string, string> {
  const token = localToken();
  if (!token) return {};
  try {
    return httpProofHeaders(token, url, method);
  } catch {
    return {};
  }
}
