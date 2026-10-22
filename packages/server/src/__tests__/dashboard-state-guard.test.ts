/**
 * Dashboard secrets (local token, identity key, config) stay out of reach of every
 * path-taking route, whatever anchor admits the path.
 *
 * The routes are the real ones; the caller is injected through the same
 * `stateCallerFor` + `runWithStateCaller` pair `server.ts` installs, driven by the
 * REAL admission predicates (proof cookie, session tag, strict on/off).
 *
 * See change: close-container-loopback-impersonation
 * (D8; test-plan #E12–#E15, #X4, #X5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants } from "../access/access-grants.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { stateCallerFor } from "../auth/dashboard-state-caller.js";
import { createLocalTrustContext, LOCAL_PROOF_COOKIE, signLocalProof } from "../auth/local-proof.js";
import { runWithStateCaller } from "../lib/dashboard-state-guard.js";
import { detectRipgrep, resetRipgrepCache } from "../ripgrep-detection.js";
import { gateFilePath, registerFileRoutes } from "../routes/file-routes.js";
import { registerGrepRoutes } from "../routes/grep-routes.js";

const MARKER = "TOKEN-MARKER-9f3a1c77d2";
const CONFIG_MARKER = "CONFIG-SECRET-MARKER-5b1e";

let home: string;
let origHome: string | undefined;
let proj: string;
let strict = true;
const ctx = createLocalTrustContext("tok-for-state-tests", () => strict);

type Kind = "unproven" | "proofed" | "session" | "device" | "optout";
const KINDS: Kind[] = ["unproven", "proofed", "session", "device", "optout"];

function tokenPath() { return path.join(home, ".pi", "dashboard", "local", "token"); }
function identityPath() { return path.join(home, ".pi", "dashboard", "identity.key"); }
function configPath() { return path.join(home, ".pi", "dashboard", "config.json"); }
function agentPath() { return path.join(home, ".pi", "agent", "x.md"); }

beforeEach(() => {
  origHome = process.env.HOME;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "state-guard-")));
  process.env.HOME = home;
  proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "state-proj-")));
  fs.mkdirSync(path.dirname(tokenPath()), { recursive: true });
  fs.mkdirSync(path.dirname(agentPath()), { recursive: true });
  fs.writeFileSync(tokenPath(), MARKER);
  fs.writeFileSync(identityPath(), `${MARKER}-identity`);
  fs.writeFileSync(configPath(), JSON.stringify({ auth: { secret: CONFIG_MARKER } }));
  fs.writeFileSync(agentPath(), "# agent file\n");
  strict = true;
  __resetAccessGrants();
  __resetPathDenials();
  installGrantCoordinator(null);
});
afterEach(() => {
  process.env.HOME = origHome;
  vi.restoreAllMocks();
  installGrantCoordinator(null);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
});

/** The injected caller: kind → headers (+ an auth tag the route tier would have set). */
function headersFor(kind: Kind): Record<string, string> {
  const h: Record<string, string> = { host: "127.0.0.1:8000", "x-test-kind": kind };
  if (kind === "proofed") h.cookie = `${LOCAL_PROOF_COOKIE}=${signLocalProof(ctx)}`;
  return h;
}

async function makeApp(cwds: string[], extra: Record<string, unknown> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", (request, _reply, done) => {
    const kind = request.headers["x-test-kind"] as Kind | undefined;
    // What the auth hooks would have tagged: a login session, or a paired-device bearer.
    if (kind === "session") {
      (request as { isAuthenticated?: boolean }).isAuthenticated = true;
      (request as { authVia?: string }).authVia = "session";
    } else if (kind === "device") {
      (request as { isAuthenticated?: boolean }).isAuthenticated = true;
      (request as { authVia?: string }).authVia = "device";
    }
    // "optout" = `requireLocalProof:false` for this request.
    const effective = kind === "optout" ? createLocalTrustContext("tok-for-state-tests", () => false) : ctx;
    runWithStateCaller(stateCallerFor(request, effective), done);
  });
  const sessionManager = { listAll: () => cwds.map((cwd) => ({ cwd })) } as never;
  registerFileRoutes(app, {
    sessionManager,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
    systemOpen: { capable: () => true, run: (cmd: string, args: string[]) => void opened.push([cmd, ...args]) },
    ...extra,
  } as never);
  registerGrepRoutes(app, { sessionManager, networkGuard: async () => undefined });
  await app.ready();
  return app;
}
const opened: Array<string[]> = [];
beforeEach(() => void (opened.length = 0));

