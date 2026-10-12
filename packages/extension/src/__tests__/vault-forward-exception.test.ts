/**
 * Value-scoped forwarding exception: no-op without held values, masking on a
 * copy, and tail hold-back that preserves wire order.
 * See change: add-credential-vault (test-plan E28, E29, E30).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { mapEventToProtocol } from "../event-forwarder.js";
import { createVaultForwardFilter } from "../vault-forwarder.js";
import { createMasker } from "../vault-masker.js";

const V = "abcdefghijklmnopqrst";
const TOKEN = "[REDACTED:K_KEY]";
let entries: Array<{ name: string; value: string }>;
let version: number;
const masker = createMasker(() => ({ version, entries }));
const mk = () => createVaultForwardFilter(masker);
const hold = () => { entries.push({ name: "K_KEY", value: V }); version++; };

const frame = (piEvent: Record<string, unknown>) => mapEventToProtocol("s1", piEvent);
const update = (id: string, text: string) => frame({ type: "tool_execution_update", toolCallId: id, partialResult: { content: [{ type: "text", text }] } });
const textOf = (f: unknown) => (f as { event: { data: { partialResult: { content: Array<{ text: string }> } } } }).event.data.partialResult.content[0].text;
const typesOf = (frames: unknown[]) => frames.map((f) => (f as { event: { eventType: string } }).event.eventType);

beforeEach(() => { entries = []; version = 0; });

describe("no value held (E28)", () => {
  it("returns every frame untouched and delays nothing", () => {
    const f = mk();
    const events = [
      update("t1", `text with ${V} inside`),
      frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: V }] }, assistantMessageEvent: { type: "text_delta", delta: V } }),
      frame({ type: "my:bus-channel", payload: { a: V } }),
    ];
    for (const e of events) {
      const before = structuredClone(e);
      const out = f.filter(e);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(e);
      expect(out[0]).toEqual(before);
    }
  });
});

describe("masking on a copy (E29)", () => {
  it("masks the forwarded copy and never mutates the pi event object", () => {
    hold();
    const piEvent = { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: `x ${V} y` }] }, isError: false, details: { nested: [V] } };
    const snapshot = structuredClone(piEvent);
    const out = mk().filter(frame(piEvent));
    expect(JSON.stringify(out)).not.toContain(V);
    expect(JSON.stringify(out)).toContain(TOKEN);
    expect(piEvent).toEqual(snapshot);
  });

  it("masks event-bus payloads", () => {
    hold();
    const out = mk().filter({ type: "event_forward", sessionId: "s1", event: { eventType: "plugin:chan", timestamp: 1, data: { secret: V } } });
    expect(JSON.stringify(out)).not.toContain(V);
  });

  it("leaves non-event frames alone", () => {
    hold();
    const hb = { type: "session_heartbeat", sessionId: "s1", note: V };
    expect(mk().filter(hb)).toEqual([hb]);
  });
});

describe("hold-back and ordering", () => {
  it("withholds a trailing partial value, then delivers the whole masked text with the end event (E24 on the wire)", () => {
    hold();
    const f = mk();
    const full = `out ${V} done`;
    const sent: unknown[] = [];
    for (const upTo of [5, 5 + 10, 5 + 19]) sent.push(...f.filter(update("t1", full.slice(0, upTo))));
    for (const s of sent) {
      for (let k = 1; k < V.length; k++) expect(textOf(s).endsWith(V.slice(0, k))).toBe(false);
    }
    const end = f.filter(frame({ type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: full }] }, isError: false }));
    expect(end).toHaveLength(1); // the end supersedes the held tail: nothing extra to flush
    expect(JSON.stringify(end)).toContain(`out ${TOKEN} done`);
  });

  it("E30: held characters are flushed (masked) BEFORE the next event, and nothing is reordered", () => {
    hold();
    const f = mk();
    const msgUpdate = (text: string, delta: string) => frame({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text }] },
      assistantMessageEvent: { type: "text_delta", delta },
    });
    const sent: unknown[] = [];
    sent.push(...f.filter(msgUpdate("hello ", "hello ")));
    sent.push(...f.filter(msgUpdate(`hello ${V.slice(0, 7)}`, V.slice(0, 7))));
    sent.push(...f.filter(frame({ type: "tool_execution_start", toolCallId: "t9", toolName: "bash", args: {} })));
    expect(typesOf(sent)).toEqual(["message_update", "message_update", "message_update", "tool_execution_start"]);
    const flushed = sent[2] as { event: { data: { message: { content: Array<{ text: string }> }; assistantMessageEvent: { delta: string } } } };
    // the held 7 characters appear (they are a prefix, not a complete value, so unmasked) before tool_execution_start
    expect(flushed.event.data.message.content[0].text).toBe(`hello ${V.slice(0, 7)}`);
    expect(flushed.event.data.assistantMessageEvent.delta).toBe(V.slice(0, 7));
    // and the second update withheld them
    const second = sent[1] as typeof flushed;
    expect(second.event.data.message.content[0].text).toBe("hello ");
    expect(second.event.data.assistantMessageEvent.delta).toBe("");
  });

  it("delta runs re-attach the carry, so a value split across deltas is masked and no characters are lost", () => {
    hold();
    const f = mk();
    const mkUpd = (cum: string, delta: string) => frame({
      type: "message_update", message: { role: "assistant", content: [{ type: "text", text: cum }] },
      assistantMessageEvent: { type: "text_delta", delta },
    });
    const deltas: string[] = [];
    let cum = "";
    for (const d of [`a ${V.slice(0, 1)}`, V.slice(1, 10), V.slice(10, 19), `${V.slice(19)} z`]) {
      cum += d;
      for (const o of f.filter(mkUpd(cum, d))) deltas.push((o as { event: { data: { assistantMessageEvent: { delta: string } } } }).event.data.assistantMessageEvent.delta);
    }
    const joined = deltas.join("");
    expect(joined).not.toContain(V);
    expect(joined).toBe(`a ${TOKEN} z`);
  });

  it("an end event of another tool flushes this tool's held tail first", () => {
    hold();
    const f = mk();
    f.filter(update("t1", `x ${V.slice(0, 5)}`));
    const out = f.filter(frame({ type: "tool_execution_end", toolCallId: "t2", result: { content: [] }, isError: false }));
    expect(typesOf(out)).toEqual(["tool_execution_update", "tool_execution_end"]);
    expect(textOf(out[0])).toBe(`x ${V.slice(0, 5)}`);
  });
});
