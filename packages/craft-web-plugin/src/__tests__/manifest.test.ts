/**
 * E1 — claims per verified app: the package.json claims, the server app table and the `craft-apps` registry
 * cannot drift. Plus E24 (bundling) and the manifest/config-schema contract.
 * See change: edit-office-in-pane-with-craft-web (D1, tasks 3.1–3.3, 9.1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getApp } from "@blackbelt-technology/pi-dashboard-craft-apps/registry.js";
import { OFFICE_SIZE_CAPS } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";
import * as clientBarrel from "../client/index.js";
import { CLAIMED_APPS, CRAFT_WEB_APPS } from "../server/apps.js";

const root = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown> & {
  files: string[];
  "pi-dashboard-plugin": Record<string, unknown>;
};
const manifest = pkg["pi-dashboard-plugin"];
const serverPkg = JSON.parse(readFileSync(path.resolve(root, "..", "server", "package.json"), "utf8")) as { piDashboard: { bundledPlugins: string[] } };

const CAP_BY_EXT: Record<string, number> = { ".docx": OFFICE_SIZE_CAPS.docx, ".xlsx": OFFICE_SIZE_CAPS.sheet, ".pptx": OFFICE_SIZE_CAPS.pptx };

describe("craft-web manifest (E1)", () => {
  const validated = validateManifest(manifest, "craft-web");
  const claims = validated.claims.filter((c) => c.slot === "editor-pane-file-handler");

  it("validates against the loader's validator, is `craft-web`, and is disabled by default", () => {
    expect(validated.id).toBe("craft-web");
    expect(validated.defaultEnabled).toBe(false);
    expect(validated.server).toBeTruthy();
    expect(validated.client).toBeTruthy();
    expect(validated.configSchema).toBe("./configSchema.json");
  });

  it("every claim's component is a function export of the client barrel (the registry imports by name)", () => {
    for (const c of claims) {
      const name = String(c.component);
      expect(typeof (clientBarrel as Record<string, unknown>)[name], `export ${name}`).toBe("function");
    }
  });

  it("claims exactly the apps of the server table", () => {
    expect(claims.map((c) => c.id).sort()).toEqual([...CLAIMED_APPS].sort());
  });

  it("every claim's app has a verified registry webVersion", () => {
    for (const c of claims) expect(getApp(c.id as string).webVersion, `${c.id} has no webVersion`).toBeTruthy();
  });

  it("claim fields equal the registry / OFFICE_SIZE_CAPS values", () => {
    for (const c of claims) {
      const app = getApp(c.id as string);
      expect(c.mode).toBe("edit");
      expect(c.copySuffix).toBe(app.id);
      expect(c.firstOverwriteNotice).toBe(app.webFidelityNote);
      expect((c.firstOverwriteNotice as string).length).toBeLessThanOrEqual(300);
      expect(c.keepAlive).toEqual({ max: 3 });
      expect(c.validator).toBe(true);
      expect(c.label).toBe(`Edit in ${app.name}`);
      expect(c.extensions).toEqual([CRAFT_WEB_APPS[c.id as string].extension]);
      expect(c.maxBytes).toBe(CAP_BY_EXT[c.extensions?.[0] as string]);
    }
  });

  it("ships src/ (the shim and the validator live there) and no tests", () => {
    expect(pkg.files).toContain("src/");
    expect(pkg.files).toContain("!**/__tests__");
  });

  it("configSchema declares apps.<app>.enabled defaulting to true", () => {
    const schema = JSON.parse(readFileSync(path.join(root, "configSchema.json"), "utf8")) as {
      properties: { apps: { properties: Record<string, { $ref: string }> } };
      definitions: { app: { properties: { enabled: { type: string; default: boolean } } } };
    };
    for (const app of ["wordcraft", "gridcraft", "deckcraft"]) expect(schema.properties.apps.properties[app].$ref).toBe("#/definitions/app");
    expect(schema.definitions.app.properties.enabled).toMatchObject({ type: "boolean", default: true });
  });
});

describe("craft-web bundling (E24)", () => {
  it("is a bundled plugin (trusted for serveApp) and depends on craft-apps", () => {
    expect(serverPkg.piDashboard.bundledPlugins).toContain("craft-web-plugin");
    expect((pkg.dependencies as Record<string, string>)["@blackbelt-technology/pi-dashboard-craft-apps"]).toBeTruthy();
  });

  it("repository.directory is packages/craft-web-plugin (runtime-overlay stager maps by it)", () => {
    expect((pkg.repository as { directory: string }).directory).toBe("packages/craft-web-plugin");
  });
});