const get = (app: FastifyInstance, kind: Kind, url: string) =>
  app.inject({ method: "GET", url, remoteAddress: "127.0.0.1", headers: headersFor(kind) });
const fileUrl = (cwd: string, p: string, route = "/api/file") =>
  `${route}?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}`;

describe("E12 — tiers by caller, through the ~/.pi anchor", () => {
  it("token and identity.key refused for every caller; config.json only for unproven and device; ~/.pi/agent for all", async () => {
    const app = await makeApp([proj]);
    const admitted = (res: { statusCode: number }) => res.statusCode === 200;
    for (const kind of KINDS) {
      expect(admitted(await get(app, kind, fileUrl(proj, tokenPath()))), `${kind} token`).toBe(false);
      expect(admitted(await get(app, kind, fileUrl(proj, identityPath()))), `${kind} identity.key`).toBe(false);
      const cfg = await get(app, kind, fileUrl(proj, configPath()));
      const wantCfg = kind === "proofed" || kind === "session" || kind === "optout";
      expect(admitted(cfg), `${kind} config.json`).toBe(wantCfg);
      if (wantCfg) expect(cfg.json().data.content).toContain(CONFIG_MARKER);
      else expect(cfg.body, `${kind} config body`).not.toContain(CONFIG_MARKER);
      expect(admitted(await get(app, kind, fileUrl(proj, agentPath()))), `${kind} ~/.pi/agent`).toBe(true);
    }
    await app.close();
  });

  it("a symlink INTO the dashboard dir and a $HOME symlink are seen through (real paths)", async () => {
    const link = path.join(proj, "link-to-local");
    fs.symlinkSync(path.dirname(tokenPath()), link);
    const app = await makeApp([proj]);
    const via = await get(app, "proofed", fileUrl(proj, path.join(link, "token")));
    expect(via.statusCode).toBe(403);
    expect(via.body).not.toContain(MARKER);
    await app.close();
  });
});

describe("E13 — a session outside $HOME cannot read the token through the ~/.pi anchor", () => {
  it("/api/file, /raw and /render refuse for a bare caller; no token bytes in any body", async () => {
    const app = await makeApp([proj]);
    for (const route of ["/api/file", "/api/file/raw", "/api/file/render"]) {
      const res = await get(app, "unproven", fileUrl(proj, tokenPath(), route));
      // `/render` rejects an extension-less file (400) before containment even runs; either way no bytes.
      expect(res.statusCode, route).toBe(route === "/api/file/render" ? 400 : 403);
      expect(res.body, route).not.toContain(MARKER);
    }
    await app.close();
  });

  it("also refused when the cwd IS $HOME (the token is then inside the session cwd)", async () => {
    const app = await makeApp([home]);
    for (const kind of KINDS) {
      const res = await get(app, kind, fileUrl(home, ".pi/dashboard/local/token"));
      expect(res.statusCode, kind).toBe(403);
      expect(res.body, kind).not.toContain(MARKER);
    }
    await app.close();
  });
});

