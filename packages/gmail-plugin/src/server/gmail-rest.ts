/**
 * Google token revocation (design D9). Best effort: bounded by a 5 s timeout,
 * never throws, never logs the token. See change: add-gmail-plugin.
 */
import type { GoogleEndpoints } from "../shared/endpoints.js";

const REVOKE_TIMEOUT_MS = 5_000;

/** POST the token to Google's revoke endpoint. Resolves `true` on HTTP 200. */
export async function revokeToken(
  endpoints: GoogleEndpoints,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetchImpl(endpoints.revoke, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
