import { describe, expect, it } from "vitest";

import {
  batchToSequence,
  composeBatchAnswer,
  multiselectToSequence,
  toPromptControl,
} from "../prompts.js";

describe("toPromptControl", () => {
  it("maps select with options", () => {
    const c = toPromptControl({
      requestId: "r1",
      prompt: { type: "select", title: "Pick one", options: ["a", "b"] },
    });
    expect(c).toMatchObject({
      requestId: "r1",
      kind: "select",
      title: "Pick one",
      options: ["a", "b"],
    });
  });

  it("maps confirm, input and editor", () => {
    expect(
      toPromptControl({ requestId: "r2", prompt: { type: "confirm", title: "Sure?", message: "m" } }),
    ).toMatchObject({ kind: "confirm", title: "Sure?", message: "m" });

    expect(
      toPromptControl({
        requestId: "r3",
        prompt: { type: "input", title: "Name", placeholder: "your name" },
      }),
    ).toMatchObject({ kind: "input", placeholder: "your name" });

    expect(
      toPromptControl({ requestId: "r4", prompt: { type: "editor", title: "Edit", prefill: "old" } }),
    ).toMatchObject({ kind: "editor", prefill: "old" });
  });

  it("maps notify", () => {
    expect(
      toPromptControl({ requestId: "r5", prompt: { type: "notify", title: "Heads up" } }),
    ).toMatchObject({ kind: "notify", title: "Heads up" });
  });

  it("accepts the flat shape too", () => {
    expect(toPromptControl({ requestId: "r6", type: "confirm", title: "Flat" })).toMatchObject({
      requestId: "r6",
      kind: "confirm",
      title: "Flat",
    });
  });

  it("unknown type -> unsupported, never throws", () => {
    expect(toPromptControl({ requestId: "r7", prompt: { type: "hologram", title: "?" } })).toEqual({
      requestId: "r7",
      kind: "unsupported",
      title: "?",
    });
    expect(toPromptControl({ requestId: "r8", prompt: {} }).kind).toBe("unsupported");
  });

  it("non-object input -> unsupported, never throws", () => {
    for (const bad of [undefined, null, "nope", 42, [], true]) {
      expect(() => toPromptControl(bad)).not.toThrow();
      expect(toPromptControl(bad)).toEqual({ requestId: "", kind: "unsupported", title: "" });
    }
  });

  it("ignores the React component/props and renders from type + options + metadata", () => {
    const c = toPromptControl({
      requestId: "r9",
      prompt: {
        type: "select",
        title: "Pick",
        options: ["x", "y"],
        component: function Renderer() {
          throw new Error("must never be touched");
        },
        props: { onSubmit: () => undefined },
        metadata: { placeholder: "hint" },
      },
    });
    expect(c.kind).toBe("select");
    expect(c.options).toEqual(["x", "y"]);
    expect(c.placeholder).toBe("hint");
    expect(c).not.toHaveProperty("component");
    expect(c).not.toHaveProperty("props");
  });

  it("drops non-string option entries", () => {
    const c = toPromptControl({
      requestId: "r10",
      prompt: { type: "select", title: "t", options: ["a", 3, null, "b"] },
    });
    expect(c.options).toEqual(["a", "b"]);
  });

  it("F3: multiselect carries an index-aligned sub-prompt sequence", () => {
    const c = toPromptControl({
      requestId: "rm",
      prompt: { type: "multiselect", title: "Pick many", options: ["a", "b", "c"] },
    });
    expect(c.kind).toBe("multiselect");
    expect(c.subPrompts).toHaveLength(4); // 3 toggles + trailing confirm
    expect(c.subPrompts?.slice(0, 3).map((p) => p.message)).toEqual(["a", "b", "c"]);
  });

  it("F4: batch carries the flattened questions in order", () => {
    const c = toPromptControl({
      requestId: "rb",
      prompt: {
        type: "batch",
        title: "Survey",
        metadata: {
          questions: [{ title: "Q1" }, { title: "Q2", options: ["y", "n"] }, { title: "Q3" }],
        },
      },
    });
    expect(c.kind).toBe("batch");
    expect(c.subPrompts?.map((p) => p.title)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("batch with malformed metadata stays total", () => {
    const c = toPromptControl({
      requestId: "rb2",
      prompt: { type: "batch", title: "S", metadata: { questions: "nope" } },
    });
    expect(c.kind).toBe("batch");
    expect(c.subPrompts).toEqual([]);
  });
});

describe("multiselectToSequence (F3)", () => {
  it("emits one toggle per option, index-aligned, then a confirm", () => {
    const seq = multiselectToSequence("rid", "Pick many", ["alpha", "beta"]);
    expect(seq).toHaveLength(3);
    expect(seq[0]).toMatchObject({ requestId: "rid:0", kind: "confirm", message: "alpha" });
    expect(seq[1]).toMatchObject({ requestId: "rid:1", kind: "confirm", message: "beta" });
    expect(seq[2].requestId).toBe("rid:confirm");
    expect(seq[2].kind).toBe("confirm");
  });

  it("no options -> just the confirm", () => {
    expect(multiselectToSequence("rid", "t", [])).toHaveLength(1);
  });
});

describe("batchToSequence / composeBatchAnswer (F4)", () => {
  it("preserves order and picks select vs input by options presence", () => {
    const seq = batchToSequence("rid", "Survey", [
      { title: "Name", placeholder: "who" },
      { title: "Colour", options: ["red", "blue"] },
      { title: "Notes" },
    ]);
    expect(seq.map((p) => p.title)).toEqual(["Name", "Colour", "Notes"]);
    expect(seq.map((p) => p.requestId)).toEqual(["rid:0", "rid:1", "rid:2"]);
    expect(seq.map((p) => p.kind)).toEqual(["input", "select", "input"]);
    expect(seq[0].placeholder).toBe("who");
    expect(seq[1].options).toEqual(["red", "blue"]);
  });

  it("empty questions -> empty sequence", () => {
    expect(batchToSequence("rid", "t", [])).toEqual([]);
  });

  it("answers stay index-aligned", () => {
    const answers = ["Ada", "blue", "none"];
    expect(composeBatchAnswer(0, answers)).toEqual({ index: 0, value: "Ada" });
    expect(composeBatchAnswer(1, answers)).toEqual({ index: 1, value: "blue" });
    expect(composeBatchAnswer(2, answers)).toEqual({ index: 2, value: "none" });
  });

  it("out-of-range index yields an empty value, never throws", () => {
    expect(composeBatchAnswer(9, ["a"])).toEqual({ index: 9, value: "" });
  });
});
