/**
 * Discoverability test — keycloak-resolver-plugin manifest.
 *
 * Guards the exact regression that made the identity-plane E2E boot inert: a
 * server-only resolver plugin still MUST declare `claims: []` (the manifest
 * schema requires an array), else `discoverPlugins()` drops it, the resolver
 * never registers, and every owner-gate falls through to allow-all.
 *
 * See openspec change: add-multi-user-identity-plane (§11.2).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@blackbelt-technology/dashboard-plugin-runtime/manifest-validator";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = resolve(__dirname, "../../package.json");

describe("keycloak-resolver-plugin manifest discoverability", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as {
    name: string;
    "pi-dashboard-plugin"?: unknown;
  };
  const manifest = pkg["pi-dashboard-plugin"];

  it("declares a `pi-dashboard-plugin` manifest", () => {
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe("object");
  });

  it("validates against the dashboard manifest schema (requires a claims array)", () => {
    expect(() => validateManifest(manifest, pkg.name)).not.toThrow();
  });

  it("declares id `keycloak-resolver` with a server entry and an (empty) claims array", () => {
    const v = validateManifest(manifest, pkg.name) as { id: string; server?: string; claims: unknown[] };
    expect(v.id).toBe("keycloak-resolver");
    expect(typeof v.server).toBe("string");
    expect(Array.isArray(v.claims)).toBe(true);
  });
});
