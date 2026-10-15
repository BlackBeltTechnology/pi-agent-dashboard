/**
 * Question snapshot: bounded, absent reasons, immutable, redacted
 * (test-plan #E14, #E15). See change: add-pending-question-stack (D2).
 */
import { REDACTION_VERSION } from "@blackbelt-technology/pi-dashboard-shared/redaction.js";
import { describe, expect, it } from "vitest";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import { buildQuestionSnapshot, redactDeep, SNAPSHOT_ASSISTANT_TEXT_MAX } from "../question-snapshot.js";

// String/data caps raised: the production default truncates a field at 4000 chars.
const store = () => createMemoryEventStore(() => false, 32, 20000, 100_000, 1_000_000);

function assistantEnd(es: ReturnType<typeof store>, sid: string, text: string | Array<Record<string, unknown>>) {
  es.insertEvent(sid, {
    eventType: "message_end",
    timestamp: Date.now(),
    data: { message: { role: "assistant", content: typeof text === "string" ? text : text } },
  });
}
function tool(es: ReturnType<typeof store>, sid: string, name: string, args: unknown, extra: Record<string, unknown> = {}) {
  es.insertEvent(sid, {
    eventType: "tool_execution_start",
    timestamp: Date.now(),
    data: { toolCallId: `${name}-${Math.random()}`, toolName: name, args, ...extra },
  });
}

describe("buildQuestionSnapshot — bounds (test-plan #E14)", () => {
  it("keeps the LAST 8192 chars of a 9000-char assistant text", () => {
    const es = store();
    const text = `${"A".repeat(808)}${"B".repeat(8192)}`;
    assistantEnd(es, "s1", text);
    const snap = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    expect(snap.assistantText).toBe("B".repeat(8192));
    expect(snap.assistantAbsentReason).toBeUndefined();
  });

  it("joins text parts of an assistant message and ignores tool-call parts", () => {
    const es = store();
    assistantEnd(es, "s1", [
      { type: "text", text: "Hello " },
      { type: "toolCall", id: "t", name: "bash", arguments: {} },
      { type: "text", text: "world" },
    ]);
    expect(buildQuestionSnapshot({ eventStore: es, sessionId: "s1" }).assistantText).toBe("Hello world");
  });

  it("uses the last assistant message that carries text", () => {
    const es = store();
    assistantEnd(es, "s1", "first");
    assistantEnd(es, "s1", [{ type: "toolCall", id: "t", name: "bash", arguments: {} }]);
    expect(buildQuestionSnapshot({ eventStore: es, sessionId: "s1" }).assistantText).toBe("first");
  });

  it("keeps the 5 most recent tool calls (oldest→newest), one line each", () => {
    const es = store();
    for (let i = 1; i <= 7; i++) tool(es, "s1", `tool${i}`, { command: `echo ${i}\nsecond line` });
    const { toolCalls } = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    expect(toolCalls.map((t) => t.name)).toEqual(["tool3", "tool4", "tool5", "tool6", "tool7"]);
    expect(toolCalls[4].summary).toBe("echo 7 second line");
    for (const t of toolCalls) expect(t.summary).not.toMatch(/\n/);
  });

  it("skips the ask_user call itself and nested tool calls", () => {
    const es = store();
    tool(es, "s1", "read", { path: "/a" });
    tool(es, "s1", "inner", { path: "/n" }, { parentToolCallId: "p" });
    tool(es, "s1", "ask_user", { question: "q" });
    const { toolCalls } = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    expect(toolCalls.map((t) => t.name)).toEqual(["read"]);
  });

  it("caps a tool summary at 120 chars", () => {
    const es = store();
    tool(es, "s1", "bash", { command: "x".repeat(500) });
    expect(buildQuestionSnapshot({ eventStore: es, sessionId: "s1" }).toolCalls[0].summary.length).toBeLessThanOrEqual(120);
  });
});

describe("buildQuestionSnapshot — absent reasons (test-plan #E14)", () => {
  it("session with no assistant text → reason none", () => {
    const es = store();
    tool(es, "s1", "read", { path: "/a" });
    const snap = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    expect(snap.assistantText).toBeUndefined();
    expect(snap.assistantAbsentReason).toBe("none");
  });

  it("session with no events at all → reason none", () => {
    const snap = buildQuestionSnapshot({ eventStore: store(), sessionId: "nope" });
    expect(snap).toMatchObject({ assistantAbsentReason: "none", toolCalls: [] });
  });

  it("head of the buffer trimmed (first stored seq > 1) and no text left → reason evicted", () => {
    // Tiny cap: essential chat events are trimmed oldest-first once they alone
    // exceed it, so the early assistant message is dropped.
    const es = createMemoryEventStore(() => false, 10, 4);
    assistantEnd(es, "s1", "old text");
    for (let i = 0; i < 5; i++) es.insertEvent("s1", { eventType: "message_start", timestamp: 1, data: { message: { role: "user", content: "hi" } } });
    const snap = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    expect(snap.assistantText).toBeUndefined();
    expect(snap.assistantAbsentReason).toBe("evicted");
  });
});

