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

// See change: add-automation-folder-scope-contribution.
describe("contributed folder-scope bases (reconcile degrade)", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "auto-contrib-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("I1: attaches a watcher to <contributedBase>/.pi/automation with no live session", () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, ".pi", "automation", "intake"), { recursive: true });
    const watcher = createAutomationWatcher({ onChange: () => {}, logger: () => {} });
    reconcileWatchers(watcher, [repo]);
    expect(watcher.attachedBases()).toEqual([repo]);
    watcher.detachAll();
  });

  it("X1: an unwatchable contributed base degrades — attach returns false, sibling still attaches, no throw", () => {
    // `fs.watch` sync-throw behaviour is platform-dependent (Linux defers to the
    // async error event), so assert the reconcile-level degrade contract with a
    // fake watcher whose attach fails for the bad base (EACCES/ENOENT/etc.):
    // the sibling still attaches and reconcile never throws. The real watcher's
    // warn-once (failedOnce) path is covered by the fs-integration attach test.
    const good = tmp();
    const bad = tmp();
    const attached = new Set<string>();
    let badAttachCalls = 0;
    const fake = {
      attach: (b: string) => {
        if (b === bad) {
          badAttachCalls++;
          return false; // simulate fs.watch throw → degrade
        }
        if (attached.has(b)) return false;
        attached.add(b);
        return true;
      },
      detach: (b: string) => {
        attached.delete(b);
      },
      attachedBases: () => [...attached],
    };
    expect(() => reconcileWatchers(fake, [good, bad])).not.toThrow();
    expect(fake.attachedBases()).toEqual([good]);
    expect(badAttachCalls).toBe(1);
    // Steady-state re-reconcile: good is not re-attached, bad is retried (non-fatal).
    reconcileWatchers(fake, [good, bad]);
    expect(fake.attachedBases()).toEqual([good]);
  });
});
