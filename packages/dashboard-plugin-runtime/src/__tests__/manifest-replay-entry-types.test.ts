/**
 * Manifest `replayEntryTypes`: a plugin declares the persisted custom-entry
 * types it owns. Enabled plugins replay them; every declaring plugin hides
 * them; a malformed value contributes nothing and never throws.
 * See change: update-flows-plugin (D3, G5, G6; test-plan E9).
 */
import fs from "node:fs";
import path from "node:path";
import { computeReplayEntryTypes } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/replay-entry-types.js";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../manifest-validator.js";

const base = { id: "x", displayName: "X", claims: [] };

function setFor(manifest: unknown, enabled: boolean) {
  const m = validateManifest(manifest);
  return computeReplayEntryTypes([{ replayEntryTypes: m.replayEntryTypes, enabled }]);
}

describe("manifest replayEntryTypes (E9)", () => {
  it("the real flows manifest declares flow-event", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../../../flows-plugin/package.json"), "utf8"),
    );
    const m = validateManifest(pkg["pi-dashboard-plugin"]);
    expect(m.replayEntryTypes).toEqual(["flow-event"]);
  });

  it("an enabled plugin contributes its types to the replay set", () => {
    const sets = setFor({ ...base, id: "flows", replayEntryTypes: ["flow-event"] }, true);
    expect(sets.replay).toContain("flow-event");
    expect(sets.hidden).toContain("flow-event");
  });

  it("a disabled plugin contributes nothing to replay, but its types stay hidden", () => {
    const sets = setFor({ ...base, id: "flows", replayEntryTypes: ["flow-event"] }, false);
    expect(sets.replay).not.toContain("flow-event");
    expect(sets.hidden).toContain("flow-event");
  });

  it.each([
    ["a string value", "flow-event"],
    ["an array with a non-string", [1, "ok-type"]],
    ["an object", { a: 1 }],
    ["an entry with whitespace", ["a b"]],
  ])("%s contributes nothing and does not throw (G6)", (_label, value) => {
    expect(() => validateManifest({ ...base, replayEntryTypes: value })).not.toThrow();
    const sets = setFor({ ...base, replayEntryTypes: value }, true);
    expect(sets).toEqual({ replay: [], hidden: [] });
  });

  it("absent field leaves the manifest without replayEntryTypes", () => {
    expect(validateManifest(base).replayEntryTypes).toBeUndefined();
  });
});
