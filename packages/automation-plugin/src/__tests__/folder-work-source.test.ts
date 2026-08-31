/**
 * Folder-backed work-source + registry: distinct leasing (E1), single-flight
 * (F1), in-flight exclusion + later drain (F2), stale-token ack/nack no-ops
 * (X1/X2), lease-expiry auto-release (X7), and stable idempotency key across
 * redelivery (E15).
 * See change: automation-work-source-fanout.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFolderWorkSource } from "../server/folder-work-source.js";
import { WorkSourceRegistry } from "../server/work-source-registry.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsrc-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function seed(...names: string[]): void {
  for (const n of names) fs.writeFileSync(path.join(dir, n), `body:${n}`);
}
/** File names still available in the pool (excludes the `inflight/` dir). */
function poolNames(): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}
function baseName(item: string): string {
  return path.basename(item);
}

describe("WorkSourceRegistry", () => {
  it("registers, gets, has, and lists ids", () => {
    const reg = new WorkSourceRegistry();
    const src = createFolderWorkSource({ dir });
    reg.register("inbox", src);
    expect(reg.has("inbox")).toBe(true);
    expect(reg.get("inbox")).toBe(src);
    expect([...reg.ids()]).toEqual(["inbox"]);
    expect(reg.get("nope")).toBeUndefined();
  });
});

describe("createFolderWorkSource", () => {
  it("E1: next vends distinct leased handles, one per file", () => {
    seed("a", "b", "c");
    const src = createFolderWorkSource({ dir });
    const handles = src.next(3);
    expect(handles).toHaveLength(3);
    const items = handles.map((h) => baseName(h.item)).sort();
    expect(items).toEqual(["a", "b", "c"]);
    // distinct lease tokens
    expect(new Set(handles.map((h) => h.leaseToken)).size).toBe(3);
    // leased files leave the available pool
    expect(poolNames()).toEqual([]);
  });

  it("bound caps the number vended; the rest stay available", () => {
    seed("a", "b", "c", "d");
    const src = createFolderWorkSource({ dir });
    expect(src.next(2)).toHaveLength(2);
    expect(poolNames()).toHaveLength(2);
  });

  it("F1: single-flight — a leased item is not re-vended concurrently", () => {
    seed("a", "b", "c");
    const src = createFolderWorkSource({ dir });
    const first = src.next(2).map((h) => baseName(h.item)).sort();
    const second = src.next(2).map((h) => baseName(h.item));
    // No overlap between the two lease sets.
    expect(first.filter((x) => second.includes(x))).toEqual([]);
    expect([...first, ...second].sort()).toEqual(["a", "b", "c"]);
  });

  it("F2: in-flight items are excluded; a new arrival drains on a later fire", () => {
    seed("a", "b");
    const src = createFolderWorkSource({ dir });
    const leased = src.next(2).map((h) => baseName(h.item)).sort();
    expect(leased).toEqual(["a", "b"]);
    // c arrives while a,b are in-flight.
    seed("c");
    const next = src.next(2);
    expect(next.map((h) => baseName(h.item))).toEqual(["c"]);
  });

  it("ack drops the item permanently; nack returns it to the pool", () => {
    seed("a", "b");
    const src = createFolderWorkSource({ dir });
    const [ha, hb] = src.next(2);
    src.ack(ha!.leaseToken);
    src.nack(hb!.leaseToken);
    expect(poolNames()).toEqual([baseName(hb!.item)]); // only the nacked one returns
  });

  it("X7: lease expiry auto-releases the item without an explicit nack", () => {
    seed("a");
    let clock = 1000;
    const src = createFolderWorkSource({ dir, visibilityTimeoutMs: 100, now: () => clock });
    src.next(1); // leases a; never acked
    expect(poolNames()).toEqual([]);
    clock += 200; // advance past the visibility timeout
    // The next vend reclaims the expired lease first, then re-leases a.
    const redelivered = src.next(1);
    expect(redelivered.map((h) => baseName(h.item))).toEqual(["a"]);
  });

  it("X1: a stale-token ack is a no-op and does not disturb the current lease", () => {
    seed("a");
    let clock = 1000;
    const src = createFolderWorkSource({ dir, visibilityTimeoutMs: 100, now: () => clock });
    const stale = src.next(1)[0]!;
    clock += 200; // expire the first lease
    const current = src.next(1)[0]!; // re-vends a under a NEW token
    expect(current.leaseToken).not.toBe(stale.leaseToken);
    src.ack(stale.leaseToken); // stale → no-op
    // a is still leased to the current holder (not dropped, not returned).
    expect(poolNames()).toEqual([]);
    // The current lease still acks normally.
    src.ack(current.leaseToken);
    expect(poolNames()).toEqual([]);
  });

  it("X2: a stale-token nack is a no-op and does not recall a re-vended item", () => {
    seed("a");
    let clock = 1000;
    const src = createFolderWorkSource({ dir, visibilityTimeoutMs: 100, now: () => clock });
    const stale = src.next(1)[0]!;
    clock += 200;
    const current = src.next(1)[0]!;
    src.nack(stale.leaseToken); // stale → no-op: must NOT return a to the pool
    expect(poolNames()).toEqual([]); // still held by the current lease
    expect(current.leaseToken).not.toBe(stale.leaseToken);
  });

  it("E15: redelivery after expiry reuses the same idempotency key", () => {
    seed("a");
    let clock = 1000;
    const src = createFolderWorkSource({ dir, visibilityTimeoutMs: 100, now: () => clock });
    const first = src.next(1)[0]!;
    clock += 200;
    const second = src.next(1)[0]!;
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    // Distinct leases though — the key is item-derived, not lease-derived.
    expect(second.leaseToken).not.toBe(first.leaseToken);
  });

  it("next on an empty/missing folder returns no handles", () => {
    const src = createFolderWorkSource({ dir: path.join(dir, "missing") });
    expect(src.next(4)).toEqual([]);
  });
});
