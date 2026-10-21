/**
 * `POST /api/pi-trust/query` — authentication, validation, switches, proofs,
 * rate limits, permits, budget accounting and log hygiene.
 *
 * Covers test-plan #E11 #E12 #E13 #E18 #E19 #E20 #E21 #E22 (counter half) #X7.
 * Harness after `local-credential-fastify.test.ts` (real loopback socket for the
 * local proof) and `route-tier-gate.test.ts` (bearer + tier gate through inject).
 * See change: mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  canonicalBinding,
  httpPurpose,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { PI_TRUST_QUERY_PATH } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-live-query.js";
import { trustResourceDigest, trustResourceManifest } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-resource-digest.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPiTrustLiveProvider, type PiTrustLiveProvider } from "../access/pi-trust-live.js";
import { YoloController } from "../access/yolo-session.js";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { registerPiTrustQueryRoutes } from "../routes/pi-trust-query-routes.js";

const TOKEN = "query-route-token-0123456789abcdefghijklmnopqrstuvwxyz";
const MIN = 60_000;

let root: string;
let home: string;
let cfg: PiTrustMirrorConfig;
let yolo: YoloController;
let app: FastifyInstance;
let port: number;
let registry: PairedDeviceRegistry;
let logs: string[];
let t: number;
let counters: () => ReturnType<ReturnType<typeof registerPiTrustQueryRoutes>["counters"]>;

type Hooks = {
  manifest?: Parameters<typeof registerPiTrustQueryRoutes>[1]["manifest"];
  live?: () => PiTrustLiveProvider | undefined;
};

function mkdir(...p: string[]): string {
  const d = path.join(root, ...p);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}
/** A folder holding pi project resources (so a digest exists). */
function project(...p: string[]): string {
  const d = mkdir(...p);
  fs.mkdirSync(path.join(d, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(d, ".pi", "settings.json"), "{}");
  fs.writeFileSync(path.join(d, ".pi", "mcp.json"), '{"servers":{}}');
  return d;
}

let realLive: PiTrustLiveProvider;

async function start(hooks: Hooks = {}): Promise<void> {
  realLive = createPiTrustLiveProvider({
    getConfig: () => cfg,
    listSessionTrust: () => [],
    listSessionGrants: () => [],
    getYolo: () => yolo,
    home,
    now: () => t,
    denyRules: () => ({ exact: [], subtree: [] }),
  });
  app = Fastify();
  app.decorateRequest("isAuthenticated", false);
  const verifier = createLocalCredentialVerifier({ token: TOKEN, acceptLegacyToken: true, log: () => {} });
  const boundAt = Date.now() - 1000;
  app.addHook("onRequest", async (request) => {
    verifier.stamp(request.raw, { kind: "http", boundAt });
  });
  // Fixture: a login-cookie session (models auth-plugin's `authVia: "session"`).
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-cookie"]) {
      (req as unknown as Record<string, unknown>).isAuthenticated = true;
      (req as unknown as Record<string, unknown>).authVia = "session";
      (req as unknown as Record<string, unknown>).principalTier = "operate";
    }
  });
  registerBearerAuth(app, { registry });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
  const handle = registerPiTrustQueryRoutes(app, {
    getConfig: () => cfg,
    live: hooks.live ?? (() => realLive),
    readSnapshot: () => null,
    home,
    denyRules: () => ({ exact: [], subtree: [path.join(home, ".ssh")] }),
    nowMs: () => t,
    log: (l) => logs.push(l),
    ...(hooks.manifest ? { manifest: hooks.manifest } : {}),
  });
  counters = handle.counters;
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-query-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  t = 1_000_000;
  logs = [];
  cfg = {
    enabled: true,
    coverInteractive: false,
    liveQuery: true,
    sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
  };
  yolo = new YoloController({
    now: () => t,
    hostGateMode: () => "enforce",
    isRefused: () => false,
    ladder: async () => [],
    onLog: () => {},
  });
  registry = new PairedDeviceRegistry(path.join(root, "paired.json"));
});

