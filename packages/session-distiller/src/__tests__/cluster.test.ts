import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeIntoStore, promote, loadStore, type CandidateStore } from "../cluster.js";
import type { FaultCandidate } from "../types.js";

function fault(sessionId: string, sig = "fault:bash:enoent"): FaultCandidate {
  return {
    signal: "fault",
    sessionId,
    signature: sig,
    verified: true,
    wrongCall: { id: "a", name: "bash", arguments: {} },
    error: "ENOENT",
    fixCall: { id: "b", name: "bash", arguments: {} },
  };
}

describe("clustering + recurrence gate (tasks 4.1, 4.2)", () => {
  it("clusters the same fault signature across sessions", () => {
    let store: CandidateStore = {};
    store = mergeIntoStore(store, [fault("s1")]);
    store = mergeIntoStore(store, [fault("s2")]);
    expect(store["fault:bash:enoent"].sessionIds).toEqual(["s1", "s2"]);
  });

  it("does not double-count the same session", () => {
    let store: CandidateStore = {};
    store = mergeIntoStore(store, [fault("s1"), fault("s1")]);
    expect(store["fault:bash:enoent"].sessionIds).toEqual(["s1"]);
  });

  it("promotes a cluster seen in >= N sessions and holds the rest", () => {
    let store: CandidateStore = {};
    store = mergeIntoStore(store, [fault("s1"), fault("s2", "fault:read:notfound")]);
    store = mergeIntoStore(store, [fault("s2"), fault("s3")]);
    const { promoted, remaining } = promote(store, 3);
    expect(promoted.map((p) => p.signature)).toEqual(["fault:bash:enoent"]);
    expect(Object.keys(remaining)).toEqual(["fault:read:notfound"]);
  });

  it("throws on a corrupt candidates store instead of silently resetting", () => {
    const dir = mkdtempSync(join(tmpdir(), "distill-store-"));
    const p = join(dir, "candidates.json");
    writeFileSync(p, "{ not valid json");
    expect(() => loadStore(p)).toThrow(/corrupt/i);
  });

  it("auto-promotes once a later run pushes the count to N", () => {
    let store: CandidateStore = {};
    store = mergeIntoStore(store, [fault("s1")]);
    store = mergeIntoStore(store, [fault("s2")]);
    expect(promote(store, 3).promoted.length).toBe(0); // held at 2
    store = mergeIntoStore(store, [fault("s3")]);
    expect(promote(store, 3).promoted.length).toBe(1); // promoted at 3
  });
});
