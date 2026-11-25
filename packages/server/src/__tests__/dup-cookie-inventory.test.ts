/**
 * No legitimate `pi_dash_*` duplicates — the dashboard never self-duplicates its own cookies.
 *
 *  T.E126  every emission of a `pi_dash_*` name in `packages/server/src` has exactly one (name, path) pair and no
 *          `Domain=`; adding a second path or a domain for a `pi_dash_*` name fails this test.
 *
 * Static scan of the source plus a runtime check of what the real routes emit. The duplicate-cookie gate refuses a
 * request carrying one name twice; if the server ever set the same name at two paths (or host-only and domain-wide),
 * a legitimate browser would send both and lock itself out.
 *
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #E126).
 *
 * @structural-pin a static inventory of every `pi_dash_*` cookie emission is the point: no runtime path enumerates them all
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn(async () => ({ accessToken: "access-token" }));
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (exchange as any)(...a),
  fetchUserInfo: async () => ({ email: "u@example.com", name: "U", username: "u" }),
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { registerBearerAuth, registerDeviceSessionRoutes } from "../auth/bearer-auth.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";

const SRC = path.resolve(__dirname, "..");

/** The one place expiry lines are allowed to name many paths / a Domain: the refusal itself. */
const EXPIRY_EMITTER = "auth/duplicate-cookie-gate.ts";