describe("E14 — grep cannot surface the token", () => {
  afterEach(() => resetRipgrepCache());
  const rgBinary = (() => {
    try {
      return require("node:child_process").execFileSync("which", ["rg"], { encoding: "utf-8" }).trim() || null;
    } catch {
      return null;
    }
  })();

  it.each([
    ["no rg (JS fallback)", null],
    ["rg on PATH", rgBinary],
  ])("%s: zero matches for the marker, cwd = $HOME", async (_name, rg) => {
    if (_name === "rg on PATH" && !rg) return; // no ripgrep on this host: not observable here
    resetRipgrepCache();
    detectRipgrep(() => rg);
    const app = await makeApp([home]);
    for (const kind of ["unproven", "proofed"] as Kind[]) {
      const res = await get(app, kind, `/api/grep?cwd=${encodeURIComponent(home)}&q=${MARKER}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.matches, `${kind}/${_name}`).toEqual([]);
    }
    await app.close();
  });

  it("the match filter alone refuses a state-dir path even if a scanner returned it", async () => {
    const { isAllowed } = await import("../lib/path-containment.js");
    expect(await isAllowed(tokenPath(), { anchors: [home] })).toBe(false);
    expect(await isAllowed(path.join(home, "notes.txt"), { anchors: [home] })).toBe(true);
  });
});

describe("E15 — every path-taking route refuses the token", () => {
  it("mention resolve does not report it, open-in-system / reveal never spawn, and the live static gate refuses", async () => {
    const app = await makeApp([home]);
    const headers = { ...headersFor("unproven"), "content-type": "application/json", origin: "http://localhost:8000" };
    const post = (url: string, body: unknown) => app.inject({ method: "POST", url, remoteAddress: "127.0.0.1", headers, payload: JSON.stringify(body) });

    const mention = await post("/api/file/resolve-mention", { cwd: home, mention: "~/.pi/dashboard/local/token" });
    expect(mention.json().data).toEqual({ resolved: null });
    const mentionAbs = await post("/api/file/resolve-mention", { cwd: home, mention: tokenPath() });
    expect(mentionAbs.json().data).toEqual({ resolved: null });

    expect((await post("/api/open-in-system", { cwd: home, path: ".pi/dashboard/local/token" })).statusCode).toBe(403);
    expect((await post("/api/reveal-in-file-manager", { cwd: home, path: ".pi/dashboard/local/token" })).statusCode).toBe(403);
    expect(opened).toEqual([]);

    // The live static gates (server.ts) call gateFilePath; it must refuse with no remedy to act on.
    const gate = await runWithStateCaller(stateCallerFor({ ip: "127.0.0.1", headers: {} } as never, ctx), () =>
      gateFilePath(home, ".pi/dashboard/local/token", { listAll: () => [{ cwd: home }] } as never, { allowGrant: true }),
    );
    expect(gate).toMatchObject({ code: 403 });
    await app.close();
  });
});

describe("X4 — a symlink swapped in after the check is caught by the handle", () => {
  it("the open handle's (dev, ino) matches the always-refused token: refused, no bytes", async () => {
    // `proj/d/token` is a decoy that passes the path check; between stat and open `d` becomes a symlink to local/.
    fs.mkdirSync(path.join(proj, "d"));
    fs.writeFileSync(path.join(proj, "d", "token"), "decoy");
    const app = await makeApp([proj]);

    const realStat = fs.promises.stat.bind(fs.promises);
    let swapped = false;
    vi.spyOn(fs.promises, "stat").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      const result = await (realStat as (...a: unknown[]) => Promise<fs.Stats>)(p, ...rest);
      if (!swapped && String(p).endsWith(path.join("d", "token"))) {
        swapped = true;
        fs.renameSync(path.join(proj, "d"), path.join(proj, "d.orig"));
        fs.symlinkSync(path.dirname(tokenPath()), path.join(proj, "d"));
      }
      return result;
    }) as never);

    const res = await get(app, "unproven", fileUrl(proj, "d/token"));
    expect(swapped).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(MARKER);
    await app.close();
  });
});

describe("X5 — an unproven local caller cannot raise an access prompt", () => {
  it("immediate 403 for a miss outside every anchor; the coordinator is never asked. A proofed caller's identical miss still reaches it.", async () => {
    const onDenial = vi.fn(() => ({ held: false, result: Promise.resolve({ kind: "deny" as const, reason: "disabled" }), release: () => {} }));
    installGrantCoordinator({ onDenial } as never);
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "state-outside-")));
    fs.writeFileSync(path.join(outside, "f.txt"), "x");
    try {
      const app = await makeApp([proj]);
      const bare = await get(app, "unproven", fileUrl(proj, path.join(outside, "f.txt")));
      expect(bare.statusCode).toBe(403);
      expect(onDenial).not.toHaveBeenCalled();
      expect(bare.json().promptOutcome ?? "ineligible").toBe("ineligible");

      const proofed = await get(app, "proofed", fileUrl(proj, path.join(outside, "f.txt")));
      expect(proofed.statusCode).toBe(403);
      expect(onDenial).toHaveBeenCalledTimes(1);
      await app.close();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
