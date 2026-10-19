/**
 * Non-opted prompts stay byte-identical: an ACP permission frame never carries
 * `allowOther`, and a custom answer through the REST road is rejected (400).
 * test-plan #X3. See change: add-ask-user-inline-other.
 */
import { validateQuestionAnswer } from "@blackbelt-technology/pi-dashboard-shared/prompt-answer.js";
import { describe, expect, it, vi } from "vitest";
import { createPermissionBridge } from "../permission-bridge.js";

describe("ACP permission prompt (X3)", () => {
  it("never carries allowOther and rejects a custom REST answer", () => {
    const send = vi.fn();
    const bridge = createPermissionBridge("s1", send);
    const pending = bridge.request({ options: [{ optionId: "a", name: "Allow" }, { optionId: "r", name: "Reject" }] });
    expect(pending).toBeInstanceOf(Promise);
    const frame = send.mock.calls[0][0] as { prompt: { metadata?: Record<string, unknown>; options: string[]; type: string } };
    expect(frame.prompt.metadata).not.toHaveProperty("allowOther");
    const verdict = validateQuestionAnswer(
      { type: frame.prompt.type, options: frame.prompt.options, ...(frame.prompt.metadata?.allowOther === true ? { allowOther: true } : {}) },
      "something else",
    );
    expect(verdict.ok).toBe(false);
  });
});
