import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseBackends, parseEnvFile } from "../config.js";

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
    expect(cfg.targets[0].apiKey).toBe("from-env");
  });

  it("falls back to .env in cwd when env is unset", () => {
    fs.writeFileSync(path.join(dir, ".env"), "SONIOX_API_KEY=from-file");
    const cfg = loadConfig({ env: {}, cwd: dir, skillDir: dir });
    expect(cfg.targets[0].apiKey).toBe("from-file");
  });

  it("falls back to .env in skillDir when cwd has none", () => {
    const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-skill-"));
    fs.writeFileSync(path.join(skillDir, ".env"), "SONIOX_API_KEY=from-skill");
    const cfg = loadConfig({ env: {}, cwd: dir, skillDir });
    expect(cfg.targets[0].apiKey).toBe("from-skill");
    fs.rmSync(skillDir, { recursive: true, force: true });
  });

  it("throws an actionable error naming the variable when unresolved", () => {
    expect(() => loadConfig({ env: {}, cwd: dir, skillDir: dir })).toThrow(/SONIOX_API_KEY/);
  });

  it("uses default chunk/audio values", () => {
    const cfg = loadConfig({ env: { SONIOX_API_KEY: "k" }, cwd: dir, skillDir: dir });
    expect(cfg.targets[0].maxChunkHours).toBe(4.5);
    expect(cfg.targets[0].maxChunkSeconds).toBe(16200);
    expect(cfg.maxAudioMb).toBe(200);
  });

  it("parses env overrides for chunk/audio", () => {
    const cfg = loadConfig({
      env: { SONIOX_API_KEY: "k", MAX_CHUNK_HOURS: "4", MAX_AUDIO_MB: "0" },
      cwd: dir,
      skillDir: dir,
    });
    expect(cfg.targets[0].maxChunkHours).toBe(4);
    expect(cfg.targets[0].maxChunkSeconds).toBe(14400);
    expect(cfg.maxAudioMb).toBe(0);
  });

  it("ignores invalid numeric overrides and keeps defaults", () => {
    const cfg = loadConfig({
      env: { SONIOX_API_KEY: "k", MAX_CHUNK_HOURS: "nope", MAX_AUDIO_MB: "-5" },
      cwd: dir,
      skillDir: dir,
    });
    expect(cfg.targets[0].maxChunkHours).toBe(4.5);
    expect(cfg.maxAudioMb).toBe(200);
  });

  const concurrency = (raw?: string) =>
    loadConfig({
      env: raw === undefined ? { SONIOX_API_KEY: "k" } : { SONIOX_API_KEY: "k", TRANSCRIBE_CONCURRENCY: raw },
      cwd: dir,
      skillDir: dir,
    }).concurrency;

  it("defaults concurrency to 8 when unset", () => {
    expect(concurrency()).toBe(8);
  });

  it("parses a valid positive integer concurrency", () => {
    expect(concurrency("4")).toBe(4);
  });

  it("falls back to the default for zero, negative, or non-numeric concurrency", () => {
    expect(concurrency("0")).toBe(8);
    expect(concurrency("-2")).toBe(8);
    expect(concurrency("abc")).toBe(8);
  });

  it("clamps concurrency above the Soniox pending cap to 100", () => {
    expect(concurrency("250")).toBe(100);
  });

  it("truncates a fractional concurrency value", () => {
    expect(concurrency("3.9")).toBe(3);
  });
});

