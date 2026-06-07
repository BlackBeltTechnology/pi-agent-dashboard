import { describe, it, expect, vi } from "vitest";
import { handleOpenInlineTerminal, handleCloseInlineTerminal } from "../browser-handlers/terminal-handler.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";

/**
 * Inline interactive terminal card server handlers.
 * See change: add-inline-terminal-card.
 */

function makeCtx(overrides: Partial<BrowserHandlerContext> = {}): {
  ctx: BrowserHandlerContext;
  events: Array<{ sessionId: string; seq: number; event: any }>;
  broadcasts: any[];
  spawn: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
} {
  const events: Array<{ sessionId: string; seq: number; event: any }> = [];
  const broadcasts: any[] = [];
  let seq = 0;
  const store = new Map<number, any>();
  const spawn = vi.fn((cwd: string, opts?: { ephemeral?: boolean }) => ({
    id: "term-xyz",
    cwd,
    shell: "/bin/bash",
    status: "active" as const,
    createdAt: 0,
    ...(opts?.ephemeral ? { ephemeral: true } : {}),
  }));
  const kill = vi.fn();
  const terminalManager = {
    spawn,
    kill,
    getTranscript: vi.fn(() => "captured transcript"),
    attach: vi.fn(), detach: vi.fn(), get: vi.fn(), list: vi.fn(() => []), updateTitle: vi.fn(),
  } as any;
  const eventStore = {
    insertEvent: vi.fn((_sid: string, event: any) => { seq += 1; store.set(seq, event); return seq; }),
    getEvent: vi.fn((_sid: string, s: number) => store.get(s)),
  } as any;
  const ctx = {
    terminalManager,
    eventStore,
    broadcast: (msg: any) => broadcasts.push(msg),
    broadcastEvent: (sessionId: string, s: number, event: any) => events.push({ sessionId, seq: s, event }),
    ...overrides,
  } as unknown as BrowserHandlerContext;
  return { ctx, events, broadcasts, spawn, kill };
}

describe("inline terminal handlers", () => {
  it("open spawns an ephemeral PTY, broadcasts terminal_added, and emits inline_terminal_open", () => {
    const { ctx, events, broadcasts, spawn } = makeCtx();
    handleOpenInlineTerminal({ type: "open_inline_terminal", sessionId: "s1", cwd: "/repo" }, ctx);

    expect(spawn).toHaveBeenCalledWith("/repo", { ephemeral: true });
    expect(broadcasts.some((m) => m.type === "terminal_added" && m.terminal.ephemeral === true)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe("s1");
    expect(events[0].event.eventType).toBe("inline_terminal_open");
    expect(events[0].event.data.terminalId).toBe("term-xyz");
  });

  it("close captures the transcript, kills the PTY, and emits inline_terminal_close", () => {
    const { ctx, events, kill } = makeCtx();
    handleCloseInlineTerminal({ type: "close_inline_terminal", sessionId: "s1", terminalId: "term-xyz" }, ctx);

    expect(kill).toHaveBeenCalledWith("term-xyz");
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("inline_terminal_close");
    expect(events[0].event.data.terminalId).toBe("term-xyz");
    expect(events[0].event.data.transcript).toBe("captured transcript");
  });
});
