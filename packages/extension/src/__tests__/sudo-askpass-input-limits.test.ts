/**
 * G5: the bridge never registers, caches or delivers an empty or over-long answer
 * (defence in depth: the dialog and the relay reject them first); the prompt stays
 * pending. See change: add-sudo-credential-prompt (test-plan #S81).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, pollUntil, settle, type Harness } from "./sudo-askpass-harness.js";

let h: Harness;

beforeEach(async () => {
  h = createHarness();
  await h.install();
  h.startTool("A", "sudo true");
});
afterEach(() => h.dispose());

describe("answer length limits (#S81)", () => {
  it.each([
    ["empty", ""],
    ["1 025 chars", "x".repeat(1025)],
    ["non-string", 12345],
  ])("drops a %s answer: not registered, cached or delivered; the prompt stays pending", async (_n, pw) => {
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    const { callId } = h.requests()[0];
    h.respond(callId, pw);
    await settle();
    expect(h.registered).toEqual([]);
    expect(h.ctl.debug.cacheBuffer()).toBeUndefined();
    expect(h.ctl.debug.pendingCallId()).toBe(callId);
    // still answerable afterwards, delivered once
    h.respond(callId, "fine");
    expect(await reply).toEqual({ ok: true, password: "fine" });
    expect(h.registered).toEqual(["fine"]);
  });

  it.each([1, 1024])("accepts a %i-char answer: registered, delivered and cached", async (len) => {
    const pw = "y".repeat(len);
    const reply = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    h.respond(h.requests()[0].callId, pw);
    expect(await reply).toEqual({ ok: true, password: pw });
    expect(h.registered).toEqual([pw]);
    expect(h.ctl.debug.cacheBuffer()?.toString("utf8")).toBe(pw);
  });
});
