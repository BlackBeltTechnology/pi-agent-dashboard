/**
 * The manifest `configSchema` gates the host config route
 * (`POST /api/config/plugins/mcp-client` -> validatePluginConfig).
 * This test pins the contract that route relies on: out-of-range / wrong-type
 * `adapterLoadTimeoutMs` is rejected, the in-range values pass, and the schema
 * default is applied on read.
 * See change: extract-mcp-client-plugin.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { validatePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..", "..");
const schema = JSON.parse(
  readFileSync(path.join(pkgRoot, "configSchema.json"), "utf-8"),
) as Record<string, unknown>;

function attempt(config: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...config };
  validatePluginConfig("mcp-client", copy, schema);
  return copy;
}

describe("mcp-client manifest configSchema", () => {
  it("rejects a below-minimum timeout", () => {
    expect(() => attempt({ adapterLoadTimeoutMs: 500 })).toThrow();
  });

  it("rejects an above-maximum timeout", () => {
    expect(() => attempt({ adapterLoadTimeoutMs: 200000 })).toThrow();
  });

  it("rejects a non-integer timeout", () => {
    expect(() => attempt({ adapterLoadTimeoutMs: "10s" })).toThrow();
  });

  it("accepts the boundaries", () => {
    expect(attempt({ adapterLoadTimeoutMs: 1000 }).adapterLoadTimeoutMs).toBe(1000);
    expect(attempt({ adapterLoadTimeoutMs: 120000 }).adapterLoadTimeoutMs).toBe(120000);
  });

  it("applies the 10000 default on read", () => {
    expect(attempt({}).adapterLoadTimeoutMs).toBe(10000);
  });

  it("rejects unknown keys", () => {
    expect(() => attempt({ bogus: true })).toThrow();
  });
});
