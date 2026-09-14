/**
 * redactWriteOnly unit tests (spec add-browser-relay, browser-plugin-settings
 * F2 / GAP A): nested properties, patternProperties, object-shaped
 * additionalProperties (the browsers.<anyDir>.token shape), non-writeOnly
 * preservation, absent-schema pass-through, purity.
 *
 * See change: add-browser-relay (GAP A).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redactPluginConfigForClient, redactWriteOnly } from "../config-redact.js";
import { clearDiscoveryCache } from "../loader.js";

const browserSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean", default: false },
    defaultBrowser: { type: "string" },
    browsers: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          token: { type: "string", writeOnly: true },
          zeroDialog: { type: "boolean" },
          allowedDomains: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

describe("redactWriteOnly", () => {
  it("strips writeOnly properties under nested properties", () => {
    const out = redactWriteOnly(
      { apiKey: "secret", name: "keep", nested: { apiKey: "s2", ok: 1 } },
      {
        type: "object",
        properties: {
          apiKey: { type: "string", writeOnly: true },
          name: { type: "string" },
          nested: {
            type: "object",
            properties: { apiKey: { type: "string", writeOnly: true }, ok: { type: "number" } },
          },
        },
      },
    );
    expect(out).toEqual({ name: "keep", nested: { ok: 1 } });
  });

  it("covers browsers.<anyProfileDir>.token via additionalProperties (the browser plugin shape)", () => {
    const config = {
      enabled: true,
      defaultBrowser: "Default",
      browsers: {
        Default: { token: "tok-default", zeroDialog: true, allowedDomains: ["github.com"] },
        "Profile 37": { token: "tok-37", allowedDomains: [] },
      },
    };
    const out = redactWriteOnly(config, browserSchema) as typeof config;
    expect(out.browsers.Default).toEqual({ zeroDialog: true, allowedDomains: ["github.com"] });
    expect(out.browsers["Profile 37"]).toEqual({ allowedDomains: [] });
    expect(JSON.stringify(out)).not.toContain("tok-");
    // non-writeOnly siblings untouched
    expect(out.enabled).toBe(true);
    expect(out.defaultBrowser).toBe("Default");
  });

  it("covers patternProperties-keyed maps", () => {
    const out = redactWriteOnly(
      { "env-prod": { secret: "s", name: "prod" } },
      {
        type: "object",
        patternProperties: {
          "^env-": { type: "object", properties: { secret: { writeOnly: true } } },
        },
      },
    );
    expect(out).toEqual({ "env-prod": { name: "prod" } });
  });

  it("strips writeOnly inside array items", () => {
    const out = redactWriteOnly(
      { items: [{ token: "a", keep: 1 }, { token: "b", keep: 2 }] },
      { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { token: { writeOnly: true } } } } } },
    );
    expect(out).toEqual({ items: [{ keep: 1 }, { keep: 2 }] });
  });

  it("preserves non-writeOnly values and returns the same reference when nothing is stripped", () => {
    const config = { enabled: true, browsers: { Default: { zeroDialog: false } } };
    expect(redactWriteOnly(config, browserSchema)).toBe(config);
  });

  it("passes through when the schema is absent or describes nothing", () => {
    const config = { token: "x", browsers: { Default: { token: "y" } } };
    expect(redactWriteOnly(config, undefined)).toBe(config);
    // schema without properties/patternProperties/additionalProperties shape
    expect(redactWriteOnly(config, { type: "object" })).toBe(config);
    // boolean additionalProperties means "allowed but undescribed" — no
    // writeOnly knowledge, nothing to strip.
    expect(redactWriteOnly(config, { type: "object", additionalProperties: true })).toBe(config);
  });

  it("never mutates the input config", () => {
    const config = { browsers: { Default: { token: "tok", zeroDialog: true } } };
    const snapshot = JSON.stringify(config);
    redactWriteOnly(config, browserSchema);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

// ── redactPluginConfigForClient — FAILS CLOSED ───────────────────────────────
describe("redactPluginConfigForClient (fail-closed wrapper)", () => {
  function fixtureRoot(
    name: string,
    manifest: Record<string, unknown>,
    schema?: string,
  ): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-redact-"));
    const pkgDir = path.join(root, "packages", name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name, "pi-dashboard-plugin": manifest }),
    );
    if (schema !== undefined) fs.writeFileSync(path.join(pkgDir, "schema.json"), schema);
    clearDiscoveryCache();
    return root;
  }

  it("strips a writeOnly token when the schema loads", () => {
    const root = fixtureRoot(
      "fixture-ok",
      { id: "fixture-ok", displayName: "OK", claims: [], configSchema: "./schema.json" },
      JSON.stringify(browserSchema),
    );
    try {
      const out = redactPluginConfigForClient(
        "fixture-ok",
        { browsers: { Default: { token: "secret", zeroDialog: true } } },
        root,
      ) as { browsers: Record<string, Record<string, unknown>> };
      expect(out.browsers.Default.token).toBeUndefined();
      expect(out.browsers.Default.zeroDialog).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      clearDiscoveryCache();
    }
  });

  it("FAILS CLOSED when a declared schema cannot be loaded", () => {
    // configSchema declared, but the file does not exist — we cannot know which
    // fields are writeOnly, so the raw config (with its token) must NOT escape.
    const root = fixtureRoot("fixture-broken", {
      id: "fixture-broken",
      displayName: "Broken",
      claims: [],
      configSchema: "./schema.json",
    });
    try {
      const out = redactPluginConfigForClient("fixture-broken", { browsers: { Default: { token: "secret" } } }, root);
      expect(out).toEqual({});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      clearDiscoveryCache();
    }
  });

  it("FAILS CLOSED for a malformed schema", () => {
    const root = fixtureRoot(
      "fixture-badjson",
      { id: "fixture-badjson", displayName: "Bad", claims: [], configSchema: "./schema.json" },
      "{not json",
    );
    try {
      expect(redactPluginConfigForClient("fixture-badjson", { token: "secret" }, root)).toEqual({});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      clearDiscoveryCache();
    }
  });

  it("FAILS CLOSED for an unresolvable plugin id", () => {
    const root = fixtureRoot("fixture-known", { id: "fixture-known", displayName: "K", claims: [] });
    try {
      expect(redactPluginConfigForClient("not-installed", { token: "secret" }, root)).toEqual({});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      clearDiscoveryCache();
    }
  });

  it("passes through when a resolved plugin declares NO schema", () => {
    const root = fixtureRoot("fixture-noschema", {
      id: "fixture-noschema",
      displayName: "No schema",
      claims: [],
    });
    try {
      const cfg = { anything: 1 };
      expect(redactPluginConfigForClient("fixture-noschema", cfg, root)).toBe(cfg);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      clearDiscoveryCache();
    }
  });
});
