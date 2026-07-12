import { afterEach, describe, expect, it } from "vitest";
import {
  buildTurnToFirstRowIndex,
  computeRowTextChars,
  estimateVirtualRowSize,
  extendRangeWithSelection,
  isBurst,
  isGroup,
  rangeToRowIndexSpan,
  virtualRowKey,
} from "../chat-virtual-rows.js";
import type { ChatMessage } from "../event-reducer.js";
import type { BurstItem, ToolBurstGroup } from "../group-tool-bursts.js";
import type { ToolCallGroup } from "../group-tool-calls.js";

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
    ];
    for (const role of roles) {
      expect(estimateVirtualRowSize(msg({ id: role, role }))).toBeGreaterThan(0);
    }
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

  it("does NOT extend past the cap (no full mount) — caller actively clears", () => {
    // span length 151 > cap 100 → base returned untouched.
    expect(extendRangeWithSelection([10, 11], { min: 0, max: 150 }, 100, 200)).toEqual([10, 11]);
  });

  it("retains a span exactly at the cap boundary", () => {
    const span = { min: 0, max: 99 }; // length 100 == cap
    const out = extendRangeWithSelection([], span, 100, 200);
    expect(out.length).toBe(100);
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(99);
  });
});
