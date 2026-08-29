/**
 * Bridge forwarding of pi `entry_appended` events for generic custom entries
 * (change: render-inline-reasoning-and-custom-entries, test-plan E7).
 *
 * The bridge subscribes with the same `sessionReady`/`isActive` guards as its
 * sibling loops and forwards a `custom_entry` protocol event mapping ONLY
 * `customType`/`data`/`entryId`. A `customType: "flow-event"` entry is NOT
 * forwarded — pi-flows appends those live itself, and forwarding them would
 * double-render alongside the dedicated flow card.
 *
 * The mapping is driven through the REAL `toCustomEntryForward` module; the
 * guard shape follows the established bridge shape-contract pattern (see
 * `bridge-queue-update-forward.test.ts` — the full bridge wiring is too heavy
 * to instantiate, so the listener registration + guards are mirrored).
 */
import { describe, expect, it, vi } from "vitest";
import { toCustomEntryForward, toCustomMessageForward } from "../custom-entry-forward.js";

describe("toCustomEntryForward (mapping, real module)", () => {
  it("maps a generic custom entry to {customType, data, entryId} — nothing else", () => {
    const entry = {
      type: "custom",
      customType: "my-ext:state",
      data: { branch: "main" },
      id: "ent-1",
      parentId: "root",
      timestamp: 123,
    };
    expect(toCustomEntryForward(entry)).toEqual({
      customType: "my-ext:state",
      data: { branch: "main" },
      entryId: "ent-1",
    });
  });

  it("returns null for a flow-event entry (never forwarded, no double render)", () => {
    const entry = {
      type: "custom",
      customType: "flow-event",
      data: { seq: 0, eventType: "flow_started", data: {} },
      id: "f0",
    };
    expect(toCustomEntryForward(entry)).toBeNull();
  });

  it("returns null for non-custom entry types (messages, model_change, …)", () => {
    expect(toCustomEntryForward({ type: "message", message: { role: "user" } })).toBeNull();
    expect(toCustomEntryForward({ type: "model_change", modelId: "m" })).toBeNull();
    expect(toCustomEntryForward(null)).toBeNull();
    expect(toCustomEntryForward(undefined)).toBeNull();
  });

  it("returns null when customType is missing or empty", () => {
    expect(toCustomEntryForward({ type: "custom", data: {} })).toBeNull();
    expect(toCustomEntryForward({ type: "custom", customType: "", data: {} })).toBeNull();
  });

  it("passes data through verbatim (undefined data stays undefined)", () => {
    expect(toCustomEntryForward({ type: "custom", customType: "x", id: "1" })?.data).toBeUndefined();
  });
});

describe("toCustomMessageForward (mapping, real module)", () => {
  it("maps a custom message to the message_end payload the reducer expects", () => {
    expect(
      toCustomMessageForward({ customType: "my-ext:note", content: "hello", display: true, entryId: "c1" }),
    ).toEqual({
      message: { role: "custom", customType: "my-ext:note", content: "hello", display: true, details: undefined },
      entryId: "c1",
    });
  });

  it("returns null for display:false (LLM-context-only, exact === false)", () => {
    expect(
      toCustomMessageForward({ customType: "x", content: "hidden", display: false, entryId: "c2" }),
    ).toBeNull();
  });

  it("forwards when display is ABSENT (absent flag is not false)", () => {
    const fwd = toCustomMessageForward({ customType: "x", content: "untyped" });
    expect(fwd).not.toBeNull();
    expect(fwd?.message.display).toBeUndefined();
  });

  it("returns null for missing/empty customType", () => {
    expect(toCustomMessageForward({ customType: "", content: "x" })).toBeNull();
    expect(toCustomMessageForward(undefined as never)).toBeNull();
  });
});

