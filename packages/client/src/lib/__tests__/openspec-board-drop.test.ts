/**
 * L1 tests for board drop-slot resolution (midpoint rule), the shared drop
 * target resolver, and the without-moved → rendered marker-host translation.
 *
 * Folded from test-plan.md rows E1–E14, X7, P2.
 * See change: fix-openspec-board-drop-targeting.
 */
import { describe, expect, it } from "vitest";
import {
  type CardRectMap,
  computeReorder,
  markerHostIndex,
  resolveDropSlot,
  resolveDropTarget,
  slotsEqual,
} from "../openspec/openspec-board-order.js";

/** Build a rect map of uniform 100px-tall cards stacked from y=0 with no gap. */
function rects(names: string[], height = 100): CardRectMap {
  const m: CardRectMap = new Map();
  names.forEach((n, i) => m.set(n, { top: i * height, bottom: i * height + height }));
  return m;
}

/** Midpoint of the i-th card in a `rects()` stack. */
const mid = (i: number, height = 100) => i * height + height / 2;

describe("resolveDropSlot — midpoint rule (E1–E9)", () => {
  const abc = ["a", "b", "c"];

  it("E1: pointer 1px above b's midpoint resolves before b (index 1)", () => {
    expect(
      resolveDropSlot({ cardRects: rects(abc), pointerY: mid(1) - 1, movedName: "X", columnNames: abc }),
    ).toBe(1);
  });

  it("E2: pointer exactly at b's midpoint resolves after b (index 2) — tie breaks after", () => {
    expect(
      resolveDropSlot({ cardRects: rects(abc), pointerY: mid(1), movedName: "X", columnNames: abc }),
    ).toBe(2);
  });

  it("E3: pointer 1px below b's midpoint resolves after b (index 2)", () => {
    expect(
      resolveDropSlot({ cardRects: rects(abc), pointerY: mid(1) + 1, movedName: "X", columnNames: abc }),
    ).toBe(2);
  });

  it("E4: last slot is reachable — 1px below c's midpoint resolves to 3", () => {
    expect(
      resolveDropSlot({ cardRects: rects(abc), pointerY: mid(2) + 1, movedName: "X", columnNames: abc }),
    ).toBe(3);
  });

  it("E5: first slot is reachable — above a's midpoint resolves to 0", () => {
    expect(
      resolveDropSlot({ cardRects: rects(abc), pointerY: mid(0) - 1, movedName: "X", columnNames: abc }),
    ).toBe(0);
    // Far above the column too.
    expect(
      resolveDropSlot({ cardRects: rects(abc), pointerY: -500, movedName: "X", columnNames: abc }),
    ).toBe(0);
  });

  it("E6: empty column resolves to 0 and does not throw", () => {
    expect(() =>
      resolveDropSlot({ cardRects: new Map(), pointerY: 123, movedName: "X", columnNames: [] }),
    ).not.toThrow();
    expect(
      resolveDropSlot({ cardRects: new Map(), pointerY: 123, movedName: "X", columnNames: [] }),
    ).toBe(0);
  });

  it("E7: single-card column, pointer below a's midpoint resolves to 1", () => {
    expect(
      resolveDropSlot({ cardRects: rects(["a"]), pointerY: mid(0) + 1, movedName: "X", columnNames: ["a"] }),
    ).toBe(1);
  });

  it("E8: direction- and scope-independent — up, down, and cross-column agree", () => {
    const abcd = ["a", "b", "c", "d"];
    const r = rects(abcd);
    // The gap between b and c: below b's midpoint, above c's midpoint.
    const pointerY = mid(1) + 10;
    const draggedUpFromD = resolveDropSlot({ cardRects: r, pointerY, movedName: "d", columnNames: abcd });
    const draggedDownFromA = resolveDropSlot({ cardRects: r, pointerY, movedName: "a", columnNames: abcd });
    const crossColumn = resolveDropSlot({ cardRects: r, pointerY, movedName: "X", columnNames: abcd });
    // Same-column drags exclude the moved card, so their without-moved index is
    // one lower than the cross-column index when the moved card sits above the
    // slot — the point is that each direction yields the SAME index for the same
    // source, i.e. there is no direction branch at all.
    expect(draggedUpFromD).toBe(2);
    expect(draggedDownFromA).toBe(1);
    expect(crossColumn).toBe(2);
    // Dragging up from d and dragging in from another column both leave a,b,c
    // intact ahead of the slot, so they must agree exactly.
    expect(draggedUpFromD).toBe(crossColumn);
  });

  it("E9: the moved card is excluded from the count (index is into the without-moved list)", () => {
    const abcd = ["a", "b", "c", "d"];
    const r = rects(abcd);
    // Dragging b; pointer below c's midpoint. Without-moved list is [a,c,d];
    // a and c are above the pointer ⇒ index 2.
    expect(resolveDropSlot({ cardRects: r, pointerY: mid(2) + 1, movedName: "b", columnNames: abcd })).toBe(2);
    // Pointer past every card: index === without-moved length, never the
    // rendered length.
    expect(resolveDropSlot({ cardRects: r, pointerY: 10_000, movedName: "b", columnNames: abcd })).toBe(3);
  });

  it("ignores names with no measured rect", () => {
    const abc2 = ["a", "b", "c"];
    const r = rects(abc2);
    r.delete("b");
    // Only a and c are measured; pointer past both ⇒ 2.
    expect(resolveDropSlot({ cardRects: r, pointerY: 10_000, movedName: "X", columnNames: abc2 })).toBe(2);
  });
});

