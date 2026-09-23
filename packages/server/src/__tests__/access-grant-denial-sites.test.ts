/**
 * Denial-site wiring, end to end through the real routes (change:
 * add-access-grant-dialog, tasks 6.1-6.5, 2b.5; test-plan #X3, #E49).
 *
 * The coordinator is installed with REAL planes; only the operator is simulated,
 * by answering the broadcast `grant_request` through `onResponse`.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAccessGrants } from "../access/access-grants.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createCwdPlane, createFilesystemPlane, createNetworkPlane } from "../access/planes.js";
import { __resetPromptChannels, GRANT_CHANNEL_HEADER, issuePromptChannel } from "../access/prompt-channel.js";
import { createNetworkGuardHook, setNetworkDenialObserver } from "../auth/localhost-guard.js";
import { registerFileRoutes } from "../routes/file-routes.js";

let tmp: string;
let cwd: string;
let outside: string;
let pinned: string[];
let sent: ServerToBrowserMessage[];
let coordinator: GrantCoordinator;
let capability: string;
let promptEnabled: boolean;

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [{ cwd }] } as never,
    preferencesStore: { getPinnedDirectories: () => pinned } as never,
    networkGuard: async () => undefined,
  });
  return app;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-grant-sites-")));
  cwd = path.join(tmp, "session");
  outside = path.join(tmp, "outside");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.join(outside, "a"), { recursive: true });
  fs.mkdirSync(path.join(outside, "b"), { recursive: true });
  fs.writeFileSync(path.join(outside, "a", "f.txt"), "secret-a");
  fs.writeFileSync(path.join(outside, "b", "f.txt"), "secret-b");
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  __resetAccessGrants();
  pinned = [];
  sent = [];
  promptEnabled = true;

  const planes = new AccessPlaneRegistry();
  planes.register(createFilesystemPlane());
  planes.register(createCwdPlane({ pinDirectory: (d) => pinned.push(d) }));
  planes.register(createNetworkPlane({ readTrustedNetworks: () => [], writeConfigPartial: () => ({ success: true }) }));
  coordinator = new GrantCoordinator({
    planes,
    broadcast: (m) => sent.push(m),
    hostGateMode: () => "enforce",
    promptEnabled: () => promptEnabled,
    killSwitch: () => false,
    operatorChannels: () => 1,
    onTransition: () => {},
  });
  installGrantCoordinator(coordinator);
  capability = issuePromptChannel("operator-sock");
});

afterEach(() => {
  installGrantCoordinator(null);
  setNetworkDenialObserver(null);
  __resetPromptChannels();
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Wait until a `grant_request` beyond the first `seen` ones is broadcast. */
async function nextPrompt(seen = 0) {
  for (let i = 0; i < 200; i++) {
    const prompts = sent.filter((m) => m.type === "grant_request");
    if (prompts.length > seen) {
      const p = prompts[seen];
      if (p.type === "grant_request") return p;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no grant_request was broadcast");
}

const read = (app: FastifyInstance, file: string, withCap = true) =>
  app.inject({
    method: "GET",
    url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(file)}`,
    headers: withCap ? { [GRANT_CHANNEL_HEADER]: capability } : {},
  });

describe("6.2 / 6.3 a held file read resumes on the operator's allow", () => {
  it("allow-once serves the file, and persists nothing", async () => {
    const app = makeApp();
    const pending = read(app, path.join(outside, "a", "f.txt"));
    const p = await nextPrompt();
    expect(p).toMatchObject({ plane: "filesystem", subject: path.join(outside, "a") });
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-once" });
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("secret-a");

    // Nothing persisted: the same read is denied again. Inside the 120 s
    // post-settlement backoff (design D9) it is refused at once, without a
    // second prompt, which is what a polling client must see.
    const again = await read(app, path.join(outside, "a", "f.txt"));
    expect(again.statusCode).toBe(403);
    expect(sent.filter((m) => m.type === "grant_request")).toHaveLength(1);
  });

  it("allow-always persists, so the next read needs no prompt", async () => {
    const app = makeApp();
    const pending = read(app, path.join(outside, "a", "f.txt"));
    const p = await nextPrompt();
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-always" });
    expect((await pending).statusCode).toBe(200);
    const next = await read(app, path.join(outside, "a", "f.txt"));
    expect(next.statusCode).toBe(200);
    expect(sent.filter((m) => m.type === "grant_request")).toHaveLength(1);
  });

  it("a deny returns the site's unchanged denial body", async () => {
    const app = makeApp();
    const pending = read(app, path.join(outside, "a", "f.txt"));
    const p = await nextPrompt();
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "deny" });
    const res = await pending;
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(body.denialId).toEqual(expect.any(String));
  });
});

describe("6.4 / 2b.5 the guard re-runs in full on release", () => {
  it("#X3 a subject swapped for a link to another location after the verdict is denied", async () => {
    const app = makeApp();
    const link = path.join(outside, "link");
    fs.symlinkSync(path.join(outside, "a"), link);
    const pending = read(app, path.join(link, "f.txt"));
    const p = await nextPrompt();
    // The prompt names the REAL directory; the operator allows exactly that.
    expect(p.subject).toBe(path.join(outside, "a"));
    fs.unlinkSync(link);
    fs.symlinkSync(path.join(outside, "b"), link);
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-once" });
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("secret-b");
  });

  it("#X4 a grant revoked between the verdict and the release is honoured by the re-run", async () => {
    // A plane whose allow-always write "succeeds" but leaves no grant behind is
    // exactly the state a revocation racing the release produces.
    const planes = new AccessPlaneRegistry();
    const fsPlane = createFilesystemPlane();
    planes.register({ ...fsPlane, grant: async () => ({ ok: true as const, store: fsPlane.store }) });
    const revoking = new GrantCoordinator({
      planes,
      broadcast: (m) => sent.push(m),
      hostGateMode: () => "enforce",
      promptEnabled: () => true,
      killSwitch: () => false,
      operatorChannels: () => 1,
      onTransition: () => {},
    });
    installGrantCoordinator(revoking);
    const pending = read(makeApp(), path.join(outside, "a", "f.txt"));
    const p = await nextPrompt();
    await revoking.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-always" });
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("secret-a");
  });

  it("an allow-once for one directory does not admit a sibling directory", async () => {
    const app = makeApp();
    const pendingA = read(app, path.join(outside, "a", "f.txt"));
    const pA = await nextPrompt();
    await coordinator.onResponse({ promptId: pA.promptId, plane: pA.plane, subject: pA.subject, verdict: "allow-once" });
    expect((await pendingA).statusCode).toBe(200);

    const pendingB = read(app, path.join(outside, "b", "f.txt"));
    const pB = await nextPrompt(1);
    expect(pB.subject).toBe(path.join(outside, "b"));
    await coordinator.onResponse({ promptId: pB.promptId, plane: pB.plane, subject: pB.subject, verdict: "deny" });
    expect((await pendingB).statusCode).toBe(403);
  });
});

describe("6.5 containment is unchanged when the feature is off or unprompted", () => {
  const denialShape = (b: Record<string, unknown>) => ({ ...b, denialId: "<id>" });

  it("the denial body is identical with no coordinator, and with prompting disabled", async () => {
    installGrantCoordinator(null);
    const off = await read(makeApp(), path.join(outside, "a", "f.txt"));

    installGrantCoordinator(coordinator);
    promptEnabled = false;
    const unprompted = await read(makeApp(), path.join(outside, "a", "f.txt"));

    expect(off.statusCode).toBe(403);
    expect(unprompted.statusCode).toBe(403);
    expect(denialShape(unprompted.json())).toEqual(denialShape(off.json()));
    expect(sent.filter((m) => m.type === "grant_request")).toEqual([]);
  });

  it("#E49 a request without a capability is not held, but the denial is recorded", async () => {
    const res = await read(makeApp(), path.join(outside, "a", "f.txt"), false);
    expect(res.statusCode).toBe(403);
    expect(coordinator.registry.list()[0]).toMatchObject({
      plane: "filesystem",
      subject: path.join(outside, "a"),
      suppressedBy: "ineligible",
    });
  });
});

describe("6.2 the unknown-cwd site", () => {
  const exists = (app: FastifyInstance, dir: string) =>
    app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(dir)}`,
      headers: { [GRANT_CHANNEL_HEADER]: capability },
    });

  it("allow-always pins exactly that directory and the probe proceeds", async () => {
    const unknown = path.join(tmp, "unknown-ws");
    fs.mkdirSync(unknown);
    const app = makeApp();
    const pending = exists(app, unknown);
    const p = await nextPrompt();
    expect(p).toMatchObject({ plane: "cwd", subject: unknown });
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-always" });
    const res = await pending;
    expect(res.statusCode).not.toBe(403);
    expect(pinned).toEqual([unknown]);
  });

  it("a deny returns the unchanged 'unknown cwd' body", async () => {
    const unknown = path.join(tmp, "unknown-ws");
    fs.mkdirSync(unknown);
    const app = makeApp();
    const pending = exists(app, unknown);
    const p = await nextPrompt();
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "deny" });
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      success: false,
      error: "unknown cwd",
      reason: "cwd is not a known session or pinned directory.",
      hint: "Pin this directory to allow it, or open a session rooted in it.",
    });
    expect(pinned).toEqual([]);
  });
});

describe("6.1 the network guard's one denial path feeds the registry", () => {
  it("records a network denial with the source as its subject, body unchanged", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/sessions", async () => ({ ok: true }));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [], logDenial: () => {} }));
    const observed = vi.fn((request: { ip: string }) =>
      coordinator.onDenial(
        { plane: "network", rawSubject: request.ip, origin: "network-guard", channel: `source:${request.ip}`, requestHoldsCapability: false },
        false,
      ),
    );
    setNetworkDenialObserver(observed);

    const res = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: "203.0.113.9" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "network_not_allowed" });
    expect(observed).toHaveBeenCalledTimes(1);
    expect(coordinator.registry.list()[0]).toMatchObject({ plane: "network", subject: "203.0.113.9", mode: "deferred" });
    expect(sent.find((m) => m.type === "grant_request")).toMatchObject({ plane: "network" });
  });

  it("an observer that throws never alters the denial", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/sessions", async () => ({ ok: true }));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [], logDenial: () => {} }));
    setNetworkDenialObserver(() => {
      throw new Error("boom");
    });
    const res = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: "203.0.113.9" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "network_not_allowed" });
  });
});
