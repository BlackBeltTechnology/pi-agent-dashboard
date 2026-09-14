/**
 * Manifest validation for the browser-plugin `pi-dashboard-plugin` block.
 * Scenario E31 (test-plan add-browser-relay): id `browser`, both claims
 * resolve to exported components from the client entry, `token` is
 * `writeOnly` in configSchema.json.
 *
 * See change: add-browser-relay (task 2.1).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";
// Client entry import proves the claimed components actually resolve.
import * as clientEntry from "../client/index.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");
const schemaPath = path.resolve(here, "..", "..", "configSchema.json");

describe("browser-plugin manifest (E31)", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "browser")).not.toThrow();
  });

  it("plugin id is `browser` with client + server entries and a config schema", () => {
    const v = validateManifest(manifest, "browser");
    expect(v.id).toBe("browser");
    expect(v.server).toBeTruthy();
    expect(v.client).toBeTruthy();
    expect(v.configSchema).toBe("./configSchema.json");
  });

  it("is disabled by default (design Migration Plan step 2)", () => {
    const v = validateManifest(manifest, "browser");
    expect(v.defaultEnabled).toBe(false);
  });

  it("declares settings-section + session-card-badge + content-view claims that resolve to exported components", () => {
    const v = validateManifest(manifest, "browser");
    expect(v.claims.map((c) => c.slot).sort()).toEqual([
      "content-view",
      "session-card-badge",
      "settings-section",
    ]);

    for (const claim of v.claims) {
      const component = (clientEntry as Record<string, unknown>)[claim.component as string];
      // Slot registry imports the claimed name from the client entry — it
      // must be present and be a component (function), not undefined.
      expect(typeof component, `claim ${claim.slot} → ${claim.component}`).toBe("function");
    }
  });

  it("marks the per-profile token writeOnly in configSchema.json (F2)", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as {
      properties?: Record<string, { type?: string } & Record<string, unknown>>;
    };
    const browsers = schema.properties?.browsers as unknown as {
      additionalProperties?: { properties?: Record<string, { type?: string; writeOnly?: boolean }> };
    };
    const token = browsers?.additionalProperties?.properties?.token;
    expect(token?.type).toBe("string");
    expect(token?.writeOnly).toBe(true);
  });

  it("carries allowMultipleInstancesPerProfile (user decision under task 2.2b)", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as {
      properties?: Record<string, unknown>;
    };
    const flag = schema.properties?.allowMultipleInstancesPerProfile as { type?: string };
    expect(flag?.type).toBe("boolean");
  });
});