describe("bridge wrapCustomPersistenceForCtx (shape contract, guards)", () => {
  // Mirrors the bridge's wrapper: fake sessionManager, wrap the two
  // persistence methods exactly like wrapCustomPersistenceForCtx does (real
  // mappers + guards), then drive them.
  function setup() {
    const sent: any[] = [];
    let ready = true;
    let active = true;
    const sessionId = "S1";
    const sm: Record<string, (...a: any[]) => any> = {
      appendCustomMessageEntry: (_c: any, _ct: any, _d: any, _de: any) => "persisted-msg-id",
      appendCustomEntry: (_ct: any, _d: any) => "persisted-entry-id",
    };
    const originalMessage = sm.appendCustomMessageEntry.bind(sm);
    sm.appendCustomMessageEntry = (customType: any, content: any, display: any, details: any) => {
      const entryId = originalMessage(customType, content, display, details);
      if (!active) return entryId;
      if (!ready) return entryId;
      const forward = toCustomMessageForward({ customType, content, display, details, entryId });
      if (!forward) return entryId;
      sent.push({
        type: "event_forward",
        sessionId,
        event: { eventType: "message_end", timestamp: Date.now(), data: { type: "message_end", message: forward.message, entryId: forward.entryId } },
      });
      return entryId;
    };
    const originalEntry = sm.appendCustomEntry.bind(sm);
    sm.appendCustomEntry = (customType: any, data: any) => {
      const entryId = originalEntry(customType, data);
      if (!active) return entryId;
      if (!ready) return entryId;
      const forward = toCustomEntryForward({ type: "custom", customType, data, id: entryId });
      if (!forward) return entryId;
      sent.push({
        type: "event_forward",
        sessionId,
        event: { eventType: "custom_entry", timestamp: Date.now(), data: { type: "custom_entry", ...forward } },
      });
      return entryId;
    };
    return {
      sm: sm as any,
      sent,
      setReady: (v: boolean) => { ready = v; },
      setActive: (v: boolean) => { active = v; },
    };
  }

  it("appendCustomMessageEntry forwards a message_end with role=custom (E7 surface 1)", () => {
    const bridge = setup();
    bridge.sm.appendCustomMessageEntry("my-ext:note", "hello", true, undefined);
    expect(bridge.sent).toHaveLength(1);
    expect(bridge.sent[0].event.eventType).toBe("message_end");
    expect(bridge.sent[0].event.data.message).toMatchObject({
      role: "custom",
      customType: "my-ext:note",
      content: "hello",
      display: true,
    });
    expect(bridge.sent[0].event.data.entryId).toBe("persisted-msg-id");
  });

  it("appendCustomMessageEntry does NOT forward display:false", () => {
    const bridge = setup();
    bridge.sm.appendCustomMessageEntry("my-ext:hidden", "llm-only", false, undefined);
    expect(bridge.sent).toHaveLength(0);
  });

  it("appendCustomEntry forwards a custom_entry event with customType/data/entryId (E7 surface 2)", () => {
    const bridge = setup();
    bridge.sm.appendCustomEntry("my-ext:state", { branch: "main" });
    expect(bridge.sent).toHaveLength(1);
    expect(bridge.sent[0].event.eventType).toBe("custom_entry");
    expect(bridge.sent[0].event.data).toMatchObject({
      type: "custom_entry",
      customType: "my-ext:state",
      data: { branch: "main" },
      entryId: "persisted-entry-id",
    });
  });

  it("appendCustomEntry does NOT forward a flow-event entry (E7 — no double render)", () => {
    const bridge = setup();
    bridge.sm.appendCustomEntry("flow-event", { seq: 0 });
    expect(bridge.sent).toHaveLength(0);
  });

  it("honors the sessionReady guard (no forward before session_start)", () => {
    const bridge = setup();
    bridge.setReady(false);
    bridge.sm.appendCustomEntry("x", 1);
    expect(bridge.sent).toHaveLength(0);
  });

  it("honors the isActive guard (no forward after takeover/shutdown)", () => {
    const bridge = setup();
    bridge.setActive(false);
    bridge.sm.appendCustomEntry("x", 1);
    expect(bridge.sent).toHaveLength(0);
  });
});
