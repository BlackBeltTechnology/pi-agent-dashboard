/**
 * Server-side retention — the half of D12 the spec actually requires.
 *
 * A remote session's transcript lives on another machine, and that machine
 * leaves. Retention is what makes the transcript outlive the session (11.10),
 * and what lets a read escape `memory-event-store`'s deliberate lossiness —
 * the 4 KB `DEFAULT_MAX_STRING_SIZE` cap, eviction, per-session trimming (11.9).
 * Locally that escape hatch is `findSessionToolCallPayload` reading the
 * `.jsonl`; for a remote session this store IS the `.jsonl`.
 *
 * Two properties carry the weight:
 *
 *   - **`sessionId` arrives over the wire** from a possibly-remote bridge, so
 *     it is untrusted input being used to build a filename. A store that
 *     interpolates it into a path is a write-anywhere primitive.
 *   - **A restart must not append.** The backfill cursor restarts when the
 *     origin's prefix was rewritten or truncated; appending that second read
 *     would duplicate every entry and silently corrupt the retained copy.
 *
 * Tasks 11.6, 11.9, 11.10; test-plan #X18.
 * See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRemoteTranscriptStore } from "../remote-transcript-store.js";

let home: string;
const store = () => createRemoteTranscriptStore({ homedir: home });

const line = (i: number) => JSON.stringify({ i });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rts-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("createRemoteTranscriptStore", () => {
  it("retains appended chunks and reads them back in order", () => {
    const s = store();
    s.append("sess-1", [line(0), line(1)], { restarted: false, complete: false });
    s.append("sess-1", [line(2)], { restarted: false, complete: true });
    expect(s.read("sess-1").entries.map((e) => JSON.parse(e).i)).toEqual([0, 1, 2]);
  });

  it("serves the transcript after the session has ended (task 11.10)", () => {
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: true });
    // A fresh store instance — no in-memory state, exactly like a server that
    // restarted after the remote host went away.
    expect(store().read("sess-1").entries).toHaveLength(1);
  });

  it("replaces rather than appends when the reader restarted", () => {
    const s = store();
    s.append("sess-1", [line(0), line(1)], { restarted: false, complete: false });
    // The origin's prefix changed under the cursor; the bridge re-read from 0.
    s.append("sess-1", [line(9), line(8)], { restarted: true, complete: true });
    expect(s.read("sess-1").entries.map((e) => JSON.parse(e).i)).toEqual([9, 8]);
  });

  it("reports a transcript as incomplete until a chunk says complete (#X18)", () => {
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: false });
    expect(s.read("sess-1").complete).toBe(false);
    s.append("sess-1", [line(1)], { restarted: false, complete: true });
    expect(s.read("sess-1").complete).toBe(true);
  });

  it("keeps a bridge that died mid-transfer detectable, not silently partial", () => {
    const s = store();
    s.append("sess-1", [line(0), line(1)], { restarted: false, complete: false });
    const got = store().read("sess-1");
    expect(got.entries).toHaveLength(2);
    // Present, readable, and explicitly NOT the whole record.
    expect(got.complete).toBe(false);
  });

  it("returns an empty, incomplete result for a session it has never seen", () => {
    expect(store().read("never-heard-of-it")).toEqual({ entries: [], complete: false });
  });

  it.each([
    "../../../../etc/passwd",
    "..\\..\\windows\\system32",
    "a/b",
    "with space",
    "sess;rm -rf /",
    "",
  ])("refuses %j as a session id rather than building a path from it", (bad) => {
    const s = store();
    expect(() => s.append(bad, [line(0)], { restarted: false, complete: true })).toThrow();
    // And nothing escaped the store directory.
    const stray = fs.existsSync(path.join(home, ".pi")) ? fs.readdirSync(path.join(home, ".pi")) : [];
    expect(stray).not.toContain("passwd");
  });

  it("accepts the uuid shape real session ids actually have", () => {
    const s = store();
    const id = "01a021b6-f7bf-71ab-ae67-f4e88b0c00fd";
    expect(() => s.append(id, [line(0)], { restarted: false, complete: true })).not.toThrow();
    expect(s.read(id).entries).toHaveLength(1);
  });

  it("stores full-fidelity entries, past the in-memory 4 KB cap (task 11.9)", () => {
    const s = store();
    const big = JSON.stringify({ i: 0, blob: "z".repeat(50_000) });
    s.append("sess-1", [big], { restarted: false, complete: true });
    const back = s.read("sess-1").entries[0];
    // Byte-identical: the whole point is that nothing here truncates.
    expect(back).toBe(big);
    expect(JSON.parse(back).blob).toHaveLength(50_000);
  });

  it("writes under 0700/0600 like every other credential-adjacent path", () => {
    if (process.platform === "win32") return; // chmod is a documented no-op
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: true });
    const dir = path.join(home, ".pi", "dashboard", "remote-transcripts");
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, "sess-1.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("drops a retained transcript on request", () => {
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: true });
    s.forget("sess-1");
    expect(s.read("sess-1").entries).toEqual([]);
    // Idempotent: forgetting twice is not an error.
    expect(() => s.forget("sess-1")).not.toThrow();
  });
});
