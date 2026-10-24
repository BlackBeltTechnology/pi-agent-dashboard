/**
 * B17 — auth secret minting + short-secret warning (AE7–AE11, AE63, AE64).
 * See change: harden-auth-credentials (D1).
 *
 * WHY A SEPARATE FILE FROM `auth.test.ts`: `ensureAuthSecret` persists through
 * `CONFIG_FILE`, which is resolved at module load. These cases must assert
 * "config file untouched" byte-for-byte, so this file mocks `CONFIG_FILE` to a
 * private temp path — a file-scoped `vi.mock` that would leak into the
 * unrelated cases in `auth.test.ts`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({ file: "" }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/config.js")>()),
  get CONFIG_FILE() {
    return cfg.file;
  },
}));

type AuthModule = typeof import("../auth/auth.js");

let dir: string;
let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;

/** A fresh module instance — resets the module-level once-flag (AE63). */
async function freshAuth(): Promise<AuthModule> {
  vi.resetModules();
  return import("../auth/auth.js");
}

const allOutput = () =>
  [warn, log, err, info].flatMap((s) => s.mock.calls.map((c: unknown[]) => c.map(String).join(" ")));
const rotationLines = () => allOutput().filter((l) => /rotat/i.test(l));

function writeConfig(secret: string | undefined): string {
  const body = `${JSON.stringify({ auth: { providers: { github: { clientId: "id", clientSecret: "sec" } }, ...(secret === undefined ? {} : { secret }) } }, null, 2)}\n`;
  fs.writeFileSync(cfg.file, body);
  return body;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-secret-"));
  cfg.file = path.join(dir, "config.json");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("ensureAuthSecret — minting (AE7)", () => {
  it("AE7 mints 64-hex secrets, all distinct, no warning", async () => {
    const { ensureAuthSecret } = await freshAuth();
    writeConfig(undefined);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const config: AuthConfig = { secret: "", providers: {} };
      const s = ensureAuthSecret(config);
      expect(s).toMatch(/^[0-9a-f]{64}$/);
      expect(config.secret).toBe(s);
      seen.add(s);
    }
    expect(seen.size).toBe(100);
    expect(warn).not.toHaveBeenCalled();
    expect(rotationLines()).toHaveLength(0);
  });

  it("AE7 persists the minted secret to the config file", async () => {
    const { ensureAuthSecret } = await freshAuth();
    writeConfig(undefined);
    const s = ensureAuthSecret({ secret: "", providers: {} });
    expect(JSON.parse(fs.readFileSync(cfg.file, "utf8")).auth.secret).toBe(s);
  });
});

describe("ensureAuthSecret — existing secrets are kept (AE8, AE9)", () => {
  it.each([
    [1, 1],
    [31, 1],
    [32, 0],
    [33, 0],
    [64, 0],
  ])("AE8 length %i → %i warning(s), value + file untouched", async (len, warnings) => {
    const { ensureAuthSecret } = await freshAuth();
    const secret = "p".repeat(len);
    const before = writeConfig(secret);
    expect(ensureAuthSecret({ secret, providers: {} })).toBe(secret);
    expect(fs.readFileSync(cfg.file, "utf8")).toBe(before);
    expect(rotationLines()).toHaveLength(warnings);
  });

  it.each([
    ["32 chars non-hex", "ghijklmnopqrstuvwxyzghijklmnopqr", 0],
    ["16 × é (32 UTF-8 bytes, 16 chars)", "é".repeat(16), 1],
    ["20-char hex", "0123456789abcdef0123", 1],
  ])("AE9 %s → %i warning(s), kept", async (_n, secret, warnings) => {
    const { ensureAuthSecret } = await freshAuth();
    expect(ensureAuthSecret({ secret, providers: {} })).toBe(secret);
    expect(rotationLines()).toHaveLength(warnings);
  });
});

describe("ensureAuthSecret — warning never prints the secret (AE10)", () => {
  it("AE10 one rotation line; no 6-char substring of the secret in any output", async () => {
    const { ensureAuthSecret } = await freshAuth();
    const secret = "hunter2-short";
    ensureAuthSecret({ secret, providers: {} });
    expect(rotationLines()).toHaveLength(1);
    const out = allOutput().join("\n");
    for (let i = 0; i + 6 <= secret.length; i++) expect(out).not.toContain(secret.slice(i, i + 6));
  });
});

describe("ensureAuthSecret — sessions survive (AE11, AE64)", () => {
  it("AE11 an existing 32-hex secret is returned verbatim and keeps verifying tokens", async () => {
    const { ensureAuthSecret, verifyToken } = await freshAuth();
    const S32 = crypto.randomBytes(16).toString("hex");
    const before = writeConfig(S32);
    const mtime = fs.statSync(cfg.file).mtimeMs;
    const token = jwt.sign({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, S32);
    const result = ensureAuthSecret({ secret: S32, providers: {} });
    expect(result).toBe(S32);
    expect(fs.readFileSync(cfg.file, "utf8")).toBe(before);
    expect(fs.statSync(cfg.file).mtimeMs).toBe(mtime);
    expect(verifyToken(token, result)?.sub).toBe("u@example.com");
    expect(rotationLines()).toHaveLength(0);
  });

  it.each(["   ", "\t"])("AE64 whitespace-only secret %j is kept (not trimmed/re-minted), warned once, token verifies", async (secret) => {
    const { ensureAuthSecret, verifyToken } = await freshAuth();
    const before = writeConfig(secret);
    const token = jwt.sign({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, secret);
    const result = ensureAuthSecret({ secret, providers: {} });
    expect(result).toBe(secret);
    expect(fs.readFileSync(cfg.file, "utf8")).toBe(before);
    expect(rotationLines()).toHaveLength(1);
    expect(verifyToken(token, result)).not.toBeNull();
  });
});

describe("short-secret warning is once per process (AE63)", () => {
  it("AE63 registration + 3 reloads + a different short secret → exactly 1 warning; a fresh module warns again once", async () => {
    const { default: Fastify } = await import("fastify");
    const mk = async () => {
      const auth = await freshAuth();
      const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
      const app = Fastify();
      const authConfig = {
        secret: "hunter2-short",
        providers: { github: { clientId: "cid", clientSecret: "cs" } },
      } as AuthConfig;
      await registerAuthPlugin(app, { authConfig, port: 8000 });
      await app.ready();
      return { app, auth, authConfig };
    };

    let { app } = await mk();
    for (let i = 0; i < 3; i++) await (app as any)._reloadAuth({ secret: "hunter2-short", providers: { github: { clientId: "cid", clientSecret: "cs" } } });
    await (app as any)._reloadAuth({ secret: "other-short", providers: { github: { clientId: "cid", clientSecret: "cs" } } });
    expect(rotationLines()).toHaveLength(1);
    await app.close();

    warn.mockClear();
    log.mockClear();
    ({ app } = await mk());
    expect(rotationLines()).toHaveLength(1);
    await app.close();
  });
});