afterEach(async () => {
  await app?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const url = (): string => `http://127.0.0.1:${port}${PI_TRUST_QUERY_PATH}`;

function proofHeader(): Record<string, string> {
  return {
    "X-Pi-Local-Proof": mintProof({
      token: TOKEN,
      binding: canonicalBinding("127.0.0.1", port),
      purpose: httpPurpose("POST", PI_TRUST_QUERY_PATH),
    }).header,
  };
}

async function local(cwd: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url(), {
    method: "POST",
    headers: { "content-type": "application/json", ...proofHeader(), ...extra },
    body: JSON.stringify({ cwd }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const REMOTE_ADDR = "203.0.113.9";
async function device(token: string, body: unknown, rawPayload?: string) {
  const res = await app.inject({
    method: "POST",
    url: PI_TRUST_QUERY_PATH,
    remoteAddress: REMOTE_ADDR,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: rawPayload ?? JSON.stringify(body),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

const operateToken = (name = "op"): string => registry.add(name, "manual", "operate").token;

async function yoloRoot(dir: string): Promise<void> {
  const r = await yolo.activate({ durationMs: 15 * MIN, base: dir });
  expect(r.ok).toBe(true);
}

describe("#E11 authentication", () => {
  it("refuses everything but a verified local proof or an operate device, disclosing nothing", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start();
    const op = operateToken();
    const observe = registry.add("ob", "manual", "observe").token;

    const refused = (r: { status: number; body: Record<string, unknown> }): void => {
      expect(r.status).toBe(401);
      expect(Object.keys(r.body).sort()).toEqual(["error", "success"]);
    };

    // no credential
    {
      const res = await fetch(url(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: w }) });
      refused({ status: res.status, body: (await res.json()) as Record<string, unknown> });
    }
    // raw legacy token (accepted by the verifier, but not a verified proof)
    {
      const res = await fetch(url(), {
        method: "POST",
        headers: { "content-type": "application/json", "X-Pi-Local-Token": TOKEN },
        body: JSON.stringify({ cwd: w }),
      });
      refused({ status: res.status, body: (await res.json()) as Record<string, unknown> });
    }
    // login cookie session only
    {
      const res = await fetch(url(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-cookie": "1" },
        body: JSON.stringify({ cwd: w }),
      });
      refused({ status: res.status, body: (await res.json()) as Record<string, unknown> });
    }
    // loopback + forwarding header + a verified proof
    refused(await local(w, { "X-Forwarded-For": "198.51.100.7" }));

    // loopback + verified proof → answered
    const ok = await local(w);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ covered: true, key: w, sourceKind: "yolo" });

    // operate bearer → answered
    const dev = await device(op, { cwd: w });
    expect(dev.status).toBe(200);
    expect(dev.body.covered).toBe(true);

    // below operate → 403 insufficient_scope (the global tier gate, via ROUTE_TIERS)
    const low = await device(observe, { cwd: w });
    expect(low.status).toBe(403);
    expect(low.body.error).toBe("insufficient_scope");
    expect(low.body.covered).toBeUndefined();
    expect(counters().refused).toBe(4);
  });
});

describe("#E12 validation", () => {
  it("caps the body at 8 KiB and the cwd at 4,096 characters; malformed input is 400, never 500", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start();
    const op = operateToken();

    const pad = (n: number): string => {
      const prefix = '{"cwd":"';
      const suffix = '","x":"';
      const tail = '"}';
      const fill = n - prefix.length - w.length - suffix.length - tail.length;
      return `${prefix}${w}${suffix}${"a".repeat(fill)}${tail}`;
    };
    expect(Buffer.byteLength(pad(8192))).toBe(8192);
    expect((await device(op, null, pad(8192))).status).toBe(200);
    expect((await device(op, null, pad(8193))).status).toBe(413);

    const longCwd = (n: number): string => `/${"a".repeat(n - 1)}`;
    expect(longCwd(4096)).toHaveLength(4096);
    const atCap = await device(op, { cwd: longCwd(4096) });
    expect(atCap.status).toBe(200);
    expect(atCap.body).toEqual({ covered: false });
    expect((await device(op, { cwd: longCwd(4097) })).status).toBe(400);
    expect((await device(op, { cwd: "/w/\u0000x" })).status).toBe(400);
    expect((await device(op, { cwd: "work/x" })).status).toBe(400);
    expect((await device(op, { cwd: 5 })).status).toBe(400);
    expect((await device(op, null, "{not json")).status).toBe(400);
    expect((await device(op, [])).status).toBe(400);
  });

  it("a symlinked cwd is answered not covered", async () => {
    const real = project("real");
    await yoloRoot(real);
    const link = path.join(root, "link");
    fs.symlinkSync(real, link);
    await start();
    expect((await local(path.join(link, "app"))).body).toEqual({ covered: false });
    expect((await local(real)).body).toMatchObject({ covered: true });
  });
});

describe("#E13 server-side switches", () => {
  it("answers not covered whenever enabled or liveQuery is off, or the cwd is denied", async () => {
    const w = project("w");
    await yoloRoot(root); // covers w and ~/.ssh/x alike; only the deny rule can tell them apart
    await start();
    expect((await local(w)).body.covered).toBe(true);
    cfg.enabled = false;
    expect((await local(w)).body).toEqual({ covered: false });
    cfg.enabled = true;
    cfg.liveQuery = false;
    expect((await local(w)).body).toEqual({ covered: false });
    cfg.liveQuery = true;

    const secret = path.join(home, ".ssh", "x");
    fs.mkdirSync(secret, { recursive: true });
    expect((await local(secret)).body).toEqual({ covered: false });
  });
});

describe("#E18 salt and cwd binding", () => {
  it("each answer has a fresh salt, and an answer replayed for another cwd fails to verify", async () => {
    const w = mkdir("w");
    const a = project("w", "a");
    const b = project("w", "b");
    await yoloRoot(w);
    await start();
    const op = operateToken();
    const first = (await device(op, { cwd: a })).body as { salt: string; digest: string };
    const second = (await device(op, { cwd: a })).body as { salt: string; digest: string };
    expect(first.salt).not.toBe(second.salt);

    const manifestB = (await trustResourceManifest(b, { home })) as string;
    expect(trustResourceDigest(first.salt, b, manifestB)).not.toBe(first.digest);
    const manifestA = (await trustResourceManifest(a, { home })) as string;
    expect(trustResourceDigest(first.salt, a, manifestA)).toBe(first.digest);
  });
});

describe("#E19 remote disclosure", () => {
  it("a covered answer to a paired device has exactly covered, salt, digest", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start();
    const { body } = await device(operateToken(), { cwd: w });
    expect(Object.keys(body).sort()).toEqual(["covered", "digest", "salt"]);
  });

  it("an empty resource set answers not covered (nothing to bind)", async () => {
    const w = mkdir("w"); // no .pi, no .agents/skills
    await yoloRoot(w);
    await start();
    expect((await device(operateToken(), { cwd: w })).body).toEqual({ covered: false });
  });
});

describe("#E20 rate limits and permits", () => {
  it("a device gets 20 queries per 10 s, the 21st is refused; one log line per window", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start();
    const op = operateToken();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) statuses.push((await device(op, { cwd: w })).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(logs.filter((l) => l.includes("rate limited"))).toHaveLength(1);
    expect(counters().rateLimited).toBe(5);
    t += 10_001; // new window
    expect((await device(op, { cwd: w })).status).toBe(200);
  });

  it("the local user gets 200 per 10 s, the 201st is refused", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start();
    let refused = 0;
    let ok = 0;
    for (let i = 0; i < 201; i += 1) {
      const r = await local(w);
      if (r.status === 429) refused += 1;
      else if (r.status === 200) ok += 1;
    }
    expect({ ok, refused }).toEqual({ ok: 200, refused: 1 });
  });

  it("a second concurrent digest from one device and a fifth from five devices are refused", async () => {
    const w = project("w");
    await yoloRoot(w);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let inFlight = 0;
    await start({
      manifest: async () => {
        inFlight += 1;
        await gate;
        return "m";
      },
    });
    const tokens = [1, 2, 3, 4, 5].map((i) => operateToken(`d${i}`));

    // same device, two at once
    const same = [device(tokens[0], { cwd: w }), device(tokens[0], { cwd: w })];
    await new Promise((r) => setTimeout(r, 50));
    expect(inFlight).toBe(1);
    release();
    const sameStatuses = (await Promise.all(same)).map((r) => r.status).sort();
    expect(sameStatuses).toEqual([200, 429]);
  });

  it("five devices at once: the fifth proof is refused (global semaphore of 4)", async () => {
    const w = project("w");
    await yoloRoot(w);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await start({
      manifest: async () => {
        await gate;
        return "m";
      },
    });
    const tokens = [1, 2, 3, 4, 5].map((i) => operateToken(`d${i}`));
    const calls = tokens.map((tok) => device(tok, { cwd: w }));
    await new Promise((r) => setTimeout(r, 80));
    release();
    const statuses = (await Promise.all(calls)).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
  });
});

