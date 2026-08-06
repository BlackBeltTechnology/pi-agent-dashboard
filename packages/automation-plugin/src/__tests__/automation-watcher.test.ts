/**
 * Automation watcher tests: filename filter + debounced re-arm on edit.
 * See change: add-automation-plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAutomationWatcher,
  matchesAutomationArtifact,
  reconcileWatchers,
} from "../server/automation-watcher.js";

describe("matchesAutomationArtifact", () => {
  it("matches automation.yaml + prompt.md under an automation dir", () => {
    expect(matchesAutomationArtifact("nightly/automation.yaml")).toBe(true);
    expect(matchesAutomationArtifact("nightly/prompt.md")).toBe(true);
    // windows separators
    expect(matchesAutomationArtifact("nightly\\automation.yaml")).toBe(true);
  });
  it("ignores unrelated files (run store, nested, README)", () => {
    expect(matchesAutomationArtifact("runs/2026-06-19-x/result.md")).toBe(false);
    expect(matchesAutomationArtifact("nightly/notes.txt")).toBe(false);
    expect(matchesAutomationArtifact("README.md")).toBe(false);
    expect(matchesAutomationArtifact(null)).toBe(false);
  });
});

describe("createAutomationWatcher (fs integration)", () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "auto-watch-"));
    fs.mkdirSync(path.join(base, ".pi", "automation", "nightly"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("debounces rapid edits into a single onChange and re-arms", async () => {
    let calls = 0;
    const watcher = createAutomationWatcher({
      onChange: () => { calls++; },
      debounceMs: 80,
    });
    expect(watcher.attach(base)).toBe(true);

    const yamlPath = path.join(base, ".pi", "automation", "nightly", "automation.yaml");
    // Burst of writes within the debounce window.
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(yamlPath, `# edit ${i}\non: { kind: schedule, cron: "* * * * *" }\n`);
      await new Promise((r) => setTimeout(r, 10));
    }
    // Wait past the debounce.
    await new Promise((r) => setTimeout(r, 250));

    // fs.watch can coalesce; assert at least one and not one-per-write storm.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
    watcher.detachAll();
    expect(watcher.size()).toBe(0);
  });

  it("attachedBases reflects the attached set", () => {
    const watcher = createAutomationWatcher({ onChange: () => {}, logger: () => {} });
    expect(watcher.attachedBases()).toEqual([]);
    expect(watcher.attach(base)).toBe(true);
    expect(watcher.attachedBases()).toEqual([base]);
    watcher.detach(base);
    expect(watcher.attachedBases()).toEqual([]);
  });

  it("attach returns false for a missing automation dir (degrade)", () => {
    const watcher = createAutomationWatcher({ onChange: () => {}, logger: () => {} });
    const missing = path.join(base, "does-not-exist");
    expect(watcher.attach(missing)).toBe(false);
  });
});

describe("reconcileWatchers (incremental attach — leak fix)", () => {
  /** Fake watcher recording attach/detach calls without touching the fs. */
  function fakeWatcher() {
    const attached = new Set<string>();
    const calls = { attach: [] as string[], detach: [] as string[] };
    return {
      attach: (b: string) => {
        calls.attach.push(b);
        if (attached.has(b)) return false;
        attached.add(b);
        return true;
      },
      detach: (b: string) => {
        calls.detach.push(b);
        attached.delete(b);
      },
      attachedBases: () => [...attached],
      calls,
    };
  }

  it("attaches new bases and detaches removed ones", () => {
    const w = fakeWatcher();
    reconcileWatchers(w, ["/a", "/b"]);
    expect(w.attachedBases().sort()).toEqual(["/a", "/b"]);
    reconcileWatchers(w, ["/b", "/c"]);
    expect(w.attachedBases().sort()).toEqual(["/b", "/c"]);
    expect(w.calls.detach).toContain("/a");
  });

  it("is a no-op in steady state — no detach churn (the leak fix)", () => {
    const w = fakeWatcher();
    reconcileWatchers(w, ["/a", "/b"]);
    const detachesAfterInitial = w.calls.detach.length;
    // Repeated reconciles with the same set must not tear watchers down.
    reconcileWatchers(w, ["/a", "/b"]);
    reconcileWatchers(w, ["/a", "/b"]);
    expect(w.calls.detach.length).toBe(detachesAfterInitial);
    expect(w.attachedBases().sort()).toEqual(["/a", "/b"]);
  });
});
