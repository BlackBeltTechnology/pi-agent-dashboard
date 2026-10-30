import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigPartial } from "../config-api.js";
import { livePublicBaseUrls, resetConfigSnapshot } from "../config-snapshot.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

/**
 * `allowedHosts` / `hostGate` partial writes + legacy publicBaseUrls live read
 * (test-plan #E11 write half, #E12, #E7). See change: add-host-allowlist-admission.
 */

let dir: string;
let file: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-api-host-gate-"));
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  file = path.join(dir, ".pi", "dashboard", "config.json");
  origHome = process.env.HOME!;
  process.env.HOME = dir;
  resetConfigSnapshot();
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
  resetConfigSnapshot();
});

function write(value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value));
}

function read(): any {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

describe("#E11 writeConfigPartial hostGate", () => {
  it("writes hostGate whole and leaves other keys intact", () => {
    write({ auth: { secret: "s" }, allowedHosts: ["a"], hostGate: { mode: "report" } });
    const result = writeConfigPartial({ hostGate: { mode: "enforce" } });
    expect(result.success).toBe(true);
    const raw = read();
    expect(raw.hostGate.mode).toBe("enforce");
    expect(raw.auth.secret).toBe("s");
    expect(raw.allowedHosts).toEqual(["a"]);
  });
});

// test-plan #E35 (harden-server-request-surfaces): the boot-line `source` is
// `default` only while the file carries no hostGate key, so an unrelated write
// must never seed one.
describe("#E35 unrelated write does not seed hostGate", () => {
  it("leaves the file without a hostGate key", () => {
    write({ allowedHosts: ["a"] });
    writeConfigPartial({ auth: { bypassUrls: ["/x"] } });
    expect(read().hostGate).toBeUndefined();
  });
});

describe("#E12 allowedHosts preservation / replacement", () => {
  it("an unrelated write preserves it; an explicit write replaces it whole", () => {
    write({ allowedHosts: ["a"] });
    writeConfigPartial({ auth: { bypassUrls: ["/x"] } });
    expect(read().allowedHosts).toEqual(["a"]);
    writeConfigPartial({ allowedHosts: ["b"] });
    expect(read().allowedHosts).toEqual(["b"]);
  });
});

describe("#E7 legacy pairing.publicBaseUrls is honoured by the live read", () => {
  it("falls back to pairing.publicBaseUrls when the top-level key is absent", () => {
    write({ pairing: { publicBaseUrls: ["https://old.example.com"] } });
    resetConfigSnapshot();
    expect(livePublicBaseUrls()).toEqual(["https://old.example.com"]);
  });
});

// test-plan #E5 (enforce-trusted-types-default): `security.trustedTypes` write semantics.
describe("#E5 writeConfigPartial security.trustedTypes", () => {
  const tt = (v: unknown) => writeConfigPartial({ security: { trustedTypes: v } });

  it.each([
    { stored: undefined, sent: "report", restart: true },
    { stored: "report", sent: "report", restart: false },
    { stored: "report", sent: "off", restart: true },
    { stored: undefined, sent: null, restart: false },
    { stored: "report", sent: null, restart: true },
  ] as const)("stored $stored, sent $sent → restartRequired $restart", ({ stored, sent, restart }) => {
    write(stored === undefined ? { auth: { secret: "s" } } : { security: { trustedTypes: stored } });
    const result = tt(sent);
    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(restart);
    if (sent === null) expect(read().security).toBeUndefined();
    else expect(read().security.trustedTypes).toBe(sent);
  });

  it("keeps a sibling security key, and removes only trustedTypes on null", () => {
    write({ security: { trustedTypes: "report", otherKey: 1 } });
    tt("off");
    expect(read().security).toEqual({ trustedTypes: "off", otherKey: 1 });
    tt(null);
    expect(read().security).toEqual({ otherKey: 1 });
  });

  it("an unrelated write never seeds a security key", () => {
    write({ allowedHosts: ["a"] });
    writeConfigPartial({ auth: { bypassUrls: ["/x"] } });
    expect(read().security).toBeUndefined();
  });

  it("never persists the computed trustedTypesEnvOverride echoed by a GET body", () => {
    write({});
    writeConfigPartial({ trustedTypesEnvOverride: "report", allowedHosts: ["a"] });
    expect(read().trustedTypesEnvOverride).toBeUndefined();
    expect(read().allowedHosts).toEqual(["a"]);
  });
});

describe("#E6 GET /api/config trustedTypesEnvOverride", () => {
  const KEY = "PI_DASHBOARD_TRUSTED_TYPES";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  async function fetchOverride(): Promise<unknown> {
    write({ port: 8000 });
    const app = Fastify();
    (app as any)._reloadAuth = async () => {};
    registerSystemRoutes(app, {
      sessionManager: {} as never,
      preferencesStore: { flush: () => {} } as never,
      metaPersistence: { flushAll: () => {} } as never,
      config: { port: 8000, piPort: 9999, dev: false } as never,
      networkGuard: (async () => {}) as never,
    } as never);
    const res = await app.inject({ method: "GET", url: "/api/config", remoteAddress: "127.0.0.1" });
    await app.close();
    return res.json().data.trustedTypesEnvOverride;
  }

  it.each([
    { env: "report", want: "report" },
    { env: " Report ", want: "report" },
    { env: undefined, want: null },
    { env: "strict", want: null },
  ] as const)("env $env → $want", async ({ env, want }) => {
    if (env === undefined) delete process.env[KEY];
    else process.env[KEY] = env;
    expect(await fetchOverride()).toBe(want);
  });
});
