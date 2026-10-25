/**
 * Static contracts for the Docker credential data key (D6, decision G9):
 * the `pi-key` volume wiring (E84), the entrypoint key generation rules (E86),
 * and the Dockerfile directory/VOLUME/licence lines. The entrypoint block is also
 * EXECUTED here (its path rewritten into a temp dir) so generation mode, the
 * refuse-on-envelope rule and the preset-path rule are proven, not just grepped.
 *
 * See change: encrypt-credentials-at-rest (tasks 11.2; test-plan E84, E86).
 */

import { spawnSync } from "node:child_process"; // ban:child_process-ok — runs the entrypoint block under test
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8");
const KEY_DIR = "/home/pi/.pi-key";

interface Compose {
  services?: Record<string, { volumes?: unknown[]; tmpfs?: unknown[] }>;
  volumes?: Record<string, { driver_opts?: { type?: string } } | null>;
}
// Compose-only tags (`!override`, `!reset`) are unknown to the YAML core schema; drop them for parsing.
const compose = (name: string): Compose => YAML.parse(read("docker", name).replace(/ !(override|reset)\b/g, "")) as Compose;
const mounts = (c: Compose, svc: string): string[] => (c.services?.[svc]?.volumes ?? []).filter((v): v is string => typeof v === "string");

describe("E84: compose mounts the pi-key volume", () => {
  it("E84: compose.yml mounts a named pi-key at /home/pi/.pi-key next to pi-state", () => {
    const c = compose("compose.yml");
    expect(mounts(c, "pi-dashboard")).toContain(`pi-key:${KEY_DIR}`);
    expect(mounts(c, "pi-dashboard")).toContain("pi-state:/home/pi/.pi");
    expect(c.volumes).toHaveProperty("pi-key");
  });

  it("E84: compose.test.yml overrides pi-key to a tmpfs, like pi-state", () => {
    const c = compose("compose.test.yml");
    expect(c.volumes?.["pi-key"]?.driver_opts?.type).toBe("tmpfs");
    expect(c.volumes?.["pi-state"]?.driver_opts?.type).toBe("tmpfs");
  });

  it("E84: the peer service has its own peer-key tmpfs at /home/pi/.pi-key", () => {
    const c = compose("compose.test.peer.yml");
    expect(mounts(c, "pi-dashboard-peer")).toContain(`peer-key:${KEY_DIR}`);
    expect(mounts(c, "pi-dashboard-peer")).toContain("peer-state:/home/pi/.pi");
    expect(c.volumes?.["peer-key"]?.driver_opts?.type).toBe("tmpfs");
  });

  it("E84: overlays inherit the mount — none replaces the pi-dashboard volumes list", () => {
    for (const f of ["compose.test.acme.yml", "compose.test.cap.yml", "compose.test.identity.yml", "compose.dev.yml"]) {
      const text = read("docker", f);
      expect(text, f).not.toMatch(/^\s*volumes:\s*!(override|reset)/m);
      for (const m of mounts(compose(f), "pi-dashboard")) expect(m, f).not.toContain(KEY_DIR);
    }
  });

  it("E84: test-entrypoint.sh and peer-entrypoint.sh reach the key logic only through entrypoint.sh", () => {
    const te = read("docker", "test-entrypoint.sh");
    expect(te).toContain("/usr/local/bin/entrypoint.sh");
    expect(te).not.toMatch(/data-key|\.pi-key/);
    const pe = read("docker", "peer-entrypoint.sh");
    expect(pe).toContain("/usr/local/bin/test-entrypoint.sh");
    expect(pe).not.toMatch(/data-key|\.pi-key/);
  });
});

describe("Dockerfile ships the key directory and the keyring licence", () => {
  const dockerfile = read("docker", "Dockerfile");

  it("creates /home/pi/.pi-key owned by pi, mode 0700, and declares it a VOLUME", () => {
    expect(dockerfile).toMatch(/mkdir -p[^\n]*\/home\/pi\/\.pi-key/);
    expect(dockerfile).toMatch(/chown[^\n]*pi:pi[^\n]*\/home\/pi\/\.pi-key/);
    expect(dockerfile).toMatch(/chmod 0?700[^\n]*\/home\/pi\/\.pi-key/);
    expect(dockerfile).toMatch(/VOLUME \[[^\]]*"\/home\/pi\/\.pi-key"[^\]]*\]/);
  });

  it("fails the build when the Linux keyring package's LICENSE.third-party.md is missing", () => {
    expect(dockerfile).toMatch(/@napi-rs\/keyring-linux-\*-gnu\/LICENSE\.third-party\.md/);
  });
});

/** The generation block of entrypoint.sh, between its markers. */
const entrypoint = read("docker", "entrypoint.sh");
const BLOCK = /# >>> credential-data-key\n([\s\S]*?)# <<< credential-data-key/.exec(entrypoint)?.[1] ?? "";

