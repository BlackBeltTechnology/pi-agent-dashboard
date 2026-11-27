/**
 * In-process configuration (test-plan S93): the schema rejects out-of-range values at settings write (never clamps), the
 * reader applies valid values and defaults (10000 ms / lean false / mode `session`), and a stored invalid value falls back
 * with one warning instead of being clamped.
 * See change: add-agent-teams-in-process.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { createConfigReader } from "../server/config.js";
import { capturingLogger } from "./harness/store-env.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(path.resolve(here, "..", "configSchema.json"), "utf8")) as Record<string, unknown>;
// Same options as dashboard-plugin-runtime's config-validator.
const validate = new Ajv({ coerceTypes: false, useDefaults: true, allErrors: true }).compile(schema);
const accepts = (cfg: Record<string, unknown>): boolean => validate(cfg) === true;

describe("schema: settings write", () => {
  it.each([
    ["absent", undefined, true],
    ["0", 0, false],
    ["-1", -1, false],
    ["1", 1, true],
    ["1.5", 1.5, false],
    ['"900"', "900", false],
    ["1e9", 1e9, true],
  ])("inProcessIdleTtlSec %s → accepted: %s", (_n, v, ok) => {
    expect(accepts(v === undefined ? {} : { inProcessIdleTtlSec: v })).toBe(ok);
  });

  it.each([
    ["0", 0, false],
    ["1", 1, false],
    ["999", 999, false],
    ["1000", 1000, true],
    ["10000", 10000, true],
    ["120000", 120000, true],
    ["120001", 120001, false],
    ["-5", -5, false],
    ["2^31", 2 ** 31, false],
    ['"10000"', "10000", false],
  ])("inProcessCmdTimeoutMs %s → accepted: %s (range 1000-120000, never clamped)", (_n, v, ok) => {
    expect(accepts({ inProcessCmdTimeoutMs: v })).toBe(ok);
  });

  it.each([
    ["absent", undefined, true],
    ["true", true, true],
    ['"yes"', "yes", false],
  ])("inProcessLeanChildren %s → accepted: %s", (_n, v, ok) => {
    expect(accepts(v === undefined ? {} : { inProcessLeanChildren: v })).toBe(ok);
  });

  it.each([
    ["unset", undefined, true],
    ["session", "session", true],
    ["in-process", "in-process", true],
    ["x", "x", false],
    ["IN-PROCESS", "IN-PROCESS", false],
  ])("teammateMode %s → accepted: %s", (_n, v, ok) => {
    expect(accepts(v === undefined ? {} : { teammateMode: v })).toBe(ok);
  });

  it.each([
    ["absent", undefined, true],
    ["0", 0, false],
    ["1", 1, true],
    ["1.5", 1.5, false],
    ["5000", 5000, true],
  ])("inProcessQueueTimeoutMs %s → accepted: %s (integer ≥ 1 or absent)", (_n, v, ok) => {
    expect(accepts(v === undefined ? {} : { inProcessQueueTimeoutMs: v })).toBe(ok);
  });

  it("an out-of-range value is rejected with an error on that key (not silently clamped)", () => {
    const cfg = { inProcessCmdTimeoutMs: 500 };
    expect(validate(cfg)).toBe(false);
    expect(validate.errors?.some((e) => e.instancePath === "/inProcessCmdTimeoutMs")).toBe(true);
    expect(cfg.inProcessCmdTimeoutMs).toBe(500);
  });

  it("fills the defaults: lean false, command timeout 10000, no idle TTL, no queue timeout, no forced mode", () => {
    const cfg: Record<string, unknown> = {};
    expect(validate(cfg)).toBe(true);
    expect(cfg.inProcessLeanChildren).toBe(false);
    expect(cfg.inProcessCmdTimeoutMs).toBe(10000);
    expect(cfg.inProcessIdleTtlSec).toBeUndefined();
    expect(cfg.inProcessQueueTimeoutMs).toBeUndefined();
    expect(cfg.teammateMode).toBeUndefined();
  });
});

describe("reader: applied values and fallbacks", () => {
  it("defaults when nothing is set", () => {
    const { logger } = capturingLogger();
    const cfg = createConfigReader(() => ({}), logger)();
    expect(cfg).toMatchObject({ inProcessCmdTimeoutMs: 10000, inProcessLeanChildren: false });
    expect(cfg.inProcessIdleTtlSec).toBeUndefined();
    expect(cfg.inProcessQueueTimeoutMs).toBeUndefined();
    expect(cfg.teammateMode).toBeUndefined(); // resolves to `session`
  });

  it("valid values are applied", () => {
    const { logger } = capturingLogger();
    const cfg = createConfigReader(() => ({ inProcessIdleTtlSec: 900, inProcessLeanChildren: true, inProcessCmdTimeoutMs: 30000, inProcessQueueTimeoutMs: 1000, teammateMode: "in-process" }), logger)();
    expect(cfg).toMatchObject({ inProcessIdleTtlSec: 900, inProcessLeanChildren: true, inProcessCmdTimeoutMs: 30000, inProcessQueueTimeoutMs: 1000, teammateMode: "in-process" });
  });

  it("a stored out-of-range value falls back to the default with one warning and is never clamped", () => {
    const { logger, logs } = capturingLogger();
    const read = createConfigReader(() => ({ inProcessCmdTimeoutMs: 2 ** 31, inProcessIdleTtlSec: 0, inProcessQueueTimeoutMs: 1.5 }), logger);
    const cfg = read();
    read();
    expect(cfg.inProcessCmdTimeoutMs).toBe(10000);
    expect(cfg.inProcessIdleTtlSec).toBeUndefined();
    expect(cfg.inProcessQueueTimeoutMs).toBeUndefined();
    expect(logs.warn.filter((w) => w.includes("inProcessCmdTimeoutMs"))).toHaveLength(1);
  });
});
