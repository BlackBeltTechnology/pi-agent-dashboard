/**
 * Server-level D20 smoke checks over the real resource-server path (tasks 17.2,
 * 17.6): independent login plugin ⇒ descriptor relay + current-allowlist trust;
 * bearer expiry ⇒ 401 on REST and a 4001 close on the socket.
 *
 * Boots a REAL server against the in-process fake OIDC issuer (RS256 + JWKS), so
 * the resolver verifies real signatures. Replaces the NOT-RUN rows of the
 * disposable smoke (`spike/identity-login-plane`). Isolation (SM-5) is asserted
 * by `tests/e2e/identity/two-user-isolation.spec.ts` in the harness.
 *
 * Folds test-plan SM-2, SM-6. See change: add-multi-user-identity-plane (D20).
 */
import { type FakeOidcIssuer, startFakeOidcIssuer } from "@blackbelt-technology/pi-dashboard-shared/test-support/fake-oidc-issuer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { type BootHarness, createBootHarness, loginPlugin } from "./boot-harness.js";

let h: BootHarness;
let idp: FakeOidcIssuer;

beforeEach(async () => {
  idp = await startFakeOidcIssuer();
  h = createBootHarness();
});
afterEach(async () => {
  await h.teardown();
  await idp.close();
});

function configure(trusted: string[]) {
  h.writeConfig({
    plugins: {
      "keycloak-resolver": { enabled: true, issuer: idp.issuer, audience: idp.audience, allowInsecureHttp: true, clockSkewSeconds: 0 },
    },
    identity: { trustedResolverPlugins: trusted },
  });
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function ticketFor(token: string): Promise<{ status: number; ticket?: string }> {
  const res = await fetch(`http://127.0.0.1:${h.handle().httpPort}/api/ws-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ scope: "browser" }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { ticket?: string } };
  return { status: res.status, ticket: body.data?.ticket };
}

describe("17.2 SM-2 — descriptor seam + current-allowlist trust", () => {
  it("relays the sanitized {pluginId, loginUrl, logoutUrl} when the plugin is in the CURRENT allowlist", async () => {
    h.dropIn("indep-login", loginPlugin("indep-login"));
    configure(["indep-login"]);
    await h.boot();
    expect(await h.json("/api/identity/login-config")).toMatchObject({
      active: true,
      pluginId: "indep-login",
      loginUrl: "/indep-login/login",
      logoutUrl: "/indep-login/logout",
    });
  }, 40000);

  it("a plugin NOT in the allowlist registers nothing ⇒ {active:false}, no details disclosed", async () => {
    h.dropIn("indep-login", loginPlugin("indep-login"));
    configure([]); // resolver active, but the login plugin lost trust
    await h.boot();
    const cfg = await h.json("/api/identity/login-config");
    expect(cfg).toEqual({ active: false });
    expect(h.output()).toMatch(/plugin 'indep-login' is not trusted to publish a browser login config/);
  }, 40000);
});

describe("17.6 SM-6 — expiry", () => {
  it("a token past exp is refused (401) on REST, and a socket is closed 4001 at principalExpiresAt", async () => {
    h.dropIn("indep-login", loginPlugin("indep-login"));
    configure(["indep-login"]);
    await h.boot();
    const base = `http://127.0.0.1:${h.handle().httpPort}`;

    // Stale token: refused, discloses nothing.
    const stale = await idp.mint({ sub: "sub-anna", expSeconds: -600 });
    const refused = await fetch(`${base}/api/sessions`, { headers: bearer(stale) });
    expect(refused.status).toBe(401);

    // Short-lived token: ticket + upgrade work now…
    const short = await idp.mint({ sub: "sub-anna", expSeconds: 3 });
    const { status, ticket } = await ticketFor(short);
    expect(status).toBe(200);
    const ws = await h.dial(ticket);
    expect(ws).not.toBeNull();

    // …then the socket is closed with 4001 once the token lapses.
    const closeCode = await new Promise<number>((resolve) => {
      ws!.on("close", (code) => resolve(code));
      setTimeout(() => resolve(-1), 8000);
    });
    expect(closeCode).toBe(4001);

    // And the expired bearer can no longer mint a ticket.
    await new Promise((r) => setTimeout(r, 500));
    expect((await ticketFor(short)).status).toBe(401);
  }, 40000);
});

