/**
 * One-shot rotation of the local token + auth secret.
 * See change: close-container-loopback-impersonation (D11; test-plan #E22, #X1, #X2).
 */
import jwt from "jsonwebtoken";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpProofHeaders } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { createLocalCredentialVerifier, hasLocalCredential } from "../auth/local-credential.js";
import {
  REQUIRED_ROTATION_EPOCH,
  ROTATION_LOCK_WAIT_CAP_MS,
  RotationError,
  rotateSecretsOnce,
} from "../auth/secret-rotation.js";

let home: string;
let origHome: string | undefined;
const dash = () => path.join(home, ".pi", "dashboard");
const localDir = () => path.join(dash(), "local");
const tokenFile = () => path.join(localDir(), "token");
const epochFile = () => path.join(localDir(), "rotation-epoch");
const lockFile = () => path.join(localDir(), "rotation.lock");
const cfgFile = () => path.join(dash(), "config.json");
const readSecret = () => (JSON.parse(fs.readFileSync(cfgFile(), "utf-8")) as { auth: { secret: string } }).auth.secret;

function seed(token = "T0-old-token", secret = "S0-old-secret-0123456789abcdef") {
  fs.mkdirSync(localDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenFile(), token, { mode: 0o600 });
  fs.writeFileSync(cfgFile(), JSON.stringify({ port: 9, auth: { secret } }), { mode: 0o600 });
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "rotation-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

/** A fake clock whose `sleep` advances time, so a 35 s wait costs no real time. */
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
}

describe("rotateSecretsOnce (E22)", () => {
  it("rotates the token and auth.secret once, then never again; old proof and old JWT stop working", async () => {
    seed();
    const t0 = fs.readFileSync(tokenFile(), "utf-8");
    const s0 = readSecret();
    const jwt0 = jwt.sign({ sub: "u" }, s0);

    const first = await rotateSecretsOnce();
    expect(first.rotated).toBe(true);
    const t1 = fs.readFileSync(tokenFile(), "utf-8").trim();
    const s1 = readSecret();
    expect(t1).not.toBe(t0);
    expect(s1).not.toBe(s0);
    expect(first.newSecret).toBe(s1);
    expect(s1).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, like every other mint (harden-auth-credentials B17)
    expect(Number(fs.readFileSync(epochFile(), "utf-8"))).toBe(REQUIRED_ROTATION_EPOCH);
    expect(fs.existsSync(lockFile())).toBe(false);
    if (process.platform !== "win32") expect(fs.statSync(tokenFile()).mode & 0o777).toBe(0o600);

    const second = await rotateSecretsOnce();
    expect(second.rotated).toBe(false);
    expect(fs.readFileSync(tokenFile(), "utf-8").trim()).toBe(t1);
    expect(readSecret()).toBe(s1);

    // A proof minted from T0 no longer verifies against the rotated token.
    const url = "http://127.0.0.1:8000/api/restart";
    const verifier = createLocalCredentialVerifier({ token: t1, acceptLegacyToken: false, log: () => {} });
    const lower = (h: Record<string, string>): Record<string, unknown> => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    const stale = { headers: lower(httpProofHeaders(t0.trim(), url, "POST")), method: "POST", url: "/api/restart", socket: { localAddress: "127.0.0.1", localPort: 8000 } };
    verifier.stamp(stale, { kind: "http", boundAt: 0, port: 8000 });
    expect(hasLocalCredential(stale.headers)).toBe(false);
    const fresh = { headers: lower(httpProofHeaders(t1, url, "POST")), method: "POST", url: "/api/restart", socket: { localAddress: "127.0.0.1", localPort: 8000 } };
    verifier.stamp(fresh, { kind: "http", boundAt: 0, port: 8000 });
    expect(hasLocalCredential(fresh.headers)).toBe(true);
    // Control: the SAME stale proof is valid under the OLD token, so the rejection above is the rotation's doing.
    const control = { headers: lower(httpProofHeaders(t0.trim(), url, "POST")), method: "POST", url: "/api/restart", socket: { localAddress: "127.0.0.1", localPort: 8000 } };
    createLocalCredentialVerifier({ token: t0.trim(), acceptLegacyToken: false, log: () => {} }).stamp(control, { kind: "http", boundAt: 0, port: 8000 });
    expect(hasLocalCredential(control.headers)).toBe(true);

    // A JWT signed with S0 no longer verifies under S1.
    expect(() => jwt.verify(jwt0, s1)).toThrow();
    expect(() => jwt.verify(jwt0, s0)).not.toThrow();
  });

  it("a fresh install (no token, no config) just records the epoch", async () => {
    const r = await rotateSecretsOnce();
    expect(r.rotated).toBe(true);
    expect(r.newSecret).toBeUndefined();
    expect(fs.existsSync(tokenFile())).toBe(true);
    expect(fs.existsSync(epochFile())).toBe(true);
  });

  it("two concurrent starts rotate exactly once", async () => {
    seed();
    const results = await Promise.all([rotateSecretsOnce(), rotateSecretsOnce(), rotateSecretsOnce()]);
    expect(results.filter((r) => r.rotated)).toHaveLength(1);
    const t1 = fs.readFileSync(tokenFile(), "utf-8");
    await rotateSecretsOnce();
    expect(fs.readFileSync(tokenFile(), "utf-8")).toBe(t1);
  });

  it("takes over a lock whose holder pid is dead", async () => {
    seed();
    fs.writeFileSync(lockFile(), JSON.stringify({ pid: 999_999, at: Date.now() }));
    const clock = fakeClock();
    const r = await rotateSecretsOnce({ now: clock.now, sleep: clock.sleep, isPidAlive: () => false });
    expect(r.rotated).toBe(true);
  });

  it("takes over a lock older than 30 s even if the pid looks alive", async () => {
    seed();
    const clock = fakeClock();
    fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, at: clock.now() - 31_000 }));
    const r = await rotateSecretsOnce({ now: clock.now, sleep: clock.sleep, isPidAlive: () => true });
    expect(r.rotated).toBe(true);
  });
});

