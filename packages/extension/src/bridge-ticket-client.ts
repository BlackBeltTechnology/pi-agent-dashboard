/**
 * Minting the credential a REMOTE bridge needs to open a gateway connection.
 *
 * Section 6 made bridge authentication mandatory on the TCP listener, but
 * nothing on this side could produce a credential — the lock shipped without
 * the key, and every bridge outside the dashboard's host (the documented
 * `PI_WORKSPACES` docker layout, where `PI_GATEWAY_PORT` exists precisely for
 * "external pi sessions") was refused with `no-ticket` and had no remedy.
 *
 * The durable half of the credential is a PAIRED-DEVICE bearer, obtained once
 * through the existing pairing flow and supplied here. The per-connection half
 * is a single-use, scope-bound, 15s ticket minted from it. The bearer is never
 * sent to the gateway — only the short-lived ticket is, so a captured upgrade
 * URL expires almost immediately and cannot be replayed.
 *
 * See change: add-pi-gateway-transport-identity (D10b).
 */

/** Env var carrying a paired-device bearer for the dashboard being dialled. */
export const DEVICE_TOKEN_ENV = "PI_DASHBOARD_TOKEN";

type TicketMintCause =
  | "no-token"
  | "unreachable"
  | "refused"
  | "malformed";

export type TicketMintResult =
  | { ok: true; ticket: string }
  | { ok: false; cause: TicketMintCause; reason: string };

/**
 * The bearer for a remote dashboard. Env only, deliberately: a bearer is a
 * durable credential, and inventing a second on-disk store for it here would
 * duplicate the pairing flow's own record without its revocation path.
 */
export function readDeviceToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[DEVICE_TOKEN_ENV];
  const token = raw?.trim();
  return token ? token : undefined;
}

/**
 * Exchange the durable bearer for a single-use, bridge-scoped ticket.
 *
 * Every failure collapses to a refusal with a named cause: a bridge that
 * cannot mint must not fall back to dialling unauthenticated, because the
 * server would refuse it anyway and the operator would see a connection error
 * instead of a credential error.
 */
export async function mintBridgeTicket(input: {
  httpBase: string;
  token: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<TicketMintResult> {
  if (!input.token) {
    return {
      ok: false,
      cause: "no-token",
      reason: `no paired-device bearer: set ${DEVICE_TOKEN_ENV} to a token from this dashboard's pairing flow`,
    };
  }
  const doFetch = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${input.httpBase}/api/ws-ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({ scope: "bridge" }),
    });
  } catch (err) {
    return { ok: false, cause: "unreachable", reason: `ticket mint failed: ${(err as Error).message}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      cause: "refused",
      reason: `ticket mint refused with HTTP ${res.status} — the bearer may be unpaired or revoked`,
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, cause: "malformed", reason: "ticket mint returned a non-JSON body" };
  }
  const ticket = (body as { data?: { ticket?: unknown } })?.data?.ticket;
  if (typeof ticket !== "string" || ticket.length === 0) {
    return { ok: false, cause: "malformed", reason: "ticket mint returned no ticket" };
  }
  return { ok: true, ticket };
}

/**
 * Carry the ticket on the upgrade URL. The gateway also accepts it via
 * `sec-websocket-protocol`; the query form is used because it survives the
 * `ws+unix:` / `ws:` URL handling already in place.
 */
export function withTicket(url: string, ticket: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ticket=${encodeURIComponent(ticket)}`;
}
