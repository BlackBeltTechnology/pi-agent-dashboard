/**
 * A gateway credential for specs that dial the bridge port directly.
 *
 * These specs run on the HOST and reach the container through a published
 * port, so the gateway sees the docker bridge address — not loopback. Since
 * bridge authentication became mandatory on the TCP listener, such a peer is
 * "remote" and must present a single-use, bridge-scoped ticket; without one
 * the upgrade is refused with 401 and the spec fails with a bare socket error.
 *
 * This drives the REAL pairing flow rather than installing a test backdoor:
 * redeem a pairing code, approve it, collect the durable device bearer, then
 * exchange it for a ticket. A spec therefore exercises the same path an
 * external pi session takes.
 *
 * See change: add-pi-gateway-transport-identity (D10b).
 */

async function postJson(base: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Pair once and return the durable device bearer. */
export async function pairDeviceBearer(dashboardBase: string): Promise<string> {
  const payload = await (await fetch(`${dashboardBase}/api/pair/payload`)).json();
  const code = payload?.data?.code;
  if (!code) throw new Error(`pairing payload had no code: ${JSON.stringify(payload)}`);

  const redeemed = await postJson(dashboardBase, "/api/pair/redeem", { code });
  const { pendingId, confirmCode } = redeemed?.data ?? {};
  if (!pendingId) throw new Error(`redeem failed: ${JSON.stringify(redeemed)}`);

  const approved = await postJson(dashboardBase, "/api/pair/approve", {
    code,
    confirmCode,
    label: "e2e-bridge",
  });
  if (!approved?.success) throw new Error(`approve failed: ${JSON.stringify(approved)}`);

  const polled = await postJson(dashboardBase, "/api/pair/poll", { pendingId });
  const token = polled?.data?.token;
  if (!token) throw new Error(`poll returned no token: ${JSON.stringify(polled)}`);
  return token;
}

/**
 * A gateway URL carrying a FRESH ticket. Tickets are single-use with a short
 * TTL, so call this per connection — reusing one is a 401, not a flake.
 */
export async function gatewayUrlWithTicket(
  dashboardBase: string,
  gatewayPort: number,
  bearer: string,
): Promise<string> {
  const res = await fetch(`${dashboardBase}/api/ws-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ scope: "bridge" }),
  });
  const body = await res.json();
  const ticket = body?.data?.ticket;
  if (!ticket) throw new Error(`ticket mint failed (${res.status}): ${JSON.stringify(body)}`);
  return `ws://127.0.0.1:${gatewayPort}?ticket=${encodeURIComponent(ticket)}`;
}
