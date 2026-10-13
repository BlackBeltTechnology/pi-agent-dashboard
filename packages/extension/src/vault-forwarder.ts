/**
 * Value-scoped masking of forwarded events: the fourth forwarding exception
 * (`catch-all-event-forwarding`), active only while at least one vault value is
 * held.
 *
 * Every `event_forward` frame is masked on a COPY (pi's event objects are never
 * mutated; unchanged subtrees keep their identity). Streams get a tail
 * hold-back so a value split across snapshots or deltas is never emitted in
 * pieces:
 *
 *  - cumulative snapshots (`tool_execution_update.partialResult`,
 *    `message_update.message` / `.assistantMessageEvent.partial`): the trailing
 *    run that could be the start of a value is withheld from this snapshot; the
 *    next snapshot (or the end event, which carries the full result) includes it;
 *  - `assistantMessageEvent.delta` strings: the held tail is prepended to the
 *    next delta of the same stream (bounded buffer, never the whole message).
 *
 * Ordering: before ANY other event of the session is forwarded, every held tail
 * is flushed (the last snapshot, fully masked, re-sent) so the wire order that
 * `event-reducer` and `provider-retry-state` rely on is preserved. Characters are
 * delayed, never dropped. With no value held the filter returns its input
 * untouched.
 *
 * See change: add-credential-vault (D5.3).
 */

import type { Masker } from "./vault-masker.js";

type Frame = {
  type?: string;
  sessionId?: string;
  event?: { eventType?: string; timestamp?: number; data?: Record<string, unknown> };
};

interface HeldStream {
  /** The last snapshot, fully masked and NOT trimmed. */
  last: Frame;
  /** True when `last` carries a delta field that must be replaced by the carry on flush. */
  hasDelta: boolean;
  carry: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Stream identity of an event, if it is part of a hold-back stream. */
function streamOf(eventType: string | undefined, data: Record<string, unknown>): { key: string; update: boolean; end: boolean } | undefined {
  if (eventType === "tool_execution_update" && typeof data.toolCallId === "string") return { key: `tool:${data.toolCallId}`, update: true, end: false };
  if (eventType === "tool_execution_end" && typeof data.toolCallId === "string") return { key: `tool:${data.toolCallId}`, update: false, end: true };
  if (eventType === "message_update") return { key: "message", update: true, end: false };
  if (eventType === "message_end") return { key: "message", update: false, end: true };
  return undefined;
}

export interface VaultForwardFilter {
  /** Returns the frames to send in order: any flushed tails first, then the (masked) frame. */
  filter(frame: unknown): unknown[];
}

export function createVaultForwardFilter(masker: Masker): VaultForwardFilter {
  const held = new Map<string, HeldStream>();

  const withData = (frame: Frame, data: Record<string, unknown>): Frame => ({ ...frame, event: { ...frame.event, data } });

  const withDelta = (data: Record<string, unknown>, delta: string): Record<string, unknown> => {
    const ame = data.assistantMessageEvent;
    return isRecord(ame) ? { ...data, assistantMessageEvent: { ...ame, delta } } : data;
  };

  const flushOne = (st: HeldStream): Frame => {
    const data = st.last.event?.data;
    if (!st.hasDelta || !data) return st.last;
    return withData(st.last, withDelta(data, masker.mask(st.carry)));
  };

  const deltaOf = (eventType: string | undefined, data: Record<string, unknown>): string | undefined => {
    if (eventType !== "message_update") return undefined;
    const ame = data.assistantMessageEvent;
    return isRecord(ame) && typeof ame.type === "string" && ame.type.endsWith("_delta") && typeof ame.delta === "string" ? ame.delta : undefined;
  };

  const forwardUpdate = (key: string, frame: Frame, data: Record<string, unknown>, out: unknown[]): void => {
    const eventType = frame.event?.eventType;
    const prev = held.get(key);
    const delta = deltaOf(eventType, data);
    // A non-delta event in the message stream (e.g. `thinking_end`) closes the delta run.
    if (prev && delta === undefined && prev.hasDelta && prev.carry !== "") {
      out.push(flushOne(prev));
      prev.carry = "";
    }
    const full = masker.maskDeep(delta === undefined ? data : withDelta(data, ""));
    let trimmed = masker.maskDeep(full, { hold: true });
    let carry = "";
    if (delta !== undefined) {
      const r = masker.maskAndHold((prev?.carry ?? "") + delta);
      carry = r.held;
      trimmed = withDelta(trimmed, r.emit);
    }
    const trimmedAny = trimmed !== full && (delta === undefined || JSON.stringify(withDelta(trimmed, "")) !== JSON.stringify(full));
    if (trimmedAny || carry !== "") held.set(key, { last: withData(frame, full), hasDelta: delta !== undefined, carry });
    else held.delete(key);
    out.push(withData(frame, trimmed));
  };

  return {
    filter(raw) {
      const frame = raw as Frame | null;
      if (frame?.type !== "event_forward" || !frame.event || !isRecord(frame.event.data) || !masker.active()) return [raw];
      const data = frame.event.data;
      const stream = streamOf(frame.event.eventType, data);
      const out: unknown[] = [];
      // Any other event: flush every held tail first (keeps wire order).
      for (const [key, st] of held) {
        if (key === stream?.key) continue;
        out.push(flushOne(st));
        held.delete(key);
      }
      if (stream?.update) {
        forwardUpdate(stream.key, frame, data, out);
        return out;
      }
      // An end event carries the full result: it supersedes whatever was held.
      if (stream?.end) held.delete(stream.key);
      const masked = masker.maskDeep(data);
      out.push(masked === data ? frame : withData(frame, masked));
      return out;
    },
  };
}
