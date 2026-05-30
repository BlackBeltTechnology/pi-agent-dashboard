/**
 * Tests for pure helpers in `worktree-bootstrap.ts`:
 *   - `detectBootstrapRequirement(repoRoot)` — reads `<repoRoot>/.pi/settings.json`
 *     and decides whether a fresh worktree of this repo needs `node_modules`
 *     to host a working pi bridge. Fail-open on any read/parse error.
 *   - `pickInstallCommand(worktreePath)` — picks the install command by
 *     lockfile presence in the new worktree. Returns null when no
 *     recognized lockfile exists.
 *
 * See change: harden-worktree-spawn.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectBootstrapRequirement,
  pickInstallCommand,
} from "../worktree-bootstrap.js";

// ── tmp dir scaffolding ──────────────────────────────────────────────────
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worktree-bootstrap-test-"));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

function writeSettings(repoRoot: string, body: unknown): void {
  fs.mkdirSync(path.join(repoRoot, ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, ".pi", "settings.json"),
    typeof body === "string" ? body : JSON.stringify(body),
    "utf8",
  );
}

// ── detectBootstrapRequirement ───────────────────────────────────────────
describe("detectBootstrapRequirement", () => {
  it("(a) returns required when settings.json points bridge at worktree-local TS path (source='..')", () => {
    // Mirrors pi-agent-dashboard's own .pi/settings.json exactly.
    writeSettings(tmpRoot, {
      packages: [
        { source: "..", extensions: ["+packages/extension/src/bridge.ts"] },
      ],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: true });
  });

  it("(a') returns required when source is '.' (same-dir reference)", () => {
    writeSettings(tmpRoot, {
      packages: [
        { source: ".", extensions: ["+packages/extension/src/bridge.ts"] },
      ],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: true });
  });

  it("(b) returns NOT required for npm-only packages list", () => {
    writeSettings(tmpRoot, {
      packages: [
        "npm:@blackbelt-technology/pi-model-proxy",
        "npm:pi-web-access",
      ],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(b') returns NOT required for github-style packages list", () => {
    writeSettings(tmpRoot, {
      packages: [
        "https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
      ],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(b'') returns NOT required when source resolves OUTSIDE the repo (escapes via ../..)", () => {
    writeSettings(tmpRoot, {
      packages: [
        { source: "../..", extensions: ["+something.ts"] },
      ],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(b''') returns NOT required when entry has no extensions[] field", () => {
    writeSettings(tmpRoot, {
      packages: [{ source: "." }],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(c) returns NOT required when .pi/settings.json is absent", () => {
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(d) returns NOT required (fail-open) when settings.json is malformed JSON", () => {
    writeSettings(tmpRoot, "{ this is not json");
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(d') returns NOT required (fail-open) when settings.json is not an object", () => {
    writeSettings(tmpRoot, "[1,2,3]");
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("(d'') returns NOT required (fail-open) when packages field is missing", () => {
    writeSettings(tmpRoot, { defaultProvider: "anthropic" });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: false });
  });

  it("mixed packages: one TS bridge + several npm entries → required", () => {
    writeSettings(tmpRoot, {
      packages: [
        "npm:pi-web-access",
        { source: "..", extensions: ["+packages/extension/src/bridge.ts"] },
        "npm:context-mode",
      ],
    });
    expect(detectBootstrapRequirement(tmpRoot)).toEqual({ required: true });
  });
});

// ── pickInstallCommand ───────────────────────────────────────────────────
describe("pickInstallCommand", () => {
  it("npm: package-lock.json → npm ci", () => {
    fs.writeFileSync(path.join(tmpRoot, "package-lock.json"), "{}");
    expect(pickInstallCommand(tmpRoot)).toEqual({
      cmd: "npm", args: ["ci"], lockfile: "package-lock.json",
    });
  });

  it("pnpm: pnpm-lock.yaml → pnpm install --frozen-lockfile", () => {
    fs.writeFileSync(path.join(tmpRoot, "pnpm-lock.yaml"), "");
    expect(pickInstallCommand(tmpRoot)).toEqual({
      cmd: "pnpm", args: ["install", "--frozen-lockfile"], lockfile: "pnpm-lock.yaml",
    });
  });

  it("yarn: yarn.lock → yarn install --frozen-lockfile", () => {
    fs.writeFileSync(path.join(tmpRoot, "yarn.lock"), "");
    expect(pickInstallCommand(tmpRoot)).toEqual({
      cmd: "yarn", args: ["install", "--frozen-lockfile"], lockfile: "yarn.lock",
    });
  });

  it("bun: bun.lock → bun install --frozen-lockfile", () => {
    fs.writeFileSync(path.join(tmpRoot, "bun.lock"), "");
    expect(pickInstallCommand(tmpRoot)).toEqual({
      cmd: "bun", args: ["install", "--frozen-lockfile"], lockfile: "bun.lock",
    });
  });

  it("bun: bun.lockb → bun install --frozen-lockfile", () => {
    fs.writeFileSync(path.join(tmpRoot, "bun.lockb"), "");
    expect(pickInstallCommand(tmpRoot)).toEqual({
      cmd: "bun", args: ["install", "--frozen-lockfile"], lockfile: "bun.lockb",
    });
  });

  it("no lockfile → null", () => {
    expect(pickInstallCommand(tmpRoot)).toBeNull();
  });

  it("precedence: when npm + pnpm both present, npm wins (most common in dashboard)", () => {
    fs.writeFileSync(path.join(tmpRoot, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(tmpRoot, "pnpm-lock.yaml"), "");
    const r = pickInstallCommand(tmpRoot);
    expect(r?.cmd).toBe("npm");
  });
});
