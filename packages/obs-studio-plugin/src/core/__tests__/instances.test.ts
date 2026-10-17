/**
 * `readInstances` prunes stale ids best-effort: a read-only state dir must not fail the read.
 * See change: add-obs-studio-plugin (review round 1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addInstance, instancesFile, readInstances } from "../instances.js";

describe("readInstances", () => {
  it("prunes ids without a definition and persists the pruned list", () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "obs-inst-"));
    addInstance(state, "obs");
    addInstance(state, "gone");
    expect(readInstances(state, (id) => id === "obs")).toEqual(["obs"]);
    expect(JSON.parse(fs.readFileSync(instancesFile(state), "utf8")).instances).toEqual(["obs"]);
  });

  it("a failing prune write still returns the filtered list", () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "obs-inst-"));
    addInstance(state, "obs");
    addInstance(state, "gone");
    fs.chmodSync(state, 0o500);
    try {
      expect(readInstances(state, (id) => id === "obs")).toEqual(["obs"]);
    } finally {
      fs.chmodSync(state, 0o700);
    }
  });
});
