/**
 * Store: overlapping cap-blocked mounts each settle against their own spec.
 * See change: add-editor-pane-file-handlers (review round 1, B1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileHandlerStore } from "../file-handler-store.js";
import { makeClaim } from "./harness.js";

const spec = (name: string) => ({
  key: `s1␟/proj␟${name}␟demo/word`,
  sessionId: "s1",
  cwd: "/proj",
  path: name,
  claim: makeClaim(),
});

describe("overlapping blocked mounts (B1)", () => {
  beforeEach(() => fileHandlerStore.reset());

  it("answers each dialog against the mount that opened it", async () => {
    const clearMode = vi.fn();
    fileHandlerStore.setPane({ sessionId: "s1", anchor: null, activeKey: null, clearMode });
    // Fill the cap with three unsaved ("unknown") instances.
    for (const n of ["a.docx", "b.docx", "c.docx"]) expect(fileHandlerStore.activate(spec(n))).toBe("live");
    // Two further mounts are blocked, each with its own dialog.
    expect(fileHandlerStore.activate(spec("d.docx"))).toBe("blocked");
    expect(fileHandlerStore.activate(spec("e.docx"))).toBe("blocked");
    const dialogs = fileHandlerStore.getState().dialogs;
    expect(dialogs).toHaveLength(2);

    // Answer the FIRST dialog: discard a.docx → d.docx mounts, e.docx stays pending.
    fileHandlerStore.answer(dialogs[0].id, { discard: spec("a.docx").key });
    await Promise.resolve();
    await Promise.resolve();
    expect(fileHandlerStore.get(spec("d.docx").key)?.evicted).toBe(false);
    expect(fileHandlerStore.get(spec("a.docx").key)).toBeUndefined();
    expect(clearMode).not.toHaveBeenCalled();

    // Cancel the SECOND dialog: only e.docx reverts to the built-in view.
    fileHandlerStore.answer(dialogs[1].id, "cancel");
    await Promise.resolve();
    await Promise.resolve();
    expect(clearMode).toHaveBeenCalledTimes(1);
    expect(clearMode).toHaveBeenCalledWith("e.docx");
    expect(fileHandlerStore.get(spec("e.docx").key)).toBeUndefined();
  });
});
