/**
 * configSchema.json accepts old (pre-dedicated) and new configs and applies the
 * new defaults. See change: add-dedicated-agent-browser (task 1.1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(path.resolve(here, "..", "..", "configSchema.json"), "utf-8")) as Record<string, unknown>;

// Same options as dashboard-plugin-runtime's config-validator.
const validate = new Ajv({ coerceTypes: false, useDefaults: true, allErrors: true }).compile(schema);

describe("browser-plugin configSchema (dedicated browser)", () => {
  it("parses a pre-dedicated config unchanged and fills the new defaults", () => {
    const old: Record<string, unknown> = {
      enabled: true,
      defaultBrowser: "Profile 2",
      allowMultipleInstancesPerProfile: false,
      browsers: { "Profile 2": { zeroDialog: true, allowedDomains: [".github.com"] } },
    };
    expect(validate(old)).toBe(true);
    expect(old.defaultBrowser).toBe("Profile 2");
    expect(old.onUnavailable).toBe("ask");
    expect(old.idleDisconnectMinutes).toBe(30);
    expect(old.openLiveViewOnConnect).toBe(true);
    expect(old.allowedDomains).toEqual([]);
  });

  it("defaults defaultBrowser to @dedicated on an empty config", () => {
    const cfg: Record<string, unknown> = {};
    expect(validate(cfg)).toBe(true);
    expect(cfg.defaultBrowser).toBe("@dedicated");
    expect(cfg.enabled).toBe(false);
  });

  it("accepts a fully populated new config", () => {
    expect(
      validate({
        enabled: true,
        defaultBrowser: "@headless",
        realProfile: "Profile 21",
        onUnavailable: "next",
        idleDisconnectMinutes: 120,
        openLiveViewOnConnect: false,
        allowedDomains: ["example.com"],
      }),
    ).toBe(true);
  });

  it.each([
    ["onUnavailable", "later"],
    ["idleDisconnectMinutes", 31],
    ["idleDisconnectMinutes", -5],
    ["openLiveViewOnConnect", "yes"],
    ["allowedDomains", "example.com"],
    ["realProfile", 3],
  ])("rejects %s = %j", (key, value) => {
    expect(validate({ [key]: value })).toBe(false);
  });

  it.each([0, 5, 30, 120])("accepts idleDisconnectMinutes %i", (n) => {
    expect(validate({ idleDisconnectMinutes: n })).toBe(true);
  });

  it("no longer describes allowMultipleInstancesPerProfile as pending workstream 2c", () => {
    const flag = (schema.properties as Record<string, { description?: string }>).allowMultipleInstancesPerProfile;
    expect(flag.description).not.toMatch(/2c|lands with/);
  });
});
