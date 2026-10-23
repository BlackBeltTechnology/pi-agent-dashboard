import { afterEach, describe, expect, it } from "vitest";
import {
  buildRowKeyToIndex,
  buildToolCallToRowIndex,
  buildTurnToFirstRowIndex,
  computeRowTextChars,
  estimateVirtualRowSize,
  extendRangeWithSelection,
  isBurst,
  isGroup,
  liveSelectionRowSpan,
  mergeCopySpan,
  rangeToRowIndexSpan,
  retainedSelectionRows,
  virtualRowKey,
} from "../chat/chat-virtual-rows.js";
import type { ChatMessage } from "../chat/event-reducer.js";
import type { BurstItem, ToolBurstGroup } from "../chat/group-tool-bursts.js";
import type { ToolCallGroup } from "../chat/group-tool-calls.js";

function msg(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { role: "assistant", content: "", timestamp: 0, ...partial };
}

function burst(id: string): ToolBurstGroup {
  return { type: "burst", id, items: [] };
}

function group(memberId?: string, toolName = "bash"): ToolCallGroup {
  return {
    type: "group",
    toolName,
    messages: memberId ? [msg({ id: memberId, role: "toolResult" })] : [],
  } as unknown as ToolCallGroup;
}

describe("virtualRowKey (CR-3)", () => {
  it("keys a burst by its id", () => {
    expect(virtualRowKey(burst("b1"), 0)).toBe("b1");
  });

  it("keys a group by its first member id", () => {
    expect(virtualRowKey(group("m1"), 3)).toBe("m1");
  });

  it("falls back to a positional group key (never a bare toolName)", () => {
    // A member-less group would otherwise collide across two sub-threshold
    // bursts of the same tool — synthesize a per-position id instead.
    expect(virtualRowKey(group(undefined, "bash"), 7)).toBe("group-7");
  });

  it("keys a plain message by its id", () => {
    expect(virtualRowKey(msg({ id: "u1", role: "user" }), 0)).toBe("u1");
  });

  it("produces unique keys across a mixed row list", () => {
    const rows: BurstItem[] = [
      msg({ id: "u1", role: "user" }),
      burst("b1"),
      group("m1"),
      group(undefined),
      msg({ id: "a1", role: "assistant" }),
    ];
    const keys = rows.map((r, i) => virtualRowKey(r, i));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("estimateVirtualRowSize (task 2.2)", () => {
  it("estimates a burst taller than a turn separator", () => {
    expect(estimateVirtualRowSize(burst("b"))).toBeGreaterThan(
      estimateVirtualRowSize(msg({ id: "s", role: "turnSeparator" })),
    );
  });

  it("returns a positive estimate for every message role", () => {
    const roles: ChatMessage["role"][] = [
      "user",
      "assistant",
      "toolResult",
      "thinking",
      "bashOutput",
      "commandFeedback",
      "interactiveUi",
      "turnSeparator",
      "rawEvent",
      "inlineTerminal",
      "custom",
    ];
    for (const role of roles) {
      expect(estimateVirtualRowSize(msg({ id: role, role }))).toBeGreaterThan(0);
    }
  });

  it("gives the custom row an EXPLICIT base above the default arm, not the fallback (P2)", () => {
    // The card's body region is height-capped (max-h-[240px]), so the text
    // reserve is clamped to 240 — a 200-line JSON body must not over-estimate
    // (first-paint drift; security-pass advisory #3).
    const custom = msg({ id: "c1", role: "custom" });
    expect(estimateVirtualRowSize(custom, 0)).toBe(160);
    expect(estimateVirtualRowSize(custom, 0)).toBeGreaterThan(120);
    // 200-line body (~16k chars): reserve clamps at 240 → 160 + 240 = 400.
    expect(estimateVirtualRowSize(custom, 16_000)).toBe(160 + 240);
  });

  it("is monotonic in text length (larger payload -> larger estimate), up to the clamp", () => {
    const row = msg({ id: "a", role: "assistant" });
    const small = estimateVirtualRowSize(row, 500);
    const mid = estimateVirtualRowSize(row, 5_000);
    const large = estimateVirtualRowSize(row, 20_000);
    expect(mid).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(mid);
  });

  it("clamps the text reserve so a pathological row does not reserve unbounded px", () => {
    const row = msg({ id: "a", role: "assistant" });
    const huge = estimateVirtualRowSize(row, 1_000_000);
    // base(140) + clamp(8000) = 8140; must not scale to ~250000px.
    expect(huge).toBeLessThanOrEqual(140 + 8000);
  });

  it("saturates at the clamp boundary (CHARS_PER_LINE=80, LINE_PX=20, clamp=8000)", () => {
    const row = msg({ id: "a", role: "assistant" });
    // ceil(32000/80)*20 = 8000 = clamp exactly (base 140 + 8000 = 8140).
    expect(estimateVirtualRowSize(row, 32_000)).toBe(140 + 8000);
    // One char past the boundary already saturates (ceil(32001/80)*20 = 8020 -> clamped).
    expect(estimateVirtualRowSize(row, 32_001)).toBe(140 + 8000);
    // Far above the clamp stays saturated at the same value.
    expect(estimateVirtualRowSize(row, 5_000_000)).toBe(estimateVirtualRowSize(row, 32_000));
  });

  it("returns the bare base (no reserve) for an empty text payload", () => {
    // textChars defaults to 0; no image block -> base only.
    expect(estimateVirtualRowSize(msg({ id: "a", role: "assistant" }))).toBe(140);
    expect(estimateVirtualRowSize(msg({ id: "u", role: "user" }), 0)).toBe(96);
  });

  it("adds the user image reserve (300) for an image-bearing user row", () => {
    const withText = estimateVirtualRowSize(msg({ id: "u", role: "user" }), 1000);
    const withImage = estimateVirtualRowSize(
      msg({ id: "u", role: "user", images: [{ data: "x", mimeType: "image/png" }] }),
      1000,
    );
    expect(withImage - withText).toBe(300);
  });

  it("adds the larger tool-result image reserve (512) for an image-bearing toolResult row", () => {
    const withText = estimateVirtualRowSize(msg({ id: "t", role: "toolResult" }), 1000);
    const withImage = estimateVirtualRowSize(
      msg({ id: "t", role: "toolResult", images: [{ data: "x", mimeType: "image/png" }] }),
      1000,
    );
    expect(withImage - withText).toBe(512);
  });
});

describe("computeRowTextChars (task 2.1)", () => {
  it("sums content + result length for a message row", () => {
    expect(computeRowTextChars(msg({ id: "a", role: "assistant", content: "hello" }))).toBe(5);
    expect(
      computeRowTextChars(msg({ id: "t", role: "toolResult", content: "ab", result: "cde" })),
    ).toBe(5);
  });

  it("aggregates member text for a group row", () => {
    const g = {
      type: "group",
      toolName: "bash",
      messages: [
        msg({ id: "m1", role: "toolResult", result: "1234" }),
        msg({ id: "m2", role: "toolResult", content: "567" }),
      ],
    } as unknown as ToolCallGroup;
    expect(computeRowTextChars(g)).toBe(7);
  });

  it("returns 0 for empty/default message, group, and burst payloads", () => {
    expect(computeRowTextChars(msg({ id: "a", role: "assistant", content: "" }))).toBe(0);
    expect(
      computeRowTextChars({ type: "group", toolName: "bash", messages: [] } as unknown as ToolCallGroup),
    ).toBe(0);
    expect(computeRowTextChars({ type: "burst", id: "b", items: [] } as ToolBurstGroup)).toBe(0);
  });

  it("aggregates member text across a burst's items", () => {
    const b: ToolBurstGroup = {
      type: "burst",
      id: "b",
      items: [
        msg({ id: "m1", role: "toolResult", result: "abcd" }),
        {
          type: "group",
          toolName: "bash",
          messages: [msg({ id: "m2", role: "toolResult", content: "ef" })],
        } as unknown as ToolCallGroup,
      ],
    };
    expect(computeRowTextChars(b)).toBe(6);
  });
});

describe("buildTurnToFirstRowIndex (CR-4)", () => {
  it("maps each turnIndex to its first row index", () => {
    const rows: BurstItem[] = [
      msg({ id: "u0", role: "user", turnIndex: 0 }),
      msg({ id: "a0", role: "assistant" }),
      burst("b0"),
      msg({ id: "u1", role: "user", turnIndex: 1 }),
      msg({ id: "a1", role: "assistant" }),
    ];
    const map = buildTurnToFirstRowIndex(rows);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(3);
  });

  it("keeps the first row for a duplicated turnIndex", () => {
    const rows: BurstItem[] = [
      msg({ id: "u2a", role: "user", turnIndex: 2 }),
      msg({ id: "u2b", role: "user", turnIndex: 2 }),
    ];
    expect(buildTurnToFirstRowIndex(rows).get(2)).toBe(0);
  });

  it("skips burst/group rows (they carry no turnIndex)", () => {
    const rows: BurstItem[] = [
      burst("b"),
      group("m"),
      msg({ id: "u5", role: "user", turnIndex: 5 }),
    ];
    const map = buildTurnToFirstRowIndex(rows);
    expect(map.size).toBe(1);
    expect(map.get(5)).toBe(2);
  });

  it("returns an empty map when no row carries a turnIndex", () => {
    expect(buildTurnToFirstRowIndex([burst("b"), msg({ id: "a", role: "assistant" })]).size).toBe(0);
  });
});

describe("type guards", () => {
  it("discriminates burst / group / message", () => {
    expect(isBurst(burst("b"))).toBe(true);
    expect(isGroup(group("m"))).toBe(true);
    expect(isBurst(msg({ id: "m", role: "user" }))).toBe(false);
    expect(isGroup(msg({ id: "m", role: "user" }))).toBe(false);
  });
});

// --- Active-selection retention (change: preserve-chat-selection-during-churn) ---

describe("rangeToRowIndexSpan (task 4.1)", () => {
  // container
  //   div[data-index=0] > p
  //   div[data-index=1] > p
  //   div[data-index=2] > p
  //   div.tail            (non-virtual streaming tail, below the rows)
  // composer (non-virtual, before the container in document order)
  let container: HTMLElement;
  let rows: HTMLElement[];
  let tail: HTMLElement;
  let composer: HTMLElement;
  const ROW_COUNT = 3;

  afterEach(() => {
    document.body.innerHTML = "";
  });

  function setup() {
    composer = document.createElement("p");
    composer.textContent = "composer text";
    container = document.createElement("div");
    rows = [0, 1, 2].map((i) => {
      const row = document.createElement("div");
      row.setAttribute("data-index", String(i));
      const p = document.createElement("p");
      p.textContent = `row ${i}`;
      row.appendChild(p);
      container.appendChild(row);
      return row;
    });
    tail = document.createElement("div");
    tail.textContent = "streaming tail";
    container.appendChild(tail);
    document.body.appendChild(composer);
    document.body.appendChild(container);
  }

  function leafText(el: Node): Node {
    let n: Node = el;
    while (n.firstChild) n = n.firstChild;
    return n;
  }

  function rangeOf(startEl: Node, endEl: Node): Range {
    const range = document.createRange();
    const s = leafText(startEl);
    const e = leafText(endEl);
    range.setStart(s, 0);
    range.setEnd(e, e.textContent?.length ?? 0);
    return range;
  }

  it("maps a same-row selection to a single-row span", () => {
    setup();
    expect(rangeToRowIndexSpan(rangeOf(rows[1], rows[1]), container, ROW_COUNT)).toEqual({ min: 1, max: 1 });
  });

  it("maps a multi-row selection to the min..max span", () => {
    setup();
    expect(rangeToRowIndexSpan(rangeOf(rows[0], rows[2]), container, ROW_COUNT)).toEqual({ min: 0, max: 2 });
  });

  it("clamps a non-virtual endpoint below the rows (streaming tail) to the last row", () => {
    setup();
    expect(rangeToRowIndexSpan(rangeOf(rows[1], tail), container, ROW_COUNT)).toEqual({ min: 1, max: 2 });
  });

  it("clamps a cross-boundary endpoint before the container (composer) to the first row", () => {
    setup();
    expect(rangeToRowIndexSpan(rangeOf(composer, rows[1]), container, ROW_COUNT)).toEqual({ min: 0, max: 1 });
  });

  it("returns null when the selection touches only non-virtual regions (streaming tail)", () => {
    setup();
    expect(rangeToRowIndexSpan(rangeOf(tail, tail), container, ROW_COUNT)).toBeNull();
  });

  it("returns null when the selection is entirely outside the container", () => {
    setup();
    const outside2 = document.createElement("p");
    outside2.textContent = "other pane";
    document.body.appendChild(outside2);
    expect(rangeToRowIndexSpan(rangeOf(composer, outside2), container, ROW_COUNT)).toBeNull();
  });

  it("returns null for an empty transcript (rowCount 0)", () => {
    setup();
    expect(rangeToRowIndexSpan(rangeOf(rows[0], rows[1]), container, 0)).toBeNull();
  });
});

describe("extendRangeWithSelection (task 4.2 / 4.4)", () => {
  it("returns the base range unchanged when there is no selection span", () => {
    expect(extendRangeWithSelection([10, 11, 12], null, 100, 50)).toEqual([10, 11, 12]);
  });

  it("unions the selection span into the base range, sorted and deduped", () => {
    expect(extendRangeWithSelection([10, 11, 12], { min: 5, max: 7 }, 100, 50)).toEqual([5, 6, 7, 10, 11, 12]);
  });

  it("merges an overlapping span without duplicating indices", () => {
    expect(extendRangeWithSelection([10, 11, 12], { min: 11, max: 13 }, 100, 50)).toEqual([10, 11, 12, 13]);
  });

  it("clamps the unioned span to [0, count)", () => {
    expect(extendRangeWithSelection([18, 19], { min: 17, max: 25 }, 100, 20)).toEqual([17, 18, 19]);
  });

  it("E1: past the cap retains only the endpoint rows, never the interior (D1)", () => {
    const base = Array.from({ length: 11 }, (_, i) => 10 + i);
    for (const len of [99, 100]) {
      const out = extendRangeWithSelection(base, { min: 200, max: 200 + len - 1 }, 100, 1000);
      for (let i = 200; i < 200 + len; i++) expect(out).toContain(i);
      expect(out).toEqual([...out].sort((a, b) => a - b));
      expect(out.every((i) => i >= 0 && i < 1000)).toBe(true);
    }
    const over = extendRangeWithSelection(base, { min: 200, max: 300 }, 100, 1000); // 101 rows
    expect(over).toEqual([...base, 200, 300]);
    expect(over).not.toContain(250);
  });

  it("retains a span exactly at the cap boundary", () => {
    const span = { min: 0, max: 99 }; // length 100 == cap
    const out = extendRangeWithSelection([], span, 100, 200);
    expect(out.length).toBe(100);
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(99);
  });
});

describe("buildToolCallToRowIndex (composer dock Show)", () => {
  it("maps a plain toolResult row's toolCallId to its row index", () => {
    const rows: BurstItem[] = [
      msg({ id: "u0", role: "user" }),
      msg({ id: "t1", role: "toolResult", toolCallId: "call-1" }),
    ];
    expect(buildToolCallToRowIndex(rows).get("call-1")).toBe(1);
  });

  it("maps members of a ×N group and a burst to the row that wraps them", () => {
    const grouped = {
      type: "group",
      toolName: "bash",
      messages: [msg({ id: "g1", role: "toolResult", toolCallId: "call-g" })],
    } as unknown as ToolCallGroup;
    const bursted: ToolBurstGroup = {
      type: "burst",
      id: "b0",
      items: [msg({ id: "b1", role: "toolResult", toolCallId: "call-b" }), grouped],
    };
    const map = buildToolCallToRowIndex([msg({ id: "a", role: "assistant" }), grouped, bursted]);
    expect(map.get("call-g")).toBe(1);
    expect(map.get("call-b")).toBe(2);
  });

  it("keeps the first row for a duplicated id and returns nothing for rows without ids", () => {
    const map = buildToolCallToRowIndex([
      msg({ id: "x", role: "toolResult", toolCallId: "dup" }),
      msg({ id: "y", role: "toolResult", toolCallId: "dup" }),
      msg({ id: "z", role: "assistant" }),
    ]);
    expect(map.get("dup")).toBe(0);
    expect(map.size).toBe(1);
  });
});

// --- keep-oversized-chat-selection: D4 retained union, copy span, live resolution ---

const span = (min: number, max: number) => ({ min, max });
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("retainedSelectionRows (D4 union rule)", () => {
  it("E2: stale stored + live spans whose hull exceeds the cap retain only the four endpoints", () => {
    const out = retainedSelectionRows(span(0, 60), span(50, 110), 100, 1000);
    expect(out).toEqual([0, 50, 60, 110]);
    expect(out.length).toBeLessThanOrEqual(Math.max(100, 4));
  });

  it("E3: a hull within the cap retains every row of the hull", () => {
    expect(retainedSelectionRows(span(10, 40), span(10, 60), 100, 1000)).toEqual(range(10, 60));
  });

  it("uses the single available span and clamps to [0, count)", () => {
    expect(retainedSelectionRows(null, span(3, 5), 100, 1000)).toEqual([3, 4, 5]);
    expect(retainedSelectionRows(span(8, 30), null, 10, 20)).toEqual([8, 19]);
    expect(retainedSelectionRows(null, null, 100, 20)).toEqual([]);
  });
});

describe("mergeCopySpan (D2)", () => {
  it("E4: unions the copy span and reports the copy-only rows", () => {
    const base = range(10, 20);
    const retained = [0, 300];
    const { rows, copyOnly } = mergeCopySpan(base, retained, span(0, 300), 1000);
    expect(rows).toEqual(range(0, 300));
    const expected = new Set(range(0, 300).filter((i) => !(i >= 10 && i <= 20) && i !== 0 && i !== 300));
    expect(copyOnly).toEqual(expected);
  });

  it("returns base unchanged and an empty copy-only set without a copy span", () => {
    const { rows, copyOnly } = mergeCopySpan([1, 2], [5], null, 10);
    expect(rows).toEqual([1, 2, 5]);
    expect(copyOnly.size).toBe(0);
  });
});

describe("liveSelectionRowSpan (D4)", () => {
  let container: HTMLElement;
  let rows: HTMLElement[];
  let keyToIndex: Map<string, number>;

  function setup(count = 10) {
    container = document.createElement("div");
    rows = Array.from({ length: count }, (_, i) => {
      const row = document.createElement("div");
      row.setAttribute("data-index", String(i));
      row.setAttribute("data-row-key", `k${i}`);
      row.textContent = `row ${i}`;
      container.appendChild(row);
      return row;
    });
    document.body.appendChild(container);
    keyToIndex = new Map(rows.map((_, i) => [`k${i}`, i]));
  }

  function select(startNode: Node, endNode: Node) {
    const r = document.createRange();
    r.setStart(startNode.firstChild ?? startNode, 0);
    const end = endNode.firstChild ?? endNode;
    r.setEnd(end, end.textContent?.length ?? 0);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }

  afterEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  it("E5: resolves a reversed range, clamps a non-virtual tail endpoint, and null when collapsed", () => {
    setup();
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    // Reversed: anchor in k7, focus in k2.
    sel.setBaseAndExtent(rows[7].firstChild!, 0, rows[2].firstChild!, 0);
    expect(liveSelectionRowSpan(container, keyToIndex, 10)).toEqual({ min: 2, max: 7 });

    const tail = document.createElement("div");
    tail.textContent = "streaming tail";
    container.appendChild(tail);
    select(rows[4], tail);
    expect(liveSelectionRowSpan(container, keyToIndex, 10)).toEqual({ min: 4, max: 9 });

    sel.removeAllRanges();
    expect(liveSelectionRowSpan(container, keyToIndex, 10)).toBeNull();
    sel.setBaseAndExtent(rows[3].firstChild!, 1, rows[3].firstChild!, 1);
    expect(liveSelectionRowSpan(container, keyToIndex, 10)).toBeNull();
  });

  it("E6: resolves by row key, not by the stale pre-splice data-index", () => {
    setup();
    // 5 rows spliced above: k3 now lives at index 8, but the DOM still says 3.
    keyToIndex.set("k3", 8);
    select(rows[3], rows[3]);
    expect(liveSelectionRowSpan(container, keyToIndex, 15)).toEqual({ min: 8, max: 8 });
  });

  it("E7: a range with both endpoints outside the container is null", () => {
    setup();
    const before = document.createElement("p");
    before.textContent = "before";
    const after = document.createElement("p");
    after.textContent = "after";
    document.body.insertBefore(before, container);
    document.body.appendChild(after);
    select(before, after);
    expect(liveSelectionRowSpan(container, keyToIndex, 10)).toBeNull();
  });

  it("E8: a missing key falls back to the stored bound without throwing", () => {
    setup();
    rows[5].setAttribute("data-row-key", "kX"); // trimmed from displayRows
    select(rows[1], rows[5]);
    expect(liveSelectionRowSpan(container, keyToIndex, 40, span(4, 30))).toEqual({ min: 1, max: 30 });
    select(rows[5], rows[8]);
    expect(liveSelectionRowSpan(container, keyToIndex, 40, span(4, 30))).toEqual({ min: 4, max: 8 });
  });

  it("P3: live read + union stays under 0.2 ms per call over a 2000-entry key map", () => {
    setup();
    const big = new Map<string, number>(Array.from({ length: 2000 }, (_, i) => [`k${i}`, i]));
    select(rows[1], rows[8]);
    const base = range(0, 15);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const live = liveSelectionRowSpan(container, big, 2000);
      mergeCopySpan(base, retainedSelectionRows(span(1, 8), live, 100, 2000), null, 2000);
    }
    expect((performance.now() - t0) / 1000).toBeLessThan(0.2);
  });
});

describe("buildRowKeyToIndex", () => {
  it("maps virtualRowKey of each display row to its index", () => {
    const rows: BurstItem[] = [msg({ id: "a" }), burst("b1"), group("g1"), msg({ id: "z" })];
    const map = buildRowKeyToIndex(rows);
    expect(map.get("a")).toBe(0);
    expect(map.get("b1")).toBe(1);
    expect(map.get("g1")).toBe(2);
    expect(map.get("z")).toBe(3);
    expect(map.size).toBe(4);
  });
});
