/**
 * D21 setup matrix — server-observable outcome per operator setup (test-plan
 * LK-1..LK-13). For every scenario: does it boot, does it say why it is not
 * enforced, what do the pre-auth endpoints report, and who gets in over REST and
 * the browser WebSocket — from genuine localhost and from a non-loopback address.
 */
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import WebSocket from "ws";
import { readState } from "./matrix-lifecycle.js";
import { SCENARIOS } from "./scenarios.js";

// Read lazily: spec files are collected BEFORE global-setup boots the matrix.
let cached: ReturnType<typeof readState> | undefined;
const st = () => {
  cached ??= readState();
  return cached;
};
const url = (id: string, host = "127.0.0.1") => `http://${host}:${st().instances[id].port}`;

async function mint(sub: string): Promise<string> {
  const res = await fetch(`${st().issuer}/mint`, { method: "POST", body: JSON.stringify({ sub }) });
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Mint a browser ws-ticket (optionally with a bearer) and try the upgrade. */
async function browserSocket(base: string, bearer?: string): Promise<"open" | `refused ${number}` | `mint ${number}`> {
  const headers = { Origin: base, "content-type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };
  const r = await fetch(`${base}/api/ws-ticket`, { method: "POST", headers, body: JSON.stringify({ scope: "browser" }) });
  const ticket = ((await r.json().catch(() => ({}))) as { data?: { ticket?: string } }).data?.ticket;
  if (!ticket) return `mint ${r.status}`;
  return new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?ticket=${ticket}`, { headers: { Origin: base } });
    ws.on("unexpected-response", (_q, res) => resolve(`refused ${res.statusCode ?? 0}`));
    ws.on("error", () => {});
    ws.on("open", () => {
      resolve("open");
      ws.close();
    });
  });
}

for (const s of SCENARIOS) {
  test.describe(`${s.id} — ${s.title}`, () => {
    test("boots and logs exactly the expected identity state", () => {
      const log = fs.readFileSync(st().instances[s.id].log, "utf8");
      expect(log).not.toMatch(/IdentityStartupError/);
      const warning = log.split("\n").find((l) => l.includes("[identity] identity is NOT enforced"));
      if (s.expect.disarmReason) expect(warning).toMatch(s.expect.disarmReason);
      else expect(warning).toBeUndefined();
      if (s.expect.logLine) expect(log).toMatch(s.expect.logLine);
    });

    test("pre-auth endpoints agree with the enforcement decision", async () => {
      const cfg = await (await fetch(`${url(s.id)}/api/identity/login-config`)).json();
      expect(cfg.active).toBe(s.expect.armed);
      if (s.expect.armed) expect(cfg).toMatchObject({ loginUrl: "/identity-login/start", tokenUrl: "/identity-login/token", label: "Keycloak" });
      const status = await (await fetch(`${url(s.id)}/auth/status`)).json();
      if (s.expect.legacyAuth) expect(status.authenticated).toBe(false); // legacy cookie route answers
      else expect(status).toEqual(s.expect.armed ? { authenticated: false, authEnabled: true } : { authenticated: true, authEnabled: false });
    });

    test("genuine-localhost browser socket without identity: refused only when enforced", async () => {
      const got = await browserSocket(url(s.id));
      // Enforced: refused — since D24 already at the ticket mint (401 floor),
      // before any upgrade is attempted.
      if (s.expect.armed) expect(got).toBe("mint 401");
      else expect(got).toBe("open");
    });

    test("remote (non-loopback) caller: no token refused; a valid bearer gets in only when enforced", async () => {
      test.skip(!st().lanHost, "no non-loopback IPv4 on this host");
      const remote = url(s.id, st().lanHost ?? "");
      // Enforced ⇒ the D24 floor answers first (401 sign_in_required); inert ⇒
      // the legacy network guard (403), or legacy cookie auth (401).
      const refused = s.expect.legacyAuth || s.expect.armed ? 401 : 403;
      expect((await fetch(`${remote}/api/sessions`)).status).toBe(refused);
      const anna = await mint("sub-anna");
      const withBearer = (await fetch(`${remote}/api/sessions`, { headers: { Authorization: `Bearer ${anna}` } })).status;
      expect(withBearer).toBe(s.expect.armed && s.resolver !== "dead" ? 200 : refused);
      if (s.expect.armed && s.resolver !== "dead") expect(await browserSocket(remote, anna)).toBe("open");
    });

    if (s.expect.armed) {
      // D24 signed-out floor (closes 18.17): loopback is not identity (D23).
      test("enforced: localhost REST without a bearer is refused (sign_in_required)", async () => {
        for (const path of ["/api/sessions", "/api/config", "/api/providers"]) {
          const res = await fetch(`${url(s.id)}${path}`);
          expect(res.status, path).toBe(401);
          expect(await res.json(), path).toMatchObject({ error: "sign_in_required" });
        }
        expect((await fetch(`${url(s.id)}/api/health`)).status).toBe(200); // pre-auth set stays open
      });
    } else {
      test("inert: localhost REST is unchanged (no floor)", async () => {
        expect((await fetch(`${url(s.id)}/api/sessions`)).status).toBe(200);
      });
    }
  });
}
