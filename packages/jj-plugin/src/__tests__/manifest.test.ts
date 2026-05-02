/**
 * Manifest validation: the `pi-dashboard-plugin` block in package.json
 * must pass the dashboard-plugin-runtime validator. Catches typos in
 * slot ids, missing component names, malformed claim shapes.
 *
 * See change: add-jj-workspace-plugin.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
// The validator isn't re-exported from the runtime barrel; import the
// module file directly via a relative path to keep this test self-contained.
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");

describe("jj-plugin manifest", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "jj")).not.toThrow();
  });

  it("plugin id is `jj`", () => {
    const v = validateManifest(manifest, "jj");
    expect(v.id).toBe("jj");
  });

  it("declares the six expected claims (action-bar appears twice with different predicates)", () => {
    const v = validateManifest(manifest, "jj");
    const slots = v.claims.map((c) => c.slot).sort();
    expect(slots).toEqual([
      "command-route",
      "session-card-action-bar",
      "session-card-action-bar",
      "session-card-badge",
      "settings-section",
      "sidebar-folder-section",
    ]);
  });

  it("action-bar slot has both isInJjRepo and isInGitRepoButNotJj predicates", () => {
    const v = validateManifest(manifest, "jj");
    const actionBars = v.claims.filter((c) => c.slot === "session-card-action-bar");
    const predicates = actionBars.map((c) => c.predicate).sort();
    expect(predicates).toEqual(["isInGitRepoButNotJj", "isInJjRepo"]);
  });

  it("session-card-badge claim uses the isInJjWorkspace predicate", () => {
    const v = validateManifest(manifest, "jj");
    const badge = v.claims.find((c) => c.slot === "session-card-badge");
    expect(badge?.predicate).toBe("isInJjWorkspace");
  });



  it("/jj is the command-route", () => {
    const v = validateManifest(manifest, "jj");
    const route = v.claims.find((c) => c.slot === "command-route");
    expect(route?.command).toBe("/jj");
  });

  it("references a configSchema file that exists", () => {
    const v = validateManifest(manifest, "jj");
    expect(v.configSchema).toBe("./src/configSchema.json");
    const schemaPath = path.resolve(here, "..", "..", v.configSchema!);
    expect(() => readFileSync(schemaPath, "utf-8")).not.toThrow();
  });
});
