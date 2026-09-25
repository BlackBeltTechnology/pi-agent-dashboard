/**
 * §11.2 — the multi-user identity plane enforced END-TO-END in the wired server,
 * over real HTTP + WebSocket, against an identity-ACTIVE harness.
 *
 * The resolver plugin's token verification (real OIDC discovery + JWKS + RS256)
 * is proved without Docker in
 * `packages/keycloak-resolver-plugin/src/server/__tests__/fake-issuer-integration.test.ts`.
 * The owner-gate predicate + snapshot filter are unit-tested in
 * `packages/server/src/identity/__tests__/`. What ONLY a booted server can prove
 * — and this spec covers — is the INTEGRATION seam: the resolver hook resolving a
 * bearer over real HTTP, the ws-ticket binding a principal, the §9.2 upgrade
 * gate, and per-principal owner filtering of the list/bootstrap/detail roads.
 *
 * No browser: an active resolver refuses ordinary browser sockets (§9.2), so
 * these drive raw HTTP + `ws` with bearers minted from the in-container fake
 * OIDC issuer (host-mapped POST /mint). Owned sessions are seeded ended
 * (scripts/seed-identity-sessions.mjs) so the split is deterministic and fast.
 */
import { expect, test } from "@playwright/test";
import WebSocket from "ws";
import { mintToken } from "../helpers/identity-tokens.js";
import { ANNA_SESSION_ID, BELA_SESSION_ID, IDENTITY_ISSUER_URL } from "./identity-lifecycle.js";

function dashboardBase(): string {
  const port = process.env.PW_E2E_PORT ?? "18000";
  return `http://localhost:${port}`;
}

function wsBase(): string {
  return dashboardBase().replace(/^http/, "ws");
}

/** Session ids present in a `GET /api/sessions` response body. */
async function listSessionIds(headers: Record<string, string>): Promise<string[]> {
  const res = await fetch(`${dashboardBase()}/api/sessions`, { headers });
  expect(res.ok).toBeTruthy();
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((s) => s.id);
}

/** Mint a WS ticket (browser scope) bound to the bearer's principal, or fail. */
async function mintTicket(token: string): Promise<string> {
  const res = await fetch(`${dashboardBase()}/api/ws-ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "browser" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data?: { ticket?: string } };
  const ticket = body.data?.ticket;
  if (!ticket) throw new Error("ws-ticket returned no ticket");
  return ticket;
}

/** Open `/ws` with a ticket and resolve the first `sessions_snapshot` frame. */
function firstSnapshot(ticket: string): Promise<{ sessions: { id: string }[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase()}/ws?ticket=${encodeURIComponent(ticket)}`, {
      headers: { Origin: dashboardBase() },
    });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("no sessions_snapshot within 15s"));
    }, 15_000);
    ws.on("message", (raw) => {
      let msg: { type?: string; sessions?: { id: string }[] };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "sessions_snapshot") {
        clearTimeout(timer);
        ws.close();
        resolve({ sessions: msg.sessions ?? [] });
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`ws upgrade refused: ${res.statusCode}`));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test.describe("§11.2 identity plane — two-user isolation (identity-active)", () => {
  let annaToken = "";
  let belaToken = "";

  test.beforeAll(async () => {
    annaToken = await mintToken("anna");
    belaToken = await mintToken("bela");
  });

  test("HTTP list is owner-scoped — Anna sees only her session", async () => {
    const ids = await listSessionIds({ Authorization: `Bearer ${annaToken}` });
    expect(ids).toContain(ANNA_SESSION_ID);
    expect(ids).not.toContain(BELA_SESSION_ID);
  });

  test("HTTP list is owner-scoped — Béla sees only his session", async () => {
    const ids = await listSessionIds({ Authorization: `Bearer ${belaToken}` });
    expect(ids).toContain(BELA_SESSION_ID);
    expect(ids).not.toContain(ANNA_SESSION_ID);
  });

  test("HTTP list — a principal-less requester sees no owned session", async () => {
    const ids = await listSessionIds({});
    expect(ids).not.toContain(ANNA_SESSION_ID);
    expect(ids).not.toContain(BELA_SESSION_ID);
  });

  test("HTTP detail gate — Béla gets 404 for Anna's session, Anna gets through (no oracle)", async () => {
    const belaRes = await fetch(`${dashboardBase()}/api/events/${ANNA_SESSION_ID}/1`, {
      headers: { Authorization: `Bearer ${belaToken}` },
    });
    expect(belaRes.status).toBe(404);
    // Owner passes the gate (the seeded ended session carries no event #1, so the
    // body is a benign not-found — but the STATUS proves the gate let Anna in).
    const annaRes = await fetch(`${dashboardBase()}/api/events/${ANNA_SESSION_ID}/1`, {
      headers: { Authorization: `Bearer ${annaToken}` },
    });
    expect(annaRes.status).toBe(200);
  });

  test("ws-ticket — resolver REJECTS a wrong-audience bearer (401)", async () => {
    const mintRes = await fetch(`${IDENTITY_ISSUER_URL}/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "user-anna", aud: "not-pi-dashboard" }),
    });
    const { access_token } = (await mintRes.json()) as { access_token: string };
    const res = await fetch(`${dashboardBase()}/api/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "browser" }),
    });
    expect(res.status).toBe(401);
  });

  test("ws-ticket — resolver CLAIMS a valid Anna bearer (200 + ticket)", async () => {
    const ticket = await mintTicket(annaToken);
    expect(ticket.length).toBeGreaterThan(0);
  });

  test("WS upgrade is REFUSED without an identity ticket (§9.2)", async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${wsBase()}/ws`, { headers: { Origin: dashboardBase() } });
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("unexpected-response", (_req, res) =>
          reject(new Error(`refused ${res.statusCode}`)),
        );
        ws.on("error", (err) => reject(err));
      }),
    ).rejects.toThrow();
  });

  test("WS bootstrap is owner-scoped — Anna's snapshot never carries Béla's session", async () => {
    const ticket = await mintTicket(annaToken);
    const snap = await firstSnapshot(ticket);
    const ids = snap.sessions.map((s) => s.id);
    expect(ids).not.toContain(BELA_SESSION_ID);
  });
});