describe("rotation fails closed", () => {
  it("X1: a lock held by a live pid → RotationError(lock) after the 35 s cap, epoch absent; later start rotates", async () => {
    seed();
    const clock = fakeClock();
    const holder = () => fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, at: clock.now() }));
    holder();
    // Keep the holder "fresh" so the 30 s staleness rule does not free it.
    const sleep = async (ms: number) => {
      await clock.sleep(ms);
      holder();
    };
    const err = await rotateSecretsOnce({ now: clock.now, sleep, isPidAlive: () => true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RotationError);
    const e = err as RotationError;
    expect(e.step).toBe("lock");
    expect(e.describe()).toContain(lockFile());
    expect(e.describe()).toContain(epochFile());
    expect(e.describe().split("\n")).toHaveLength(1);
    expect(clock.now() - 1_000_000).toBeGreaterThanOrEqual(ROTATION_LOCK_WAIT_CAP_MS);
    expect(fs.existsSync(epochFile())).toBe(false);

    fs.unlinkSync(lockFile());
    expect((await rotateSecretsOnce()).rotated).toBe(true);
  });

  it("X2: auth.secret write failure → RotationError(secret), epoch absent; next start rotates again fully", async () => {
    seed();
    const t0 = fs.readFileSync(tokenFile(), "utf-8");
    const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const err = await rotateSecretsOnce({ writeConfig: () => { throw eacces; } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RotationError);
    expect((err as RotationError).step).toBe("secret");
    expect(fs.existsSync(epochFile())).toBe(false);
    expect(fs.existsSync(lockFile())).toBe(false);
    const tMid = fs.readFileSync(tokenFile(), "utf-8");
    expect(tMid).not.toBe(t0); // the token was already replaced; harmless

    const s0 = readSecret();
    const r = await rotateSecretsOnce();
    expect(r.rotated).toBe(true);
    expect(fs.readFileSync(tokenFile(), "utf-8")).not.toBe(tMid);
    expect(readSecret()).not.toBe(s0);
    expect(fs.existsSync(epochFile())).toBe(true);
  });
});