describe("resolveDropSlot → computeReorder (E10, E11)", () => {
  it("E10: an adjacent downward drag is not a no-op", () => {
    const abcd = ["a", "b", "c", "d"];
    const idx = resolveDropSlot({
      cardRects: rects(abcd),
      pointerY: mid(2) + 1, // below c's midpoint
      movedName: "b",
      columnNames: abcd,
    });
    expect(computeReorder(abcd, "b", idx)).toEqual(["a", "c", "b", "d"]);
    expect(computeReorder(abcd, "b", idx)).not.toEqual(abcd);
  });

  it("E11: computeReorder consumes the resolved index directly — no caller +1", () => {
    const abc = ["a", "b", "c"];
    const r = rects(abc);
    const cross = (pointerY: number) =>
      computeReorder(abc, "X", resolveDropSlot({ cardRects: r, pointerY, movedName: "X", columnNames: abc }));
    expect(cross(mid(1) - 1)).toEqual(["a", "X", "b", "c"]); // E1
    expect(cross(mid(1))).toEqual(["a", "b", "X", "c"]); // E2
    expect(cross(mid(1) + 1)).toEqual(["a", "b", "X", "c"]); // E3
    expect(cross(mid(2) + 1)).toEqual(["a", "b", "c", "X"]); // E4 — last slot
    expect(cross(mid(0) - 1)).toEqual(["X", "a", "b", "c"]); // E5 — first slot

    // E6 / E7
    expect(computeReorder([], "X", resolveDropSlot({ cardRects: new Map(), pointerY: 5, movedName: "X", columnNames: [] }))).toEqual(["X"]);
    expect(
      computeReorder(["a"], "X", resolveDropSlot({ cardRects: rects(["a"]), pointerY: mid(0) + 1, movedName: "X", columnNames: ["a"] })),
    ).toEqual(["a", "X"]);

    // E9 — same-column drag, index is already in without-moved space.
    const abcd = ["a", "b", "c", "d"];
    const same = resolveDropSlot({ cardRects: rects(abcd), pointerY: mid(2) + 1, movedName: "b", columnNames: abcd });
    expect(computeReorder(abcd, "b", same)).toEqual(["a", "c", "b", "d"]);
  });
});

describe("markerHostIndex — without-moved → rendered translation (E12, E13)", () => {
  it("E12: same-column drag never picks the dragged card as the marker host", () => {
    // [a,b,c], dragging b (rendered index 1), resolved without-index 1.
    // Without-moved list is [a,c]; slot 1 sits before c ⇒ host is rendered 2.
    expect(markerHostIndex(1, 1)).toBe(2);
    expect(markerHostIndex(1, 1)).not.toBe(1);
    // Slot 0 sits before a, which is ahead of the dragged card ⇒ no offset.
    expect(markerHostIndex(0, 1)).toBe(0);
  });

  it("E13: cross-column drop applies no offset", () => {
    expect(markerHostIndex(1, null)).toBe(1);
    expect(markerHostIndex(0, null)).toBe(0);
    expect(markerHostIndex(3, null)).toBe(3);
  });
});

