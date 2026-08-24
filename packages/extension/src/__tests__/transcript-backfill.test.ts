/**
 * The lazy half of D12: pre-attach history is backfilled in the BACKGROUND,
 * so a 44 MB transcript never sits between a user and a usable session.
 *
 * The cursor deliberately does not trust a byte offset alone. Task 11.2 could
 * only show that no rewrite has been *observed* in pi 0.84.1's `.jsonl` files;
 * it could not show the prefix is byte-stable, and the format belongs to pi.
 * So the cursor carries a witness for the last consumed line, and a mismatch
 * restarts the read rather than resuming into misaligned bytes — the same
 * machinery #X18 needs, since a truncated transfer and a rewritten prefix are
 * indistinguishable from an offset alone.
 *
 * Tasks 11.5, 11.13; test-plan #P1, #X18.
 * See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type makeCursor, readTranscriptChunk } from "../transcript-backfill.js";

let dir: string;
let file: string;

const line = (i: number) => JSON.stringify({ i, timestamp: new Date(i * 1000).toISOString() });
const writeLines = (n: number) => {
  fs.writeFileSync(file, `${Array.from({ length: n }, (_, i) => line(i)).join("\n")}\n`);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-backfill-"));
  file = path.join(dir, "session.jsonl");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("readTranscriptChunk", () => {
  it("returns a bounded chunk and a cursor, not the whole file", () => {
    writeLines(1000);
    const chunk = readTranscriptChunk(file, undefined, { maxBytes: 200 });
    expect(chunk.entries.length).toBeGreaterThan(0);
    expect(chunk.entries.length).toBeLessThan(1000);
    expect(chunk.complete).toBe(false);
    expect(chunk.cursor).toBeDefined();
  });

  it("resumes from the cursor without repeating or skipping a line", () => {
    writeLines(500);
    const seen: number[] = [];
    let cursor = undefined as ReturnType<typeof makeCursor> | undefined;
    for (let i = 0; i < 200; i++) {
      const chunk = readTranscriptChunk(file, cursor, { maxBytes: 300 });
      for (const e of chunk.entries) seen.push(JSON.parse(e).i);
      cursor = chunk.cursor;
      if (chunk.complete) break;
    }
    expect(seen).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  it("picks up lines appended between two reads (append-only, D12)", () => {
    writeLines(10);
    const first = readTranscriptChunk(file, undefined, { maxBytes: 1 << 20 });
    expect(first.complete).toBe(true);
    fs.appendFileSync(file, `${line(10)}\n`);
    const second = readTranscriptChunk(file, first.cursor, { maxBytes: 1 << 20 });
    expect(second.entries.map((e) => JSON.parse(e).i)).toEqual([10]);
  });

  it("restarts from the beginning when the prefix was rewritten under it", () => {
    // The case task 11.2 could not rule out. Detected, not assumed away.
    writeLines(50);
    const first = readTranscriptChunk(file, undefined, { maxBytes: 300 });
    expect(first.complete).toBe(false);
    // Rewrite the prefix with DIFFERENT content of the same total length, so a
    // bare byte offset would resume happily into misaligned data.
    const rewritten = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ i: i + 1000, timestamp: new Date(i * 1000).toISOString() }),
    ).join("\n");
    fs.writeFileSync(file, `${rewritten}\n`);
    const second = readTranscriptChunk(file, first.cursor, { maxBytes: 1 << 20 });
    expect(second.restarted).toBe(true);
    expect(JSON.parse(second.entries[0]).i).toBe(1000);
  });

  it("restarts when the file shrank below the cursor (truncation)", () => {
    writeLines(500);
    const first = readTranscriptChunk(file, undefined, { maxBytes: 4000 });
    writeLines(3);
    const second = readTranscriptChunk(file, first.cursor, { maxBytes: 1 << 20 });
    expect(second.restarted).toBe(true);
    expect(second.entries).toHaveLength(3);
  });

  it("never reports complete while a partial trailing line is on disk (#X18)", () => {
    // A transfer interrupted mid-write leaves a line with no terminator.
    // Presenting it as a complete entry is how partial data gets mistaken for
    // the whole record.
    fs.writeFileSync(file, `${line(0)}\n${line(1)}\n{"i":2,"unterm`);
    const chunk = readTranscriptChunk(file, undefined, { maxBytes: 1 << 20 });
    expect(chunk.entries.map((e) => JSON.parse(e).i)).toEqual([0, 1]);
    expect(chunk.complete).toBe(false);
    // ...and the next read picks the line up once it is terminated.
    fs.writeFileSync(file, `${line(0)}\n${line(1)}\n${line(2)}\n`);
    const next = readTranscriptChunk(file, chunk.cursor, { maxBytes: 1 << 20 });
    expect(next.entries.map((e) => JSON.parse(e).i)).toEqual([2]);
  });

  it("reports a missing file as complete-with-nothing, not as an error", () => {
    // A session whose file has not been created yet is a normal state during
    // startup, not a failure worth tearing the backfill down over.
    const chunk = readTranscriptChunk(path.join(dir, "absent.jsonl"), undefined, {});
    expect(chunk.entries).toEqual([]);
    expect(chunk.complete).toBe(true);
  });

  it("makes progress on a line larger than maxBytes rather than stalling", () => {
    // Without this, one oversized entry wedges the backfill forever: every read
    // would return nothing and the cursor would never advance.
    const huge = JSON.stringify({ i: 0, blob: "x".repeat(50_000) });
    fs.writeFileSync(file, `${huge}\n${line(1)}\n`);
    const chunk = readTranscriptChunk(file, undefined, { maxBytes: 100 });
    // `maxBytes` is a read budget, not a hard cap on what is emitted: bytes
    // already pulled in while hunting the terminator are emitted rather than
    // re-read, so a trailing small line may ride along. Overshooting is the
    // acceptable outcome here; stalling is not.
    expect(JSON.parse(chunk.entries[0]).blob).toHaveLength(50_000);
    expect(chunk.cursor?.offset).toBeGreaterThan(50_000);
  });
});

describe("registration is not blocked by the transfer (#P1, task 11.5)", () => {
  it("a large transcript yields its first chunk in bounded time", () => {
    // 44 MB is the observed maximum in D12's measurements. The guarantee is
    // that the FIRST chunk costs a bounded read, not a whole-file one — so the
    // session is usable before the transfer completes.
    const big = JSON.stringify({ i: 0, blob: "y".repeat(1000) });
    fs.writeFileSync(file, `${`${big}\n`.repeat(45_000)}`);
    expect(fs.statSync(file).size).toBeGreaterThan(40 * 1024 * 1024);

    const started = process.hrtime.bigint();
    const chunk = readTranscriptChunk(file, undefined, { maxBytes: 64 * 1024 });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(chunk.complete).toBe(false);
    expect(chunk.entries.length).toBeGreaterThan(0);
    // Generous bound: this asserts "did not read 44 MB", not a latency SLO.
    expect(elapsedMs).toBeLessThan(250);
  });
});
