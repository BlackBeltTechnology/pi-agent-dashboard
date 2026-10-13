/**
 * E10 — the `installAnchorProbe` WebSocket.send wrapper still forwards every
 * payload kind unchanged after the TS 7 `BufferSource` fix (it copies the two
 * binary arms). The init script is captured through a fake Page and executed
 * against stub globals; no browser. Pattern: lifecycle.test.ts (pure helper).
 * See change: migrate-typecheck-to-ts7 (design D4).
 */
import type { Page } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAnchorProbe } from "../windowed-session.js";

type Sent = unknown;
const g = globalThis as unknown as Record<string, unknown>;
const SAVED = ["WebSocket", "window", "document"] as const;
let saved: Record<string, unknown>;
let sent: Sent[];

class FakeWebSocket {
  send(data: unknown): void {
    sent.push(data);
  }
}

beforeEach(async () => {
  saved = Object.fromEntries(SAVED.map((k) => [k, g[k]]));
  sent = [];
  g.WebSocket = FakeWebSocket;
  g.window = globalThis;
  g.document = { querySelector: () => null };
  let initScript: (() => void) | undefined;
  await installAnchorProbe({ addInitScript: async (fn: () => void) => void (initScript = fn) } as unknown as Page);
  initScript?.();
});

afterEach(() => {
  for (const k of SAVED) {
    if (saved[k] === undefined) delete g[k];
    else g[k] = saved[k];
  }
});

const send = (data: unknown) => (new FakeWebSocket() as unknown as { send(d: unknown): void }).send(data);

describe("anchor-probe send wrapper keeps payloads intact (E10)", () => {
  it("string passes through", () => {
    send("hello");
    expect(sent).toEqual(["hello"]);
  });

  it("Blob passes through by identity", () => {
    const blob = new Blob(["x"]);
    send(blob);
    expect(sent[0]).toBe(blob);
  });

  it("offset Uint8Array view is copied byte-for-byte (not the whole backing buffer)", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    send(new Uint8Array(backing.buffer, 2, 3));
    const out = sent[0] as Uint8Array;
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out.byteLength).toBe(3);
  });

  it("raw ArrayBuffer is copied byte-for-byte", () => {
    const buf = new Uint8Array([4, 5, 6]).buffer;
    send(buf);
    expect(Array.from(new Uint8Array(sent[0] as ArrayBuffer))).toEqual([4, 5, 6]);
  });
});
