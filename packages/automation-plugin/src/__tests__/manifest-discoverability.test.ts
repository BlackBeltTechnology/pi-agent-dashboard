/**
 * Discoverability test — automation-plugin manifest.
 *
 * Verifies the `pi-dashboard-plugin` manifest (read from package.json)
 * validates against the dashboard's manifest schema and encodes the
 * contract this plugin promises to the shell.
 *
 * See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@blackbelt-technology/dashboard-plugin-runtime/manifest-validator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_JSON = resolve(__dirname, "../../package.json");

describe("automation-plugin manifest discoverability", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as {
    name: string;
    "pi-dashboard-plugin"?: unknown;
  };
  const manifest = pkg["pi-dashboard-plugin"];

  it("declares a `pi-dashboard-plugin` manifest field", () => {
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe("object");
  });

  it("validates against the dashboard's manifest schema", () => {
    expect(() => validateManifest(manifest, pkg.name)).not.toThrow();
  });

  it("declares plugin id `automation`", () => {
    const validated = validateManifest(manifest, pkg.name);
    expect(validated.id).toBe("automation");
  });

  it("declares client, server, and bridge entrypoints", () => {
    const validated = validateManifest(manifest, pkg.name) as {
      client?: string;
      server?: string;
      bridge?: string;
    };
    expect(validated.client).toBe("./src/client/index.tsx");
    expect(validated.server).toBe("./src/server/index.ts");
    expect(validated.bridge).toBe("./src/bridge/index.ts");
  });

  it("references a configSchema file that exists", () => {
    const validated = validateManifest(manifest, pkg.name) as { configSchema?: string };
    expect(validated.configSchema).toBe("./src/configSchema.json");
    const schemaPath = resolve(__dirname, "../..", validated.configSchema!);
    expect(() => readFileSync(schemaPath, "utf-8")).not.toThrow();
  });
});
