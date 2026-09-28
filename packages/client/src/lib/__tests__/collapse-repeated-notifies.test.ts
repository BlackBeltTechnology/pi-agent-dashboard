/**
 * Pure render-time collapse of adjacent identical notify rows.
 * Covers test-plan #E11 (run detection) and #E12 (non-mutating, stable key).
 * See change: collapse-and-order-notify-rows.
 */
import { describe, expect, it } from "vitest";
import { collapseRepeatedNotifies, notifyRenderedText } from "../chat/collapse-repeated-notifies.js";
import type { ChatMessage } from "../chat/event-reducer.js";

let seq = 0;
function notify(params: Record<string, unknown>, timestamp = ++seq, id = `n${seq}`): ChatMessage {
  return {
    id,
    role: "interactiveUi",
    content: "notify",
    timestamp,
    args: { requestId: id, method: "notify", params, status: "pending" } as any,
  };
}
const msg = (id: string): ChatMessage => ({ id, role: "assistant", content: "hi", timestamp: ++seq });

/** Row summary: text (or id for non-notify) + repeat count when annotated. */
function summarize(rows: ChatMessage[]): string[] {
  return rows.map((r) => {
    if (r.role !== "interactiveUi") return r.id;
    const p = (r.args as any).params;
    const text = notifyRenderedText(p) || "<empty>";
    return p.repeat ? `${text}(${p.level ?? "info"})×${p.repeat.count}` : `${text}(${p.level ?? "info"})`;
  });
}

describe("collapseRepeatedNotifies", () => {
  it("#E11 collapses only adjacent rows with an equal level + non-empty rendered text", () => {
    const rows = [
      notify({ message: "A", level: "warning" }),
      notify({ message: "A", level: "warning" }),
      notify({ message: "A", level: "warning" }),
      msg("m1"),
      notify({ message: "A", level: "warning" }),
      notify({ message: "A", level: "error" }),
      notify({ message: "B" }),
      notify({ message: "B" }),
      notify({ title: "T1" }),
      notify({ title: "T2" }),
      notify({ message: "" }),
      notify({ message: "" }),
    ];
    expect(summarize(collapseRepeatedNotifies(rows))).toEqual([
      "A(warning)×3",
      "m1",
      "A(warning)",
      "A(error)",
      "B(info)×2",
      "T1(info)",
      "T2(info)",
      "<empty>(info)",
      "<empty>(info)",
    ]);
  });

  it("returns the input reference when nothing collapses", () => {
    const rows = [notify({ message: "A" }), msg("m"), notify({ message: "A" })];
    expect(collapseRepeatedNotifies(rows)).toBe(rows);
  });

  it("#E12 never mutates stored rows and keeps the first member's id as a run grows", () => {
    const a = notify({ message: "X", level: "warning" }, 10, "a");
    const b = notify({ message: "X", level: "warning" }, 20, "b");
    const c = notify({ message: "X", level: "warning" }, 30, "c");
    const snapshot = structuredClone([a, b, c]);

    const first = collapseRepeatedNotifies([a, b, c]);
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe("a");
    expect((first[0].args as any).params.repeat).toEqual({ count: 3, firstTs: 10, lastTs: 30 });

    const d = notify({ message: "X", level: "warning" }, 40, "d");
    const second = collapseRepeatedNotifies([a, b, c, d]);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe("a");
    expect((second[0].args as any).params.repeat).toEqual({ count: 4, firstTs: 10, lastTs: 40 });

    expect([a, b, c]).toEqual(snapshot);
    expect("repeat" in (a.args as any).params).toBe(false);
    expect(second[0]).not.toBe(a);
  });
});
