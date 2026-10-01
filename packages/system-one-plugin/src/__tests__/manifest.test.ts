// @vitest-environment node
/**
 * Manifest shape: validates against the loader; settings-section claim;
 * client entry exports every claimed component + the i18n catalog.
 * See change: add-system-one-registry.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(here, "..", "..", "package.json"), "utf-8")) as Record<string, unknown>;
const manifest = pkg["pi-dashboard-plugin"];

describe("system-one-plugin manifest", () => {
  it("validates as id `system-one` with client + server entries and a settings-section claim", () => {
    const v = validateManifest(manifest, "system-one");
    expect(v.id).toBe("system-one");
    expect(v.client).toBeTruthy();
    expect(v.server).toBeTruthy();
    const claim = v.claims.find((c) => c.slot === "settings-section") as { component: string; tab?: string };
    expect(claim).toMatchObject({ component: "SystemOneSettings", tab: "general" });
  });

  it("client barrel exports the claimed component and the catalog", async () => {
    const mod = await import("../client/index.js");
    expect(typeof mod.SystemOneSettings).toBe("function");
    expect(Object.keys(mod.catalog).sort()).toEqual(["hu", "zh-CN"]);
  });
});
