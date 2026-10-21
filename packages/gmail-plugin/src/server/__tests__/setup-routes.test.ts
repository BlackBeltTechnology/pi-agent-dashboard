/**
 * Automatic-setup routes (test-plan #E1–#E4, #E9, #R18, task 2.1/2.8): entry
 * availability, genuinely-local start, validation, single live run, the links
 * decision, lazy `browser.dedicated` lookup. See change: add-gmail-auto-setup.
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { fakeBrowserService } from "../../__tests__/fake-browser-service.js";
import { CLIENT, capturingLogger, memoryCredentials } from "../../__tests__/fakes.js";
import {
  EXISTING,
  type Harness,
  makeHarness,
  OWNER,
  preset,
  startExisting,
  until,
} from "../../__tests__/setup-harness.js";
import { acctKey, CLIENT_KEY } from "../accounts.js";
import registerPlugin from "../index.js";
import { isGenuinelyLocal } from "../setup/local.js";

const account = (sub: string) => ({
  sub,
  email: `${sub}@x.com`,
  tier: "readonly",
  scopes: [],
  refresh: "r",
  access: "a",
  expires: 1,
  status: "ok",
  addedAt: 1,
});

describe("E1 entry point availability (GET state → autoSetup)", () => {
  it("service absent → unavailable (service_missing)", async () => {
    const h = await makeHarness({ noService: true });
    expect((await h.state()).autoSetup).toMatchObject({ available: false, reason: "service_missing", local: true });
  });

  it("service present but not enabled → unavailable", async () => {
    const h = await makeHarness({ browser: { status: { enabled: false } } });
    expect((await h.state()).autoSetup).toMatchObject({ available: false, reason: "disabled" });
  });

  it("service enabled but profile not available → unavailable with the service's reason", async () => {
    const h = await makeHarness({ browser: { status: { available: false, reason: "no-chrome" } } });
    expect((await h.state()).autoSetup).toMatchObject({ available: false, reason: "no-chrome" });
  });

  it("enabled + available, no client → available, no replace flag", async () => {
    const h = await makeHarness();
    const s = (await h.state()).autoSetup;
    expect(s).toMatchObject({ available: true, local: true });
    expect(s.replacesClient).toBeUndefined();
  });

  it("client without accounts → available with the replace flag", async () => {
    const h = await makeHarness({ client: true });
    expect((await h.state()).autoSetup).toMatchObject({ available: true, replacesClient: true });
  });

  it("client with an account → unavailable", async () => {
    const h = await makeHarness({ client: true, initial: { [acctKey("s1")]: account("s1") } });
    expect((await h.state()).autoSetup).toMatchObject({ available: false, reason: "client_in_use" });
  });

  it("non-local request → unavailable with local:false", async () => {
    const h = await makeHarness();
    expect((await h.state({ remoteAddress: "192.168.1.5" })).autoSetup).toMatchObject({
      available: false,
      local: false,
      reason: "remote_dashboard",
    });
  });

  it("a status() that throws → unavailable, not a 500", async () => {
    const h = await makeHarness();
    h.browser.service.status = async () => {
      throw new Error("boom");
    };
    expect((await h.state()).autoSetup).toMatchObject({ available: false, reason: "status_failed" });
  });
});

describe("E2 genuinely-local start", () => {
  const ok: Array<[string, { remoteAddress?: string; headers?: Record<string, string> }]> = [
    ["127.0.0.1", { remoteAddress: "127.0.0.1" }],
    ["::1", { remoteAddress: "::1" }],
  ];
  for (const [name, opts] of ok) {
    it(`${name} starts a run`, async () => {
      const h = await makeHarness();
      const r = await h.start(EXISTING, opts);
      expect(r.statusCode).toBe(200);
      expect(r.json().runId).toBeTruthy();
    });
  }

  const refused: Array<[string, { remoteAddress?: string; headers?: Record<string, string> }]> = [
    ["a LAN peer", { remoteAddress: "192.168.1.5" }],
    ["loopback + X-Forwarded-For (same-host tunnel)", { remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } }],
    ["loopback + Forwarded", { remoteAddress: "127.0.0.1", headers: { forwarded: "for=203.0.113.9" } }],
    ["loopback + Via", { remoteAddress: "127.0.0.1", headers: { via: "1.1 zrok" } }],
  ];
  for (const [name, opts] of refused) {
    it(`${name} → 403 remote_dashboard, nothing launched`, async () => {
      const h = await makeHarness();
      const r = await h.start(EXISTING, opts);
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("remote_dashboard");
      expect(h.browser.calls.connect).toHaveLength(0);
    });
  }

  it("predicate: IPv4-mapped loopback is local, an x-forwarded-* variant is not", () => {
    expect(isGenuinelyLocal({}, "::ffff:127.0.0.1")).toBe(true);
    expect(isGenuinelyLocal({ "x-forwarded-host": "a" }, "127.0.0.1")).toBe(false);
    expect(isGenuinelyLocal({}, undefined)).toBe(false);
    expect(isGenuinelyLocal({}, "10.0.0.1")).toBe(false);
  });
});

describe("E3 start validation", () => {
  const bad: Array<[string, unknown, string]> = [
    ["existing without projectId", { mode: "existing", ownerEmail: OWNER }, "invalid_project_id"],
    ["existing with a project NAME", { mode: "existing", projectId: "PiDashboard", ownerEmail: OWNER }, "invalid_project_id"],
    ["new with a bad owner email", { mode: "new", ownerEmail: "x" }, "invalid_owner_email"],
    ["unknown mode", { mode: "bogus", ownerEmail: OWNER }, "invalid_mode"],
  ];
  for (const [name, body, error] of bad) {
    it(`${name} → 400 ${error} naming the rule, no run`, async () => {
      const h = await makeHarness();
      const r = await h.start(body);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe(error);
      expect(r.json().message).toMatch(/\S/);
      expect(h.browser.calls.connect).toHaveLength(0);
    });
  }

  it("valid new → 200 {runId}", async () => {
    const h = await makeHarness();
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json())).toEqual(["runId"]);
  });

  it("valid existing → 200 {runId}", async () => {
    const h = await makeHarness();
    const r = await h.start({ mode: "existing", projectId: "pi-dashboard-abc123", ownerEmail: "Owner@Example.com " });
    expect(r.statusCode).toBe(200);
    // The owner email is normalized before it is used or saved.
    await until(() => h.configUpdates, (u) => u.length > 0);
    expect(h.configUpdates[0]).toEqual({ projectId: "pi-dashboard-abc123", ownerAccount: OWNER });
  });

  it("a start refused because setup is unavailable → 409 unavailable with the reason", async () => {
    const h = await makeHarness({ browser: { status: { enabled: false } } });
    const r = await h.start(EXISTING);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "unavailable", reason: "disabled" });
  });
});

describe("E4 single live run + run routes", () => {
  async function liveRun(h: Harness) {
    preset(h.console, "api"); // stops at the audience decision
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    return id;
  }

  it("a second start while a run is live → 409 run_active; state names the live run", async () => {
    const h = await makeHarness();
    const id = await liveRun(h);
    const r = await h.start(EXISTING);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("run_active");
    expect((await h.state()).autoSetup).toMatchObject({ available: false, reason: "run_active", runId: id });
  });

  it("after the run is cancelled a new run may start", async () => {
    const h = await makeHarness();
    const id = await liveRun(h);
    expect((await h.del(`/setup/run/${id}`)).json().state).toBe("cancelled");
    expect((await h.start(EXISTING)).statusCode).toBe(200);
  });

  it("unknown run id → 404 on every run route", async () => {
    const h = await makeHarness();
    expect((await h.app.inject({ method: "GET", url: h.url("/setup/run/nope") })).statusCode).toBe(404);
    expect((await h.post("/setup/run/nope/continue")).statusCode).toBe(404);
    expect((await h.post("/setup/run/nope/takeover")).statusCode).toBe(404);
    expect((await h.del("/setup/run/nope")).statusCode).toBe(404);
  });

  it("continue while not waiting → 409 not_waiting", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    const id = await startExisting(h);
    await until(() => h.view(id), (v) => v.state === "waiting_decision");
    await h.del(`/setup/run/${id}`);
    const r = await h.post(`/setup/run/${id}/continue`, { audience: "external" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("not_waiting");
  });
});

describe("E9 links decision validation", () => {
  const defaults = { homePage: "https://github.com/BlackBeltTechnology/pi-agent-dashboard", privacyPolicy: "https://github.com/BlackBeltTechnology/pi-agent-dashboard", authorizedDomain: "github.com" };

  async function atLinks() {
    const h = await makeHarness();
    preset(h.console, "branding"); // External, unpublished → links decision
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "waiting_decision");
    expect(v.decision?.kind).toBe("links");
    return { h, id };
  }

  const rejected: Array<[string, Record<string, unknown>, string]> = [
    ["defaults without confirmLinks", { links: defaults }, "confirm_required"],
    ["confirm without links field still needs the explicit confirm", {}, "confirm_required"],
    ["http privacy policy", { confirmLinks: true, links: { ...defaults, privacyPolicy: "http://example.com/p" } }, "invalid_privacyPolicy"],
    ["home page outside the authorized domain", { confirmLinks: true, links: { ...defaults, homePage: "https://evil.test" } }, "invalid_homePage"],
    ["a domain that is not a hostname", { confirmLinks: true, links: { ...defaults, authorizedDomain: "not a domain" } }, "invalid_authorized_domain"],
    ["a lookalike host (github.com.evil.test)", { confirmLinks: true, links: { ...defaults, homePage: "https://github.com.evil.test/x" } }, "invalid_homePage"],
  ];
  for (const [name, body, error] of rejected) {
    it(`${name} → 400 ${error}; the run keeps waiting`, async () => {
      const { h, id } = await atLinks();
      const r = await h.post(`/setup/run/${id}/continue`, body);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe(error);
      expect((await h.view(id)).state).toBe("waiting_decision");
    });
  }

  it("defaults + confirmLinks proceeds and the confirmed links are stored (non-secret, key setup)", async () => {
    const { h, id } = await atLinks();
    expect((await h.post(`/setup/run/${id}/continue`, { confirmLinks: true })).statusCode).toBe(200);
    await until(() => h.view(id), (v) => v.state !== "waiting_decision");
    expect(h.creds.data.get("setup")).toEqual({ links: defaults });
  });

  it("user-edited links under their own authorized domain are accepted and typed into the form", async () => {
    const { h, id } = await atLinks();
    const links = { homePage: "https://example.org/app", privacyPolicy: "https://www.example.org/privacy", authorizedDomain: "example.org" };
    expect((await h.post(`/setup/run/${id}/continue`, { confirmLinks: true, links })).statusCode).toBe(200);
    await until(() => h.view(id), (v) => v.state !== "waiting_decision");
    await until(() => h.console.fills, (f) => f.some((x) => x.name === "Authorized domain 1"));
    expect(h.console.fills.filter((f) => f.name.startsWith("Application") || f.name.startsWith("Authorized")).map((f) => f.text)).toEqual([
      links.homePage,
      links.privacyPolicy,
      links.authorizedDomain,
    ]);
  });
});

describe("R18 / task 2.1 — gmail loads without the browser plugin and finds it lazily", () => {
  it("consume undefined at load, defined later → GET state reports unavailable, then available", async () => {
    const app = Fastify();
    const fake = fakeBrowserService();
    let provided: unknown;
    const consume = vi.fn(() => provided);
    const ctx = {
      credentials: memoryCredentials({ [CLIENT_KEY]: { ...CLIENT } }),
      logger: capturingLogger(),
      fastify: app,
      networkGuard: async () => {},
      consume,
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      registerPiRequestHandler: vi.fn(),
      oauth: undefined,
    };
    await registerPlugin(ctx as never);
    const get = async () => (await app.inject({ method: "GET", url: "/api/plugins/gmail/state" })).json().autoSetup;
    expect(await get()).toMatchObject({ available: false, reason: "service_missing" });
    provided = fake.service;
    expect(await get()).toMatchObject({ available: true, replacesClient: true });
    expect(consume).toHaveBeenCalledWith("browser.dedicated");
    await app.close();
  });

  it("harness: provide() after load flips availability without a restart", async () => {
    const h = await makeHarness({ noService: true });
    expect((await h.state()).autoSetup.available).toBe(false);
    h.provide();
    expect((await h.state()).autoSetup.available).toBe(true);
  });
});

describe("setup run routes are genuinely-local only (security review #1)", () => {
  const remote = { remoteAddress: "192.168.1.5" };
  const tunnel = { remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } };

  for (const [name, opts] of [["a LAN peer", remote], ["a same-host tunnel", tunnel]] as const) {
    it(`${name} cannot read, continue, take over or cancel a live run`, async () => {
      const h = await makeHarness();
      preset(h.console, "branding");
      const id = await startExisting(h);
      const base = `/api/plugins/gmail/setup/run/${id}`;
      const calls = [
        h.app.inject({ method: "GET", url: base, ...opts }),
        h.app.inject({ method: "POST", url: `${base}/continue`, payload: { confirmLinks: true }, ...opts }),
        h.app.inject({ method: "POST", url: `${base}/takeover`, payload: {}, ...opts }),
        h.app.inject({ method: "DELETE", url: base, ...opts }),
      ];
      for (const r of await Promise.all(calls)) {
        expect(r.statusCode).toBe(403);
        expect(r.json().error).toBe("remote_dashboard");
      }
      // The run itself is untouched by the refused calls.
      expect((await h.view(id)).state).not.toBe("cancelled");
    });
  }
});
