/**
 * Run result capture end-to-end at the result.md level: drive the real
 * `extractAssistantText` over a realistic forwarded-event sequence exactly as
 * the index.ts onEvent buffer does, then flush through the real run-store and
 * assert what lands in result.md (and auto-archive on empty).
 * See change: fix-automation-result-capture.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAssistantText } from "../server/index.js";
import { startRun, finishRun } from "../server/run-store.js";

let base: string;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "auto-capture-"));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** Mirror of the index.ts onEvent buffer/flush loop, kept minimal. */
function captureAndFinish(
  runId: string,
  promptText: string,
  events: Array<{ eventType?: string; data?: Record<string, unknown> }>,
) {
  startRun(base, "pong", { runId });
  const buf: string[] = [];
  for (const ev of events) {
    const text = extractAssistantText(ev, promptText);
    if (text) buf.push(text);
  }
  const result = buf.join("\n\n").trim();
  return finishRun(base, runId, { status: "done", result });
}

const PROMPT = "Reply with exactly the single word PONG and nothing else. Do not use any tools.";

// Live-verified sequence (task 1.1): prompt delivery emits an `input` event +
// a user message_start/message_end; the assistant reply finalizes on `turn_end`
// (no assistant message_end); the run flushes on `agent_end`.
const inputEvent = { eventType: "input", data: { text: PROMPT, source: "extension" } };
const promptEcho = {
  eventType: "message_end",
  data: { message: { role: "user", content: [{ type: "text", text: PROMPT }] } },
};
const assistantReply = {
  eventType: "turn_end",
  data: {
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "PONG" }],
    },
  },
};
const agentEnd = { eventType: "agent_end", data: {} };

it("result.md == assistant reply and excludes the injected prompt", () => {
  const rec = captureAndFinish("2026-06-23-pong", PROMPT, [inputEvent, promptEcho, assistantReply, agentEnd]);
  expect(rec?.archived).toBeUndefined();
  const md = fs.readFileSync(path.join(base, ".pi", "automation", "runs", "2026-06-23-pong", "result.md"), "utf-8");
  expect(md.trim()).toBe("PONG");
  expect(md).not.toContain("Reply with exactly");
});

it("no assistant output -> empty result.md -> auto-archived", () => {
  const rec = captureAndFinish("2026-06-23-pong", PROMPT, [inputEvent, promptEcho, agentEnd]);
  expect(rec?.archived).toBe(true);
  const md = fs.readFileSync(
    path.join(base, ".pi", "automation", "runs", "2026-06-23-pong", "result.md"),
    "utf-8",
  );
  expect(md).toBe("");
});