describe("backend selection", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-backend-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const load = (env: NodeJS.ProcessEnv) => loadConfig({ env, cwd: dir, skillDir: dir });

  it("defaults to the soniox backend with the .srt suffix", () => {
    const cfg = load({ SONIOX_API_KEY: "k" });
    expect(cfg.targets[0].backend).toBe("soniox");
    expect(cfg.targets[0].srtSuffix).toBe(".srt");
    expect(cfg.targets[0].maxChunkHours).toBe(4.5);
  });

  it("selects assemblyai with its own key, suffix, and 9h chunk default", () => {
    const cfg = load({ TRANSCRIBE_BACKEND: "assemblyai", ASSEMBLY_AI_KEY: "aai" });
    expect(cfg.targets[0].backend).toBe("assemblyai");
    expect(cfg.targets[0].apiKey).toBe("aai");
    expect(cfg.targets[0].srtSuffix).toBe(".diarize.srt");
    expect(cfg.targets[0].maxChunkHours).toBe(9);
  });

  it("resolves ASSEMBLY_AI_KEY from .env with the same resolver as soniox", () => {
    fs.writeFileSync(path.join(dir, ".env"), "ASSEMBLY_AI_KEY=from-dotenv\n");
    expect(load({ TRANSCRIBE_BACKEND: "assemblyai" }).targets[0].apiKey).toBe("from-dotenv");
  });

  it("demands the backend's own key, not the other backend's", () => {
    expect(() => load({ TRANSCRIBE_BACKEND: "assemblyai", SONIOX_API_KEY: "k" })).toThrow(
      /ASSEMBLY_AI_KEY is not set/,
    );
  });

  it("falls back to soniox on an unknown backend value", () => {
    expect(load({ TRANSCRIBE_BACKEND: "whisper", SONIOX_API_KEY: "k" }).targets[0].backend).toBe("soniox");
  });

  it("reads optional language, speaker cap, and suffix overrides", () => {
    const cfg = load({
      TRANSCRIBE_BACKEND: "assemblyai",
      ASSEMBLY_AI_KEY: "aai",
      TRANSCRIBE_LANGUAGE: "hu",
      TRANSCRIBE_MAX_SPEAKERS: "4",
      TRANSCRIBE_SRT_SUFFIX: ".aai.srt",
    });
    expect(cfg.languageCode).toBe("hu");
    expect(cfg.maxSpeakers).toBe(4);
    expect(cfg.targets[0].srtSuffix).toBe(".aai.srt");
  });

  it("leaves language and speaker cap unset when absent or invalid", () => {
    const cfg = load({ TRANSCRIBE_BACKEND: "assemblyai", ASSEMBLY_AI_KEY: "aai", TRANSCRIBE_MAX_SPEAKERS: "0" });
    expect(cfg.languageCode).toBeUndefined();
    expect(cfg.maxSpeakers).toBeUndefined();
  });

  it("resolves both backends, each with its own key and suffix", () => {
    const cfg = load({
      TRANSCRIBE_BACKEND: "both",
      SONIOX_API_KEY: "snx",
      ASSEMBLY_AI_KEY: "aai",
    });
    expect(cfg.targets.map((t) => t.backend)).toEqual(["soniox", "assemblyai"]);
    expect(cfg.targets.map((t) => t.apiKey)).toEqual(["snx", "aai"]);
    expect(cfg.targets.map((t) => t.srtSuffix)).toEqual([".srt", ".diarize.srt"]);
    expect(cfg.targets.map((t) => t.maxChunkHours)).toEqual([4.5, 9]);
  });

  it("demands every selected backend's key before any upload", () => {
    expect(() => load({ TRANSCRIBE_BACKEND: "both", SONIOX_API_KEY: "snx" })).toThrow(
      /ASSEMBLY_AI_KEY is not set/,
    );
  });

  it("ignores a suffix override when several backends are selected", () => {
    const cfg = load({
      TRANSCRIBE_BACKEND: "both",
      SONIOX_API_KEY: "snx",
      ASSEMBLY_AI_KEY: "aai",
      TRANSCRIBE_SRT_SUFFIX: ".x.srt",
    });
    expect(cfg.targets.map((t) => t.srtSuffix)).toEqual([".srt", ".diarize.srt"]);
  });
});

describe("parseBackends", () => {
  it("defaults to soniox when unset or unknown", () => {
    expect(parseBackends(undefined)).toEqual(["soniox"]);
    expect(parseBackends("whisper")).toEqual(["soniox"]);
    expect(parseBackends("  ")).toEqual(["soniox"]);
  });

  it("expands both/all to every backend in run order", () => {
    expect(parseBackends("both")).toEqual(["soniox", "assemblyai"]);
    expect(parseBackends(" ALL ")).toEqual(["soniox", "assemblyai"]);
  });

  it("accepts a comma-separated list and collapses duplicates", () => {
    expect(parseBackends("assemblyai,soniox")).toEqual(["soniox", "assemblyai"]);
    expect(parseBackends("soniox,soniox")).toEqual(["soniox"]);
    expect(parseBackends("assemblyai,whisper")).toEqual(["assemblyai"]);
  });
});
