/**
 * Unit test for the faux fixture's `resolveActiveStep` sentinel router.
 *
 * Pure function — no pi subprocess, no provider registration. Asserts the
 * sentinel parse and the step-index counting (assistant turns since the
 * sentinel user message), including the `ask-select-roundtrip` 2-step case and
 * the no-sentinel `FAUX_SCRIPT` fallback.
 *
 * See change: add-e2e-faux-model-roundtrip.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveActiveStep } from "../../../../qa/fixtures/faux-provider.ext.js";
import type { FauxContext } from "../../../../qa/fixtures/faux-scenarios.js";

function userMsg(text: string): FauxContext["messages"][number] {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistantMsg(text = "ok"): FauxContext["messages"][number] {
  return { role: "assistant", content: [{ type: "text", text }] };
}
const ctx = (messages: FauxContext["messages"]): FauxContext => ({ messages });

describe("resolveActiveStep", () => {
  const original = process.env.FAUX_SCRIPT;
  afterEach(() => {
    if (original === undefined) delete process.env.FAUX_SCRIPT;
    else process.env.FAUX_SCRIPT = original;
  });

  it("parses the sentinel id from the latest user message", () => {
    const { id, stepIndex } = resolveActiveStep(ctx([userMsg("[[faux:tool-read]] go")]));
    expect(id).toBe("tool-read");
    expect(stepIndex).toBe(0);
  });

  it("counts assistant turns since the sentinel message (multi-step)", () => {
    // ask-select-roundtrip: tool-call turn, then post-answer follow-up. After
    // the first assistant turn the next call must select step 1.
    const messages = ctx([
      userMsg("[[faux:ask-select-roundtrip]] go"),
      assistantMsg("(ask_user tool call)"),
      { role: "toolResult", content: [{ type: "text", text: "a" }] },
    ]);
    const { id, stepIndex } = resolveActiveStep(messages);
    expect(id).toBe("ask-select-roundtrip");
    expect(stepIndex).toBe(1);
  });

  it("picks the last matching user message when several are present", () => {
    const { id } = resolveActiveStep(
      ctx([userMsg("[[faux:plain-text]] a"), assistantMsg(), userMsg("[[faux:tool-read]] b")]),
    );
    expect(id).toBe("tool-read");
  });

  it("falls back to FAUX_SCRIPT, anchored at conversation start, when no sentinel", () => {
    process.env.FAUX_SCRIPT = "plain-text";
    const first = resolveActiveStep(ctx([userMsg("hello")]));
    expect(first.id).toBe("plain-text");
    expect(first.stepIndex).toBe(0);

    const second = resolveActiveStep(ctx([userMsg("hi"), assistantMsg(), userMsg("again")]));
    expect(second.id).toBe("plain-text");
    expect(second.stepIndex).toBe(1);
  });

  it("returns undefined id when no sentinel and FAUX_SCRIPT unset", () => {
    delete process.env.FAUX_SCRIPT;
    expect(resolveActiveStep(ctx([userMsg("hello")])).id).toBeUndefined();
  });
});
