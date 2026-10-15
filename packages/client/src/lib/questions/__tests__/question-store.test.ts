/** Question stack store (test-plan #E16/#E17 data path). See change: add-pending-question-stack. */
import { describe, expect, it, vi } from "vitest";
import { row } from "../../../components/questions/__tests__/question-fixtures.js";
import { QuestionStackStore } from "../question-store.js";

describe("QuestionStackStore", () => {
  it("starts empty + not loaded; the first frame (even empty) marks it loaded", () => {
    const s = new QuestionStackStore();
    expect(s.getSnapshot()).toMatchObject({ rows: [], loaded: false });
    s.set([]);
    expect(s.getSnapshot().loaded).toBe(true);
  });

  it("keeps rows newest-first and replaces (does not merge) on every frame", () => {
    const s = new QuestionStackStore();
    s.set([row({ id: "old", askedAt: 1 }), row({ id: "new", askedAt: 3 }), row({ id: "mid", askedAt: 2 })]);
    expect(s.getSnapshot().rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    s.set([row({ id: "mid", askedAt: 2 })]);
    expect(s.getSnapshot().rows.map((r) => r.id)).toEqual(["mid"]);
  });

  it("notifies only on a real change", () => {
    const s = new QuestionStackStore();
    const l = vi.fn();
    s.subscribe(l);
    s.set([row({ id: "a" })]);
    s.set([row({ id: "a" })]);
    expect(l).toHaveBeenCalledTimes(1);
    s.set([row({ id: "a", briefStatus: "pending" })]);
    expect(l).toHaveBeenCalledTimes(2);
  });
});