describe("buildQuestionSnapshot — immutability + metadata", () => {
  it("is a value: later events do not change it", () => {
    const es = store();
    assistantEnd(es, "s1", "before");
    const snap = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    const frozen = JSON.stringify(snap);
    assistantEnd(es, "s1", "after");
    tool(es, "s1", "bash", { command: "ls" });
    tool(es, "s1", "bash", { command: "pwd" });
    expect(JSON.stringify(snap)).toBe(frozen);
  });

  it("copies metadata.workflowRun when present, omits it otherwise", () => {
    const es = store();
    const withRun = buildQuestionSnapshot({
      eventStore: es,
      sessionId: "s1",
      metadata: { workflowRun: { name: "ship", step: 3 } },
    });
    expect(withRun.workflowRun).toEqual({ name: "ship", step: 3 });
    expect("workflowRun" in buildQuestionSnapshot({ eventStore: es, sessionId: "s1", metadata: {} })).toBe(false);
  });

  it("replaces an oversized workflowRun (post-redaction) with a small truncated placeholder", () => {
    const big = { name: "ship", steps: Array.from({ length: 2000 }, (_, i) => ({ i, note: "x".repeat(50) })), password: "hunter2" };
    const snap = buildQuestionSnapshot({ eventStore: store(), sessionId: "s1", metadata: { workflowRun: big } });
    const json = JSON.stringify(snap.workflowRun);
    expect(json.length).toBeLessThanOrEqual(8192);
    expect(snap.workflowRun).toMatchObject({ truncated: true });
    expect(json).not.toContain("hunter2");
  });

  it("keeps a workflowRun under the cap verbatim", () => {
    const snap = buildQuestionSnapshot({ eventStore: store(), sessionId: "s1", metadata: { workflowRun: { name: "ship", step: 3 } } });
    expect(snap.workflowRun).toEqual({ name: "ship", step: 3 });
  });

  it("stamps the redaction version", () => {
    expect(buildQuestionSnapshot({ eventStore: store(), sessionId: "s1" }).redactionVersion).toBe(REDACTION_VERSION);
    expect(REDACTION_VERSION).toBe(1);
  });
});

describe("buildQuestionSnapshot — redaction (test-plan #E15)", () => {
  const SAMPLES: Record<string, string> = {
    bearer: "Authorization: Bearer abc123def456ghi789",
    sk: "token sk-abcdefghijklmnop1234",
    apiKey: "api_key=supersecretvalue",
    password: "password: hunter2hunter2",
    pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END RSA PRIVATE KEY-----",
    aws: "AKIAABCDEFGHIJKLMNOP",
  };
  const LEAKS = ["abc123def456ghi789", "sk-abcdefghijklmnop1234", "supersecretvalue", "hunter2hunter2", "MIIEvQIBADANBg", "AKIAABCDEFGHIJKLMNOP"];

  it("redacts every pattern in assistant text, tool summaries and workflowRun", () => {
    const es = store();
    assistantEnd(es, "s1", Object.values(SAMPLES).join("\n"));
    tool(es, "s1", "bash", { command: `curl -H '${SAMPLES.bearer}' ${SAMPLES.apiKey}` });
    const snap = buildQuestionSnapshot({
      eventStore: es,
      sessionId: "s1",
      metadata: { workflowRun: { note: SAMPLES.aws, nested: [{ pw: SAMPLES.password }] } },
    });
    const blob = JSON.stringify(snap);
    for (const leak of LEAKS) expect(blob).not.toContain(leak);
    expect(snap.assistantText).toContain("[REDACTED]");
  });

  it("a secret straddling the 8192 cut is redacted before slicing", () => {
    const es = store();
    assistantEnd(es, "s1", `xxxxx password: hunter2hunter2 ${"y".repeat(8180)}`);
    const text = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" }).assistantText!;
    expect(text).not.toContain("hunter2");
    expect(text.length).toBeLessThanOrEqual(8192);
  });

  it("redactDeep walks strings in nested objects/arrays and leaves non-strings", () => {
    expect(redactDeep({ a: ["password=abc", 3, null, { b: "AKIAABCDEFGHIJKLMNOP" }], c: true })).toEqual({
      a: ["[REDACTED]", 3, null, { b: "[REDACTED]" }],
      c: true,
    });
  });
});

describe("redactDeep — keys and depth (security audit)", () => {
  it("redacts the value of a sensitive object KEY regardless of the value", () => {
    const out = redactDeep({
      password: "plain",
      apiKey: "plain2",
      "client-secret": "plain3",
      Authorization: "plain4",
      nested: { accessToken: "plain5", cookie: "a=b", private_key: "plain6", keep: "visible" },
      list: [{ passwd: "plain7" }],
    });
    const blob = JSON.stringify(out);
    for (const leak of ["plain", "plain2", "plain3", "plain4", "plain5", "a=b", "plain6", "plain7"]) expect(blob).not.toContain(`"${leak}"`);
    expect((out.nested as { keep: string }).keep).toBe("visible");
  });

  it("non-string values under a sensitive key are replaced too", () => {
    expect(redactDeep({ token: { a: 1 }, secret: 42 })).toEqual({ token: "[REDACTED]", secret: "[REDACTED]" });
  });

  it("bounds recursion depth against hostile nesting", () => {
    let deep: unknown = "sk-abcdefghijklmnop1234";
    for (let i = 0; i < 10_000; i++) deep = { a: deep };
    const out = JSON.stringify(redactDeep(deep));
    expect(out).not.toContain("sk-abcdefghijklmnop1234");
    expect(out.length).toBeLessThan(500);
  });

  it("caps assistant text / tool summary input before redacting (linear on hostile input)", () => {
    const es = store();
    const hostile = "-----BEGIN PRIVATE KEY-----\n".repeat(200_000);
    assistantEnd(es, "s1", hostile);
    tool(es, "s1", "bash", { command: hostile });
    const t0 = performance.now();
    const snap = buildQuestionSnapshot({ eventStore: es, sessionId: "s1" });
    expect(performance.now() - t0).toBeLessThan(500);
    expect(snap.assistantText!.length).toBeLessThanOrEqual(SNAPSHOT_ASSISTANT_TEXT_MAX);
  });
});