describe("18.27 ctx.identity — plugin consumer seam on a real server", () => {
  it("a plugin reads the principal behind a WS upgrade, authorizes namespaced actions, and gets per-user storage", async () => {
    h.dropIn(
      "consumer",
      `export default async (ctx) => {
         ctx.registerBrowserLoginConfig({ loginUrl: "/consumer/login", logoutUrl: "/consumer/logout" });
         globalThis.__consumerIdentity = ctx.identity;
       };`,
    );
    configure(["consumer"]);
    await h.boot();
    const seam = (globalThis as any).__consumerIdentity;
    try {
      expect(seam).toBeDefined();
      expect(seam.isEnforced()).toBe(true);

      const token = await idp.mint({ sub: "sub-anna" });
      const upgrade = (authorization?: string) => ({
        url: "/ws/consumer/x",
        headers: authorization ? { authorization } : {},
        socket: { remoteAddress: "127.0.0.1" },
      });
      const anna = await seam.principalOfUpgrade(upgrade(`Bearer ${token}`));
      expect(anna).toMatchObject({ iss: idp.issuer, sub: "sub-anna" });
      expect(await seam.principalOfUpgrade(upgrade())).toBeNull();
      expect(await seam.principalOfUpgrade(upgrade("Bearer garbage"))).toBeNull();
      expect(await seam.principalOfUpgrade(upgrade("Bearer pi_op_forged"))).toBeNull();

      // No policy registered ⇒ authorize is true for any principal (D24 default); bad action names are refused.
      expect(await seam.authorize(anna, "export", { kind: "note" })).toBe(true);
      expect(await seam.authorize(anna, "a:b", { kind: "note" })).toBe(false);

      // Per-user storage lives under THIS plugin's data root, keyed by a hash.
      const dir: string = seam.userDataDir(anna);
      expect(dir).toContain(`${"/.pi/dashboard/plugins/consumer/users/"}`);
      expect(dir.startsWith(h.home)).toBe(true);
    } finally {
      delete (globalThis as any).__consumerIdentity;
    }
  }, 40000);
});