describe("resolveDropTarget — decision table (E14)", () => {
  it("resolves a card id to its owning column with kind 'card'", () => {
    expect(resolveDropTarget({ id: "add-auth", data: { type: "card", groupKey: "next-phase" } })).toEqual({
      colKey: "next-phase",
      kind: "card",
    });
  });

  it("resolves a bare column key to kind 'body'", () => {
    expect(resolveDropTarget({ id: "next-phase", data: { type: "column", groupKey: "next-phase" } })).toEqual({
      colKey: "next-phase",
      kind: "body",
    });
  });

  it("resolves col-root:<k> to kind 'root'", () => {
    expect(resolveDropTarget({ id: "col-root:next-phase", data: { type: "column-root", groupKey: "next-phase" } })).toEqual({
      colKey: "next-phase",
      kind: "root",
    });
  });

  it("resolves rail:<k> to kind 'rail'", () => {
    expect(resolveDropTarget({ id: "rail:next-phase", data: { type: "rail", groupKey: "next-phase" } })).toEqual({
      colKey: "next-phase",
      kind: "rail",
    });
  });

  it("resolves namespaced ids without relying on data", () => {
    expect(resolveDropTarget({ id: "rail:next-phase" })).toEqual({ colKey: "next-phase", kind: "rail" });
    expect(resolveDropTarget({ id: "col-root:next-phase" })).toEqual({ colKey: "next-phase", kind: "root" });
  });

  it("returns null for an unusable over id", () => {
    expect(resolveDropTarget({ id: "" })).toBeNull();
    expect(resolveDropTarget({ id: "rail:" })).toBeNull();
    expect(resolveDropTarget({ id: "col-root:" })).toBeNull();
    expect(resolveDropTarget({ id: "some-card", data: { type: "card" } })).toBeNull();
  });

  it("column keys containing a colon survive the namespace split", () => {
    expect(resolveDropTarget({ id: "rail:a:b" })).toEqual({ colKey: "a:b", kind: "rail" });
  });
});

describe("X7 — rail / col-root ids never reach persistence", () => {
  it("persists under the bare column key, never a namespaced id", () => {
    const target = resolveDropTarget({ id: "rail:next-phase", data: { type: "rail", groupKey: "next-phase" } });
    expect(target).not.toBeNull();
    const colKey = target!.colKey;
    expect(colKey).toBe("next-phase");

    const current = ["a", "b", "c"];
    // kind 'rail' forces the slot to last.
    const index = target!.kind === "rail" ? current.filter((n) => n !== "X").length : 0;
    const order = computeReorder(current, "X", index);
    expect(order).toEqual(["a", "b", "c", "X"]);

    const persisted: Record<string, string[]> = { [colKey]: order };
    for (const key of Object.keys(persisted)) {
      expect(key.startsWith("rail:")).toBe(false);
      expect(key.startsWith("col-root:")).toBe(false);
    }
    for (const name of order) {
      expect(name.startsWith("rail:")).toBe(false);
      expect(name.startsWith("col-root:")).toBe(false);
    }
  });

  it("col-root ids normalise the same way for both drag branches", () => {
    expect(resolveDropTarget({ id: "col-root:backlog" })!.colKey).toBe("backlog");
  });
});

describe("P2 — early bail-out is effective", () => {
  it("100 resolutions inside one gap all agree, so the guard suppresses every update", () => {
    const abcd = ["a", "b", "c", "d"];
    const r = rects(abcd);
    let updates = 0;
    let prev: { colKey: string; index: number } | null = null;
    // Sweep 100 pointer positions strictly inside the b→c gap (below b's
    // midpoint, above c's midpoint): mid(1)=150, mid(2)=250.
    for (let i = 0; i < 100; i++) {
      const pointerY = 151 + i * 0.9; // 151 → 240.1, all inside the gap
      const index = resolveDropSlot({ cardRects: r, pointerY, movedName: "X", columnNames: abcd });
      const next = { colKey: "backlog", index };
      if (!slotsEqual(prev, next)) {
        updates++;
        prev = next;
      }
    }
    expect(updates).toBe(1); // the initial resolution only
  });

  it("resolves a 64-card column in one pass — at most one rect read per card", () => {
    // The frame-budget e2e (test-plan #P1) can only see DROPPED frames, so an
    // O(n²) resolver that still fits inside one refresh interval would slip
    // past it. This pins the complexity directly, without timing: the resolver
    // must consult each card's rect at most once.
    const names = Array.from({ length: 64 }, (_, i) => `c${i}`);
    const backing = rects(names);
    let reads = 0;
    const counting: CardRectMap = {
      get(name: string) {
        reads++;
        return backing.get(name);
      },
    } as unknown as CardRectMap;

    const index = resolveDropSlot({
      cardRects: counting,
      pointerY: mid(31),
      movedName: "c10",
      columnNames: names,
    });
    // c0…c31 are at/above the pointer; c10 is the moved card and excluded.
    expect(index).toBe(31);
    expect(reads).toBeLessThanOrEqual(names.length);
  });

  it("slotsEqual distinguishes column, index, and null", () => {
    expect(slotsEqual(null, null)).toBe(true);
    expect(slotsEqual(null, { colKey: "a", index: 0 })).toBe(false);
    expect(slotsEqual({ colKey: "a", index: 0 }, null)).toBe(false);
    expect(slotsEqual({ colKey: "a", index: 0 }, { colKey: "a", index: 0 })).toBe(true);
    expect(slotsEqual({ colKey: "a", index: 0 }, { colKey: "b", index: 0 })).toBe(false);
    expect(slotsEqual({ colKey: "a", index: 0 }, { colKey: "a", index: 1 })).toBe(false);
  });
});
