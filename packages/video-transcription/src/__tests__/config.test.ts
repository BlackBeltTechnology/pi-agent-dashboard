import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseEnvFile } from "../config.js";

describe("parseEnvFile", () => {
  it("parses KEY=value lines, ignoring comments and blanks", () => {
    const parsed = parseEnvFile(
      ["# comment", "", "SONIOX_API_KEY=abc123", "  FOO = bar ", 'Q="quoted val"'].join("\n"),
    );
    expect(parsed.SONIOX_API_KEY).toBe("abc123");
    expect(parsed.FOO).toBe("bar");
    expect(parsed.Q).toBe("quoted val");
  });
});

describe("loadConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-config-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the key from env, ignoring .env", () => {
    fs.writeFileSync(path.join(dir, ".env"), "SONIOX_API_KEY=from-file");
    const cfg = loadConfig({ env: { SONIOX_API_KEY: "from-env" }, cwd: dir, skillDir: dir });
    expect(cfg.apiKey).toBe("from-env");
  });

  it("falls back to .env in cwd when env is unset", () => {
    fs.writeFileSync(path.join(dir, ".env"), "SONIOX_API_KEY=from-file");
    const cfg = loadConfig({ env: {}, cwd: dir, skillDir: dir });
    expect(cfg.apiKey).toBe("from-file");
  });

  it("falls back to .env in skillDir when cwd has none", () => {
    const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-skill-"));
    fs.writeFileSync(path.join(skillDir, ".env"), "SONIOX_API_KEY=from-skill");
    const cfg = loadConfig({ env: {}, cwd: dir, skillDir });
    expect(cfg.apiKey).toBe("from-skill");
    fs.rmSync(skillDir, { recursive: true, force: true });
  });

  it("throws an actionable error naming the variable when unresolved", () => {
    expect(() => loadConfig({ env: {}, cwd: dir, skillDir: dir })).toThrow(/SONIOX_API_KEY/);
  });

  it("uses default chunk/audio values", () => {
    const cfg = loadConfig({ env: { SONIOX_API_KEY: "k" }, cwd: dir, skillDir: dir });
    expect(cfg.maxChunkHours).toBe(4.5);
    expect(cfg.maxChunkSeconds).toBe(16200);
    expect(cfg.maxAudioMb).toBe(200);
  });

  it("parses env overrides for chunk/audio", () => {
    const cfg = loadConfig({
      env: { SONIOX_API_KEY: "k", MAX_CHUNK_HOURS: "4", MAX_AUDIO_MB: "0" },
      cwd: dir,
      skillDir: dir,
    });
    expect(cfg.maxChunkHours).toBe(4);
    expect(cfg.maxChunkSeconds).toBe(14400);
    expect(cfg.maxAudioMb).toBe(0);
  });

  it("ignores invalid numeric overrides and keeps defaults", () => {
    const cfg = loadConfig({
      env: { SONIOX_API_KEY: "k", MAX_CHUNK_HOURS: "nope", MAX_AUDIO_MB: "-5" },
      cwd: dir,
      skillDir: dir,
    });
    expect(cfg.maxChunkHours).toBe(4.5);
    expect(cfg.maxAudioMb).toBe(200);
  });
});