/** (name → paths) the server is expected to emit. `pi_dash_pool_*` is one family: one cookie per pool port, never the same name twice. */
const EXPECTED: Record<string, string[]> = {
  pi_dash_token: ["/"],
  pi_dash_local: ["/"],
  pi_dash_device: ["/api/"],
  pi_dash_oauth_state: ["/auth/"],
  "pi_dash_pool_*": ["/"],
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test-support" || e.name === "__fixtures__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Text of the call starting at `open` (index of its `(`), up to the matching `)`. */
function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

interface Emission {
  file: string;
  name: string;
  path: string;
  domain: boolean;
  how: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a property/soak workload is one flat loop nest by nature; splitting it would hide the invariant
function scan(): { emissions: Emission[]; unresolved: string[]; emitterFiles: Set<string>; constConflicts: string[] } {
  const files = sourceFiles(SRC);
  const consts = new Map<string, Set<string>>();
  for (const f of files) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\bconst\s+(\w+)\s*=\s*["'`](pi_dash_[A-Za-z0-9_]*)["'`]/g)) {
      consts.set(m[1], (consts.get(m[1]) ?? new Set()).add(m[2]));
    }
  }
  const constConflicts = [...consts].filter(([, v]) => v.size > 1).map(([k]) => k);
  const resolve = (expr: string): string | undefined => {
    const lit = /^["'`](pi_dash_[A-Za-z0-9_]*)["'`]$/.exec(expr.trim());
    if (lit) return lit[1];
    const v = consts.get(expr.trim());
    return v && v.size === 1 ? [...v][0] : undefined;
  };

  const emissions: Emission[] = [];
  const unresolved: string[] = [];
  const emitterFiles = new Set<string>();
  for (const f of files) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    // 1. @fastify/cookie: reply.setCookie(NAME, value, { path, … }) / reply.clearCookie(NAME, { path })
    for (const m of src.matchAll(/\.(setCookie|clearCookie)\s*\(/g)) {
      emitterFiles.add(rel);
      const call = callText(src, m.index! + m[0].length - 1);
      const nameExpr = /^\(\s*([^,)]+)/.exec(call)?.[1] ?? "";
      const name = resolve(nameExpr);
      const p = /\bpath:\s*["'`]([^"'`]+)["'`]/.exec(call)?.[1];
      if (name === undefined) {
        // a cookie that is not a dashboard one (no pi_dash_ prefix at all) is not ours to inventory
        if (/pi_dash_/.test(nameExpr)) unresolved.push(`${rel}: ${m[1]}(${nameExpr})`);
        else if (!consts.has(nameExpr.trim())) unresolved.push(`${rel}: ${m[1]}(${nameExpr}) — name is not a known pi_dash_* constant`);
        continue;
      }
      emissions.push({ file: rel, name, path: p ?? "(none)", domain: /\bdomain\s*:/i.test(call), how: m[1] });
    }
    // 2. hand-written `set-cookie` response headers carrying a pi_dash_ name
    if (rel !== EXPIRY_EMITTER) {
      for (const m of src.matchAll(/\.header\(\s*["']set-cookie["']\s*,\s*`([^`]*)`/gi)) {
        emitterFiles.add(rel);
        const head = /^\$\{(\w+)\}/.exec(m[1]);
        const prefix = head ? [...(consts.get(head[1]) ?? [])][0] : /^(pi_dash_[A-Za-z0-9_]*)/.exec(m[1])?.[1];
        if (!prefix) {
          unresolved.push(`${rel}: header set-cookie \`${m[1]}\``);
          continue;
        }
        // `pi_dash_pool_` + `${port}` is a family with a per-port suffix; any other name is exact
        const family = /^pi_dash_pool_$/.test(prefix) ? "pi_dash_pool_*" : prefix;
        emissions.push({ file: rel, name: family, path: /Path=([^;`\s]+)/i.exec(m[1])?.[1] ?? "(none)", domain: /Domain=/i.test(m[1]), how: "set-cookie header" });
      }
    }
  }
  return { emissions, unresolved, emitterFiles, constConflicts };
}

describe("T.E126 — static inventory of pi_dash_* emissions", () => {
  const { emissions, unresolved, emitterFiles, constConflicts } = scan();

  it("the scan is not blind: every cookie-emitting file is known, every name resolves, no constant is ambiguous", () => {
    expect(constConflicts).toEqual([]);
    expect(unresolved).toEqual([]);
    expect([...emitterFiles].sort()).toEqual(
      ["auth/auth-plugin.ts", "auth/bearer-auth.ts", "live-server/preview-pool.ts", "routes/local-proof-routes.ts"].sort(),
    );
    // all four dashboard credentials plus the pool family were found
    expect(new Set(emissions.map((e) => e.name))).toEqual(new Set(Object.keys(EXPECTED)));
  });

  it("each pi_dash_* name has exactly one (name, path) pair, equal to the documented one", () => {
    const byName = new Map<string, Set<string>>();
    for (const e of emissions) byName.set(e.name, (byName.get(e.name) ?? new Set()).add(e.path));
    const actual = Object.fromEntries([...byName].map(([k, v]) => [k, [...v].sort()]));
    expect(actual).toEqual(EXPECTED);
    for (const [name, paths] of byName) expect(paths.size, `${name} paths: ${[...paths].join(", ")}`).toBe(1);
  });

  it("no emission carries a Domain attribute (a host-only cookie cannot collide with a domain-wide twin)", () => {
    expect(emissions.filter((e) => e.domain).map((e) => `${e.file} ${e.name}`)).toEqual([]);
  });

  it("every set / clear pair for a name agrees on the path (clearing never targets a different path)", () => {
    for (const e of emissions) expect(e.path, `${e.file} ${e.how} ${e.name}`).toBe(EXPECTED[e.name][0]);
  });

  it("the only place a Domain= for a pi_dash_* name may appear is the refusal's expiry lines", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      if (rel === EXPIRY_EMITTER) continue;
      const src = fs.readFileSync(f, "utf8");
      if (/pi_dash_[\s\S]{0,200}Domain=/.test(src) && /(set-cookie|setCookie)/i.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("T.E126 — runtime: what the real routes put on the wire", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dupcookie-inv-"));
    exchange.mockClear();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("login (state + session) and the device exchange: one path per name, host-only, matches the static inventory", async () => {
    const app = Fastify();
    await app.register(fastifyCookie);
    app.decorateRequest("isAuthenticated", false);
    const registry = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
    registerBearerAuth(app, { registry });
    registerDeviceSessionRoutes(app, { registry, isSecure: () => false });
    await registerAuthPlugin(app, {
      authConfig: { secret: "test-secret-32-chars-long-abcdef", providers: { github: { clientId: "cid", clientSecret: "cs" } }, allowedUsers: ["*@example.com"] } as AuthConfig,
      port: 8000,
    });
    await app.ready();
    try {
      const all: string[] = [];
      const grab = (res: { headers: Record<string, any> }) => all.push(...([] as string[]).concat(res.headers["set-cookie"] ?? []));

      const start = await app.inject({ method: "GET", url: "/auth/start/github" });
      grab(start);
      const state = new URL(start.headers.location as string).searchParams.get("state")!;
      const stateCookie = ([] as string[]).concat(start.headers["set-cookie"] as string[]).find((c) => c.startsWith("pi_dash_oauth_state="))!;
      const cb = await app.inject({ method: "GET", url: `/auth/callback/github?code=c&state=${state}`, headers: { cookie: stateCookie.split(";")[0]! } });
      grab(cb);
      const d = registry.add("d", "pairing", "operate");
      const dev = await app.inject({ method: "POST", url: "/api/device-session", remoteAddress: "127.0.0.1", headers: { authorization: `Bearer ${d.token}` } });
      grab(dev);
      grab(await app.inject({ method: "DELETE", url: "/api/device-session", remoteAddress: "127.0.0.1" }));
      grab(await app.inject({ method: "GET", url: "/auth/logout" }));

      const pairs = new Map<string, Set<string>>();
      for (const line of all) {
        const name = line.split("=")[0];
        if (!name.startsWith("pi_dash_")) continue;
        expect(line, line).not.toMatch(/;\s*Domain=/i);
        const p = /;\s*Path=([^;]+)/i.exec(line)?.[1] ?? "(none)";
        pairs.set(name, (pairs.get(name) ?? new Set()).add(p));
      }
      // token, state, device all observed; each at exactly one path, the documented one
      expect(Object.fromEntries([...pairs].map(([k, v]) => [k, [...v]]))).toEqual({
        pi_dash_oauth_state: ["/auth/"],
        pi_dash_token: ["/"],
        pi_dash_device: ["/api/"],
      });
    } finally {
      await app.close();
    }
  });
});
