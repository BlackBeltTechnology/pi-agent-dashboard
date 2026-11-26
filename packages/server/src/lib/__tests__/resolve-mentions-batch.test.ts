/**
 * `parseBatchBody` bounds (audit follow-up of rich-chat-links, design D3): items past the cap are
 * validated cheaply but never materialised — only the first MAX_BATCH_ITEMS become work items; the
 * route answers the rest `unknown` from `total`.
 */
import { describe, expect, it } from "vitest";
import { MAX_BATCH_ITEMS, parseBatchBody } from "../resolve-mentions-batch.js";

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ mention: `m${i}` }));

describe("parseBatchBody cap", () => {
  it("materialises at most MAX_BATCH_ITEMS items and reports the full count", () => {
    const r = parseBatchBody({ cwd: "/x", items: many(35_000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(MAX_BATCH_ITEMS);
    expect(r.total).toBe(35_000);
    expect(r.items[199].mention).toBe("m199");
  });

  it("total equals items.length at or under the cap", () => {
    const r = parseBatchBody({ cwd: "/x", items: many(MAX_BATCH_ITEMS) });
    expect(r.ok && r.total === MAX_BATCH_ITEMS && r.items.length === MAX_BATCH_ITEMS).toBe(true);
  });

  it("still rejects a malformed or overlong item past the cap", () => {
    for (const bad of [null, { mention: 5 }, { mention: "a".repeat(1025) }, { mention: "x", toolCwd: 1 }]) {
      const items = [...many(MAX_BATCH_ITEMS + 5), bad];
      expect(parseBatchBody({ cwd: "/x", items }).ok).toBe(false);
    }
  });
});