describe("18.13 terminal + live WS scopes require a principal ticket while enforced", () => {
  const upgrade = (port: number, path_: string): Promise<{ status?: number; opened?: boolean }> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path_}`);
      ws.on("open", () => {
        ws.close();
        resolve({ opened: true });
      });
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode }));
      ws.on("error", () => resolve({}));
      setTimeout(() => resolve({}), 5000);
    });

  it("ticketless loopback is refused 403 (no legacy allowance); a principal ticket passes the auth gate", async () => {
    h.dropIn("tl-login", loginPlugin("tl-login"));
    configure(["tl-login"]);
    await h.boot();
    const port = h.handle().httpPort;
    expect(await upgrade(port, "/ws/terminal/term-missing")).toEqual({ status: 403 });
    expect(await upgrade(port, "/live/nope")).toEqual({ status: 403 });

    const token = await idp.mint({ sub: "sub-anna" });
    for (const scope of ["terminal", "live"] as const) {
      const res = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope }),
      });
      expect(res.status).toBe(200);
      const ticket = ((await res.json()) as { data: { ticket: string } }).data.ticket;
      const path_ = scope === "terminal" ? "/ws/terminal/term-missing" : "/live/nope";
      // Past auth: the (absent) target destroys the socket — NOT the 403 of the auth gate.
      const out = await upgrade(port, `${path_}?ticket=${encodeURIComponent(ticket)}`);
      expect(out.status).not.toBe(403);
    }
  }, 40000);
});

describe("review B1/B2 — terminal upgrade honours host policy and token expiry (real PTY)", () => {
  async function ticketFor(token: string, scope: "browser" | "terminal"): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${h.handle().httpPort}/api/ws-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scope }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { ticket: string } }).data.ticket;
  }

  /** anna spawns a real terminal through her ticketed browser socket; resolves its id. */
  async function spawnTerminal(token: string): Promise<string> {
    const ws = await h.dial(await ticketFor(token, "browser"));
    expect(ws).not.toBeNull();
    const id = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no terminal_added")), 10_000);
      ws!.on("message", (raw) => {
        const m = JSON.parse(String(raw)) as { type?: string; terminal?: { id: string; principalOwner?: { sub: string } } };
        if (m.type === "terminal_added" && m.terminal?.principalOwner?.sub === "sub-anna") {
          clearTimeout(timer);
          resolve(m.terminal.id);
        }
      });
      ws!.send(JSON.stringify({ type: "create_terminal", cwd: h.home }));
    });
    ws!.close();
    return id;
  }

  const upgrade = (path_: string): Promise<{ status?: number; ws?: WebSocket }> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${h.handle().httpPort}${path_}`);
      ws.on("open", () => resolve({ ws }));
      ws.on("unexpected-response", (_r, res) => resolve({ status: res.statusCode }));
      ws.on("error", () => resolve({}));
      setTimeout(() => resolve({}), 5000);
    });

  function bootWithPolicy() {
    h.dropIn("pol-login", loginPlugin("pol-login"));
    h.dropIn(
      "pol-policy",
      `export default async (ctx) => {
         globalThis.__denied = new Set();
         globalThis.__deniedIds = new Set();
         ctx.registerHostAccessPolicy(async ({ action, resource }) =>
           !globalThis.__denied.has(action) && !(resource && resource.id && globalThis.__deniedIds.has(resource.id)));
       };`,
    );
    h.writeConfig({
      plugins: { "keycloak-resolver": { enabled: true, issuer: idp.issuer, audience: idp.audience, allowInsecureHttp: true, clockSkewSeconds: 0 } },
      identity: { trustedResolverPlugins: ["pol-login"], trustedPolicyPlugin: "pol-policy" },
    });
    return h.boot();
  }

  it("B2: a policy that denies terminal.read refuses the upgrade to an EXISTING owned terminal (403); allowed ⇒ attaches", async () => {
    await bootWithPolicy();
    try {
      const token = await idp.mint({ sub: "sub-anna" });
      const id = await spawnTerminal(token);

      const allowed = await upgrade(`/ws/terminal/${id}?ticket=${encodeURIComponent(await ticketFor(token, "terminal"))}`);
      expect(allowed.ws).toBeDefined();
      allowed.ws?.close();

      (globalThis as any).__denied.add("terminal.read");
      const denied = await upgrade(`/ws/terminal/${id}?ticket=${encodeURIComponent(await ticketFor(token, "terminal"))}`);
      expect(denied).toEqual({ status: 403 });
    } finally {
      delete (globalThis as any).__denied;
    }
  }, 60000);

  it("B1: an attached terminal socket is closed 4001 when its bearer expires", async () => {
    await bootWithPolicy();
    try {
      const long = await idp.mint({ sub: "sub-anna" });
      const id = await spawnTerminal(long);
      const short = await idp.mint({ sub: "sub-anna", expSeconds: 3 });
      const { ws } = await upgrade(`/ws/terminal/${id}?ticket=${encodeURIComponent(await ticketFor(short, "terminal"))}`);
      expect(ws).toBeDefined();
      const code = await new Promise<number>((resolve) => {
        ws!.on("close", (c) => resolve(c));
        setTimeout(() => resolve(-1), 9000);
      });
      expect(code).toBe(4001);
    } finally {
      delete (globalThis as any).__denied;
    }
  }, 60000);

  it("r2-B2: generic terminal.read allowed but THIS terminal denied ⇒ no bootstrap row, no frames, no direct attach", async () => {
    await bootWithPolicy();
    try {
      const token = await idp.mint({ sub: "sub-anna" });
      const id = await spawnTerminal(token); // allowed while nothing is denied

      (globalThis as any).__deniedIds.add(id);
      // A fresh browser socket: its bootstrap must not disclose the denied terminal.
      const ws = await h.dial(await ticketFor(token, "browser"));
      expect(ws).not.toBeNull();
      const frames: Array<{ type?: string; terminal?: { id: string }; terminalId?: string }> = [];
      ws!.on("message", (raw) => frames.push(JSON.parse(String(raw))));
      await new Promise((r) => setTimeout(r, 1500));
      expect(frames.some((f) => f.type === "sessions_snapshot")).toBe(true); // bootstrap really ran
      expect(frames.filter((f) => f.type === "terminal_added").map((f) => f.terminal?.id)).not.toContain(id);
      ws!.close();

      const denied = await upgrade(`/ws/terminal/${id}?ticket=${encodeURIComponent(await ticketFor(token, "terminal"))}`);
      expect(denied).toEqual({ status: 403 });
    } finally {
      delete (globalThis as any).__denied;
      delete (globalThis as any).__deniedIds;
    }
  }, 60000);

  describe("live upgrades (review r2: B2 untested, B1 expiry)", () => {
    async function liveTarget(token: string): Promise<{ path: string; stop: () => Promise<void> }> {
      const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
      await new Promise<void>((r) => upstream.on("listening", () => r()));
      const port = (upstream.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${h.handle().httpPort}/api/live-server/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ host: "127.0.0.1", port }),
      });
      expect(res.status).toBe(200);
      const path_ = ((await res.json()) as { data: { path: string } }).data.path;
      return { path: path_, stop: () => new Promise<void>((r) => upstream.close(() => r())) };
    }
    const ticket = async (token: string) => {
      const res = await fetch(`http://127.0.0.1:${h.handle().httpPort}/api/ws-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope: "live" }),
      });
      return ((await res.json()) as { data: { ticket: string } }).data.ticket;
    };

    it("policy live.read decides the upgrade to an EXISTING target: allowed ⇒ opens, denied ⇒ 403", async () => {
      await bootWithPolicy();
      const token = await idp.mint({ sub: "sub-anna" });
      const target = await liveTarget(token);
      try {
        const ok = await upgrade(`${target.path}/?ticket=${encodeURIComponent(await ticket(token))}`);
        expect(ok.ws).toBeDefined();
        ok.ws?.close();
        (globalThis as any).__denied.add("live.read");
        const no = await upgrade(`${target.path}/?ticket=${encodeURIComponent(await ticket(token))}`);
        expect(no).toEqual({ status: 403 });
      } finally {
        await target.stop();
        delete (globalThis as any).__denied;
        delete (globalThis as any).__deniedIds;
      }
    }, 60000);

    it("a proxied live socket is cut when its bearer expires", async () => {
      await bootWithPolicy();
      const long = await idp.mint({ sub: "sub-anna" });
      const target = await liveTarget(long);
      try {
        const short = await idp.mint({ sub: "sub-anna", expSeconds: 3 });
        const { ws } = await upgrade(`${target.path}/?ticket=${encodeURIComponent(await ticket(short))}`);
        expect(ws).toBeDefined();
        const closed = await new Promise<boolean>((resolve) => {
          ws!.on("close", () => resolve(true));
          setTimeout(() => resolve(false), 9000);
        });
        expect(closed).toBe(true);
      } finally {
        await target.stop();
        delete (globalThis as any).__denied;
        delete (globalThis as any).__deniedIds;
      }
    }, 60000);
  });
});