describe("#E21 local identity answers take no permit", () => {
  it("30 concurrent local queries covered by a live entry: none refused, no digest computed", async () => {
    const w = project("w");
    await yoloRoot(w);
    let manifests = 0;
    await start({
      manifest: async () => {
        manifests += 1;
        return "m";
      },
    });
    const results = await Promise.all(Array.from({ length: 30 }, () => local(w)));
    expect(results.every((r) => r.status === 200 && r.body.covered === true)).toBe(true);
    expect(manifests).toBe(0);
  });
});

describe("#E22 budget accounting (counters)", () => {
  it("counts a local miss over 300 ms but not a remote answer at 500 ms (budget 1000)", async () => {
    const w = project("w");
    await yoloRoot(w);
    const inner = () => realLive;
    await start({
      live: () => {
        const real = inner();
        return {
          ...real,
          covering: (k: string) => {
            t += 350; // slow handling
            return real.covering(k);
          },
        };
      },
    });
    await local(w);
    expect(counters().budgetMissed).toBe(1);
    expect(counters().covered).toBe(1);
  });

  it("remote handling of 500 ms stays inside its 1000 ms budget", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start({
      manifest: async (cwd, o) => {
        t += 500;
        return trustResourceManifest(cwd, o);
      },
    });
    await device(operateToken(), { cwd: w });
    expect(counters().budgetMissed).toBe(0);
    expect(counters().covered).toBe(1);
  });
});

describe("#X7 log hygiene", () => {
  it("a cwd with newline and ESC never reaches the rate-limit log unescaped", async () => {
    const w = project("w");
    await yoloRoot(w);
    await start();
    const op = operateToken("dev\n[ok] \u001b[2J");
    const cwd = "/w/\n[ok] \u001b[2Jx";
    for (let i = 0; i < 25; i += 1) await device(op, { cwd });
    const lines = logs.filter((l) => l.includes("rate limited"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(logs.join("")).not.toContain("\u001b");
  });
});
