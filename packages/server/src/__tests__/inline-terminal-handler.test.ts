import { describe, it, expect, vi } from "vitest";
import { handleOpenInlineTerminal, handleCloseInlineTerminal } from "../browser-handlers/terminal-handler.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { capTranscript } from "../terminal/terminal-manager.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";

/**
 * Inline interactive terminal card server handlers.
 * See change: add-inline-terminal-card, preserve-inline-terminal-transcript.
 */

interface CtxOpts {
  record?: { transcript: string; sawInput: boolean } | undefined;
  eventStore?: any;
  seedOpen?: string | null; // terminalId to seed an inline_terminal_open for
}

function makeCtx(opts: CtxOpts = {}): {
  ctx: BrowserHandlerContext;
  events: Array<{ sessionId: string; seq: number; event: any }>;
  broadcasts: any[];
  spawn: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  released: Set<string>;
  store: Map<number, any>;
} {
  const events: Array<{ sessionId: string; seq: number; event: any }> = [];
  const broadcasts: any[] = [];
  let seq = 0;
  const store = new Map<number, any>();
  const released = new Set<string>();
  const hasRecord = "record" in opts;
  const record = hasRecord ? opts.record : { transcript: "captured transcript", sawInput: true };

  const spawn = vi.fn((cwd: string, o?: { ephemeral?: boolean }) => ({
    id: "term-xyz",
    cwd,
    shell: "/bin/bash",
    status: "active" as const,
    createdAt: 0,
    ...(o?.ephemeral ? { ephemeral: true } : {}),
  }));
  const kill = vi.fn();
  const terminalManager = {
    spawn,
    kill,
    getTranscript: vi.fn(() => record?.transcript ?? ""),
    getTerminalRecord: vi.fn(() => record),
    releaseTranscript: vi.fn((id: string) => { released.add(id); }),
    isReleased: vi.fn((id: string) => released.has(id)),
    attach: vi.fn(), detach: vi.fn(), get: vi.fn(), list: vi.fn(() => []), updateTitle: vi.fn(),
  } as any;

  const eventStore = opts.eventStore ?? {
    insertEvent: vi.fn((_sid: string, event: any) => { seq += 1; store.set(seq, event); return seq; }),
    getEvent: vi.fn((_sid: string, s: number) => store.get(s)),
    getEvents: vi.fn((_sid: string, _min: number) =>
      Array.from(store.entries()).map(([s, event]) => ({ seq: s, event })),
    ),
  } as any;

  if (opts.seedOpen) {
    seq += 1;
    store.set(seq, { eventType: "inline_terminal_open", timestamp: 0, data: { terminalId: opts.seedOpen } });
  }

  const ctx = {
    terminalManager,
    eventStore,
    broadcast: (msg: any) => broadcasts.push(msg),
    broadcastEvent: (sessionId: string, s: number, event: any) => events.push({ sessionId, seq: s, event }),
  } as unknown as BrowserHandlerContext;
  return { ctx, events, broadcasts, spawn, kill, released, store };
}

describe("inline terminal handlers", () => {
  it("open spawns an ephemeral PTY, broadcasts terminal_added, and emits inline_terminal_open", () => {
    const { ctx, events, broadcasts, spawn } = makeCtx();
    handleOpenInlineTerminal({ type: "open_inline_terminal", sessionId: "s1", cwd: "/repo" }, ctx);

    expect(spawn).toHaveBeenCalledWith("/repo", { ephemeral: true });
    expect(broadcasts.some((m) => m.type === "terminal_added" && m.terminal.ephemeral === true)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("inline_terminal_open");
    expect(events[0].event.data.terminalId).toBe("term-xyz");
  });

  it("close emits the captured transcript when the user interacted", () => {
    const { ctx, events, kill } = makeCtx();
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);

    expect(kill).toHaveBeenCalledWith("term-xyz");
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("inline_terminal_close");
    expect(events[0].event.data.terminalId).toBe("term-xyz");
    expect(events[0].event.data.transcript).toBe("captured transcript");
  });

  it("close emits an empty transcript when the user never interacted", () => {
    const { ctx, events } = makeCtx({ record: { transcript: "prompt$ ", sawInput: false } });
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].event.data.transcript).toBe("");
  });

  it("X1 (acceptance gate): oversize mixed transcript survives a real store — terminalId intact, not truncated", () => {
    const big = ("中\u001b[31m🚀".repeat(30_000)); // far over the 20000 B ceiling
    const capped = capTranscript(big, 15_000);
    const realStore = createMemoryEventStore(() => true, undefined, undefined, 0); // maxStringFieldSize=0, default ceiling
    const { ctx, events } = makeCtx({
      record: { transcript: capped, sawInput: true },
      eventStore: realStore,
    });
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);

    expect(events).toHaveLength(1);
    const data = events[0].event.data as Record<string, unknown>;
    expect(data.terminalId).toBe("term-xyz");
    expect(typeof data.transcript).toBe("string");
    expect((data.transcript as string).length).toBeGreaterThan(0);
    expect(data.__truncated).toBeUndefined();
  });

  it("X8: a second close emits nothing", () => {
    const { ctx, events } = makeCtx();
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    expect(events).toHaveLength(1);
  });

  it("X9: concurrent second close (entry still live) emits nothing; live == replay", () => {
    // Both closes route through the same handler synchronously; the first sets
    // the release flag before the second runs, so the second is a no-op.
    const { ctx, events } = makeCtx({ record: { transcript: "live", sawInput: true } });
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].event.data.transcript).toBe("live");
  });

  it("X10: close for an unknown terminal emits nothing and does not throw", () => {
    const { ctx, events, store } = makeCtx({ record: undefined }); // no live entry / tombstone, no open event
    expect(() =>
      handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-nope" }, ctx),
    ).not.toThrow();
    expect(events).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("X11: evicted tombstone (opened but no record) emits transcript:''", () => {
    const { ctx, events } = makeCtx({ record: undefined, seedOpen: "term-xyz" });
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].event.data.transcript).toBe("");
  });

  it("X13: close → evict → duplicate close preserves content (guards compose)", () => {
    const { ctx, events } = makeCtx({ record: { transcript: "content", sawInput: true } });
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    // duplicate close after release
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].event.data.transcript).toBe("content");
  });
});