describe("E86: entrypoint key generation never puts the key in argv", () => {
  it("E86: the credential-data-key block exists", () => {
    expect(BLOCK).not.toBe("");
  });

  it("E86: generation runs under umask 077 and writes by redirect from /dev/urandom or openssl rand", () => {
    expect(BLOCK).toMatch(/umask 077/);
    expect(BLOCK).toMatch(/(\/dev\/urandom|openssl rand)[^\n]*>\s*"?\$\{?[A-Za-z_]+\}?"?/);
  });

  it("E86: no command argument carries the key (no assignment from urandom/openssl, no echo/printf of key data)", () => {
    expect(BLOCK).not.toMatch(/=\s*\$\([^)]*(urandom|openssl rand)/);
    expect(BLOCK).not.toMatch(/=\s*`[^`]*(urandom|openssl rand)/);
    expect(BLOCK).not.toMatch(/\b(echo|printf)\b[^\n]*\$\{?(KEY|DATA_KEY|key)\b/);
  });

  it("E86: it checks BOTH credential files for the envelope prefix before generating", () => {
    expect(BLOCK).toContain("plugin-credentials.json");
    expect(BLOCK).toContain("vault.json");
    expect(BLOCK).toContain("pi-dashboard-encrypted:");
    expect(BLOCK.indexOf("pi-dashboard-encrypted:")).toBeLessThan(BLOCK.search(/umask 077/));
  });

  it("E86: it generates only at the default path (decision G9) and never under a preset custom path", () => {
    expect(BLOCK).toContain('DEFAULT_DATA_KEY_DIR="/home/pi/.pi-key"');
    expect(BLOCK).toContain('DEFAULT_DATA_KEY_FILE="${DEFAULT_DATA_KEY_DIR}/data-key"');
    expect(BLOCK).toMatch(/\[ "\$\{PI_DASHBOARD_DATA_KEY_FILE\}" = "\$\{DEFAULT_DATA_KEY_FILE\}" \]/);
  });

  it("E86: it warns when the key directory is not a dedicated mount", () => {
    expect(BLOCK).toMatch(/mountinfo/);
    expect(BLOCK).toMatch(/WARNING[^\n]*\$\{DEFAULT_DATA_KEY_DIR\}/);
  });
});

describe("E86: the entrypoint block, executed", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Runs the block with `/home/pi/.pi-key` rewritten into a temp dir; returns the env it leaves and its output. */
  function runBlock(opts: { preset?: string; envelopeIn?: "vault" | "plugin" | "none"; existingKey?: string; plaintextVault?: boolean }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "entrypoint-key-"));
    dirs.push(root);
    const home = path.join(root, "home");
    const keyDir = path.join(root, "pi-key");
    fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
    fs.mkdirSync(keyDir);
    if (opts.envelopeIn === "vault") fs.writeFileSync(path.join(home, ".pi", "dashboard", "vault.json"), "pi-dashboard-encrypted:v1\n{}");
    if (opts.envelopeIn === "plugin") fs.writeFileSync(path.join(home, ".pi", "agent", "plugin-credentials.json"), "pi-dashboard-encrypted:v1\n{}");
    if (opts.plaintextVault) fs.writeFileSync(path.join(home, ".pi", "dashboard", "vault.json"), '{"version":1}');
    if (opts.existingKey) fs.writeFileSync(path.join(keyDir, "data-key"), opts.existingKey, { mode: 0o600 });
    const script = `set -euo pipefail\n${BLOCK.replaceAll(KEY_DIR, keyDir)}\necho "FINAL=\${PI_DASHBOARD_DATA_KEY_FILE:-}"\n`;
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home };
    if (opts.preset) env.PI_DASHBOARD_DATA_KEY_FILE = opts.preset.replaceAll(KEY_DIR, keyDir);
    const r = spawnSync("bash", ["-c", script], { env, encoding: "utf8" });
    return { r, keyDir, keyFile: path.join(keyDir, "data-key"), out: `${r.stdout}${r.stderr}` };
  }

  it("E86: fresh volume — exports the default path and generates a 0600 key of 32 random bytes", () => {
    const { r, keyFile, keyDir, out } = runBlock({});
    expect(r.status).toBe(0);
    expect(out).toContain(`FINAL=${keyFile}`);
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    const body = fs.readFileSync(keyFile, "utf8");
    expect(Buffer.from(body.trim(), "base64")).toHaveLength(32);
    // The key content never reaches the log.
    expect(out).not.toContain(body.trim());
    expect(fs.readdirSync(keyDir)).toEqual(["data-key"]);
  });

  it("E86: an existing key file is left byte-identical", () => {
    const existing = `${Buffer.alloc(32, 7).toString("base64")}\n`;
    const { r, keyFile } = runBlock({ existingKey: existing });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(keyFile, "utf8")).toBe(existing);
  });

  it.each(["vault", "plugin"] as const)("E86: an envelope in the %s file refuses to generate, prints the remedy, and still exits 0", (which) => {
    const { r, keyFile, out } = runBlock({ envelopeIn: which });
    expect(r.status).toBe(0);
    expect(fs.existsSync(keyFile)).toBe(false);
    expect(out).toMatch(/refus/i);
    expect(out).toContain("data-key");
    expect(out).toContain("FINAL=");
  });

  it("E86: a plaintext vault does not block generation", () => {
    const { r, keyFile } = runBlock({ plaintextVault: true });
    expect(r.status).toBe(0);
    expect(fs.existsSync(keyFile)).toBe(true);
  });

  it("E86: a preset custom path is never overridden and nothing is generated (decision G9)", () => {
    const { r, keyFile, out } = runBlock({ preset: `${KEY_DIR}/elsewhere/key`, envelopeIn: "vault" });
    expect(r.status).toBe(0);
    expect(fs.existsSync(keyFile)).toBe(false);
    expect(out).toMatch(/FINAL=.*elsewhere\/key/);
    const generated = runBlock({ preset: `${KEY_DIR}/elsewhere/key` });
    expect(fs.existsSync(generated.keyFile)).toBe(false);
    expect(fs.existsSync(path.join(generated.keyDir, "elsewhere", "key"))).toBe(false);
  });

  it("E86: the not-a-mount warning names /home/pi/.pi-key and does not stop the start", () => {
    const { r, out } = runBlock({});
    expect(r.status).toBe(0);
    // A temp dir is not a mountpoint.
    expect(out).toMatch(/WARNING/);
  });
});
