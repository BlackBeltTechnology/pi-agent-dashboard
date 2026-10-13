/**
 * ACP config registry + numeric clamps via `loadConfig()`.
 * See change: add-acp-session-driver (test-plan #E17, #E18).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";

let tmpHome: string;
let realHome: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "acp-cfg-"));
  realHome = process.env.HOME ?? "";
  process.env.HOME = tmpHome;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env.HOME = realHome;
  warn.mockRestore();
  rmSync(tmpHome, { recursive: true, force: true });
});

function seed(cfg: Record<string, unknown>): void {
  const file = path.join(tmpHome, ".pi", "dashboard", "config.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg));
}
const acpWarnings = () => warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => /acp/i.test(m));

describe("acpAgents registry", () => {
  it("E17: keeps the first valid agent, drops duplicates and malformed entries with warnings", () => {
    seed({
      acpAgents: [
        { id: "qmt", name: "querymt", command: "qmtcode", args: ["--stdio"] },
        { id: "qmt", name: "dup", command: "other" },
        { id: "nocmd", name: "x" },
        { id: "badargs", name: "y", command: "c", args: "nope" },
      ],
    });
    const cfg = loadConfig();
    expect(cfg.acpAgents).toHaveLength(1);
    expect(cfg.acpAgents[0]).toMatchObject({ id: "qmt", name: "querymt", command: "qmtcode", args: ["--stdio"], durable: false, env: {} });
    expect(acpWarnings()).toHaveLength(3);
  });

  it("defaults: absent → no agents, default settings, no warnings", () => {
    seed({});
    const cfg = loadConfig();
    expect(cfg.acpAgents).toEqual([]);
    expect(cfg.acp).toEqual({ protocolV2: false, spawnTimeoutMs: 30_000, requestTimeoutMs: 30_000, maxLineBytes: 4 * 1024 * 1024, eventLogMaxBytes: 64 * 1024 * 1024 });
    expect(acpWarnings()).toHaveLength(0);
  });

  it("durable and name fallback", () => {
    seed({ acpAgents: [{ id: "a", command: "c", durable: true }] });
    expect(loadConfig().acpAgents[0]).toMatchObject({ id: "a", name: "a", durable: true });
  });

  it("non-array acpAgents is ignored with a warning", () => {
    seed({ acpAgents: "x" });
    expect(loadConfig().acpAgents).toEqual([]);
    expect(acpWarnings()).toHaveLength(1);
  });
});

describe("acp numeric clamps", () => {
  it("E18: spawnTimeoutMs 4999/5000/120000/120001/'x'", () => {
    const cases: Array<[unknown, number, number]> = [
      [4999, 5000, 1],
      [5000, 5000, 0],
      [120000, 120000, 0],
      [120001, 120000, 1],
      ["x", 30000, 1],
    ];
    for (const [input, expected, warnings] of cases) {
      warn.mockClear();
      seed({ acp: { spawnTimeoutMs: input } });
      expect(loadConfig().acp.spawnTimeoutMs, String(input)).toBe(expected);
      expect(acpWarnings(), String(input)).toHaveLength(warnings);
    }
  });

  it("E18: maxLineBytes 65535 → 65536, 67108865 → 67108864; other keys clamp", () => {
    seed({ acp: { maxLineBytes: 65535, requestTimeoutMs: 999_999, eventLogMaxBytes: 10, protocolV2: true } });
    const { acp } = loadConfig();
    expect(acp.maxLineBytes).toBe(65536);
    expect(acp.requestTimeoutMs).toBe(300_000);
    expect(acp.eventLogMaxBytes).toBe(1_048_576);
    expect(acp.protocolV2).toBe(true);
    expect(acpWarnings()).toHaveLength(3);
    seed({ acp: { maxLineBytes: 67108865 } });
    expect(loadConfig().acp.maxLineBytes).toBe(67108864);
  });
});
