import { describe, expect, it, vi } from "vitest";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { handleCloseInlineTerminal, handleCreateTerminal, handleOpenInlineTerminal } from "../browser-handlers/terminal-handler.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { capTranscript, TerminalLimitError } from "../terminal/terminal-manager.js";

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
    sessionManager: { get: (id: string) => (id === "s1" ? { cwd: "/repo" } : undefined) },
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

// ─── PTY cap refusal delivery (change: harden-server-capability-bounds, #E6-#E8, #E36) ───
describe("terminal cap refusal", () => {
  function capCtx(err: Error) {
    const ws = { id: "requesting-socket" };
    const sendTo = vi.fn();
    const broadcast = vi.fn();
    const insert = vi.fn();
    const insertEvent = vi.fn();
    const ctx = {
      ws,
      sendTo,
      broadcast,
      broadcastEvent: vi.fn(),
      eventStore: { insertEvent, getEvent: vi.fn(), getEvents: vi.fn(() => []) },
      sessionOrderManager: { insert, getOrder: vi.fn(() => []) },
      sessionManager: { get: (id: string) => (id === "S" ? { cwd: "/w" } : undefined) },
      terminalAdmission: { knownCwds: () => ["/w"] },
      terminalManager: { spawn: vi.fn(() => { throw err; }) },
    } as unknown as BrowserHandlerContext;
    return { ctx, ws, sendTo, broadcast, insert, insertEvent };
  }

  it("E6 create_terminal at the cap: requesting socket only gets terminal_limit_reached; nothing broadcast or inserted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, ws, sendTo, broadcast, insert } = capCtx(new TerminalLimitError("global", 32));
    await handleCreateTerminal({ type: "create_terminal", cwd: "/w" }, ctx);
    expect(sendTo).toHaveBeenCalledTimes(1);
    expect(sendTo).toHaveBeenCalledWith(ws, { type: "terminal_limit_reached", scope: "global", limit: 32, cwd: "/w", inline: false });
    expect(broadcast).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // E36: exactly one log line with scope + limit
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/global/);
    expect(String(warn.mock.calls[0][0])).toMatch(/32/);
    warn.mockRestore();
  });

  it("E7 open_inline_terminal at the cap: inline:true, no event, no terminal_added", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, ws, sendTo, broadcast, insertEvent } = capCtx(new TerminalLimitError("owner", 16));
    handleOpenInlineTerminal({ type: "open_inline_terminal", sessionId: "S", cwd: "/w" } as any, ctx);
    expect(sendTo).toHaveBeenCalledWith(ws, { type: "terminal_limit_reached", scope: "owner", limit: 16, cwd: "/w", inline: true });
    expect(insertEvent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("E8 a non-cap spawn error never rejects: the requester gets terminal_error cwd_admission_unavailable (logged once)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, ws, sendTo, broadcast } = capCtx(new Error("pty boom"));
    await expect(handleCreateTerminal({ type: "create_terminal", cwd: "/w" }, ctx)).resolves.toBeUndefined();
    expect(sendTo).toHaveBeenCalledTimes(1);
    expect(sendTo).toHaveBeenCalledWith(ws, expect.objectContaining({ type: "terminal_error", code: "cwd_admission_unavailable", cwd: "/w", inline: false }));
    expect(broadcast).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

// ─── Terminal cwd admission (change: harden-git-terminal-plugin-boundaries, #SE33, #SE34) ───
describe("terminal cwd admission", () => {
  /** Two sockets; `ws` is the requester. Admission is driven by the known-folder seam. */
  function admCtx(opts: { known?: string[]; sessions?: Record<string, { cwd?: unknown }>; runner?: unknown } = {}) {
    const ws = { id: "requester" };
    const other = { id: "other" };
    const sent: Array<{ to: unknown; msg: any }> = [];
    const spawn = vi.fn((cwd: string, o?: { ephemeral?: boolean }) => ({
      id: "term-1", cwd, shell: "sh", status: "active" as const, createdAt: 0, ...(o?.ephemeral ? { ephemeral: true } : {}),
    }));
    const admitCalls: string[] = [];
    const ctx = {
      ws,
      sendTo: (to: unknown, msg: unknown) => sent.push({ to, msg }),
      broadcast: vi.fn(),
      broadcastEvent: vi.fn(),
      eventStore: { insertEvent: vi.fn(() => 1), getEvent: vi.fn(), getEvents: vi.fn(() => []) },
      sessionOrderManager: { insert: vi.fn(), getOrder: vi.fn(() => []) },
      sessionManager: { get: (id: string) => (opts.sessions && Object.hasOwn(opts.sessions, id) ? opts.sessions[id] : undefined) },
      terminalAdmission: {
        knownCwds: () => { admitCalls.push("known"); return opts.known ?? []; },
        admitOptions: opts.runner ? { runner: opts.runner as never } : undefined,
      },
      terminalManager: { spawn },
    } as unknown as BrowserHandlerContext;
    return { ctx, ws, other, sent, spawn, admitCalls };
  }

  it("SE33 known cwd admits and spawns once at that cwd", async () => {
    const { ctx, spawn, sent } = admCtx({ known: ["/w/known"] });
    await handleCreateTerminal({ type: "create_terminal", cwd: "/w/known" }, ctx);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe("/w/known");
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["unknown dir", "/w/unknown"],
    ["relative ../x", "../x"],
    ["empty", ""],
    ["non-string 42", 42],
  ])("SE33 %s → 0 spawns; only the requesting socket gets terminal_error cwd_not_admitted", async (_n, cwd) => {
    const { ctx, ws, spawn, sent } = admCtx({ known: ["/w/known"] });
    await handleCreateTerminal({ type: "create_terminal", cwd } as never, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ws);
    expect(sent[0].msg).toMatchObject({ type: "terminal_error", code: "cwd_not_admitted", cwd: typeof cwd === "string" ? cwd : "", inline: false });
    expect(sent[0].msg.message).not.toBe("");
  });

  it("SE33 indeterminate admission → 0 spawns + cwd_admission_unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = async () => ({ ok: false, error: { kind: "spawn-failure", message: "EAGAIN" } });
    // A real directory that is NOT known, so derivation runs git and the failing runner can't decide.
    const { ctx, spawn, sent, ws } = admCtx({ known: ["/w/known"], runner: failing });
    await handleCreateTerminal({ type: "create_terminal", cwd: process.cwd() }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ws);
    expect(sent[0].msg).toMatchObject({ type: "terminal_error", code: "cwd_admission_unavailable", inline: false });
    warn.mockRestore();
  });

  it("SX2 admitCwd rejecting (known-folder source throws) → cwd_admission_unavailable, no spawn, no rejection, logged once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, ws, spawn, sent } = admCtx();
    (ctx as { terminalAdmission: unknown }).terminalAdmission = { knownCwds: () => { throw new Error("known boom"); } };
    await expect(handleCreateTerminal({ type: "create_terminal", cwd: "/w/x" }, ctx)).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ws);
    expect(sent[0].msg).toMatchObject({ type: "terminal_error", code: "cwd_admission_unavailable", inline: false });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("SE33 no admission seam at all → fail closed (nothing known)", async () => {
    const { ctx, spawn, sent } = admCtx();
    delete (ctx as { terminalAdmission?: unknown }).terminalAdmission;
    await handleCreateTerminal({ type: "create_terminal", cwd: "/w/known" }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(sent[0].msg).toMatchObject({ code: "cwd_not_admitted" });
  });

  it.each([["/other"], [undefined], ["/w/s1"]])("SE34 known session spawns at the session cwd, client cwd %s ignored, no admission call", (clientCwd) => {
    const { ctx, spawn, sent, admitCalls } = admCtx({ sessions: { s1: { cwd: "/w/s1" } } });
    handleOpenInlineTerminal({ type: "open_inline_terminal", sessionId: "s1", cwd: clientCwd } as never, ctx);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe("/w/s1");
    expect(admitCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it.each([["nope"], [""], [42]])("SE34 unknown session %j → 0 spawns + terminal_error session_not_found inline", (sessionId) => {
    const { ctx, ws, spawn, sent } = admCtx({ sessions: { s1: { cwd: "/w/s1" } } });
    handleOpenInlineTerminal({ type: "open_inline_terminal", sessionId, cwd: "/other" } as never, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ws);
    expect(sent[0].msg).toMatchObject({ type: "terminal_error", code: "session_not_found", inline: true });
    expect(sent[0].msg.message).not.toBe("");
  });

  it.each([[undefined], [""]])("SE34 known session with recorded cwd %j → cwd_not_admitted inline, 0 spawns", (cwd) => {
    const { ctx, spawn, sent } = admCtx({ sessions: { s1: { cwd } } });
    handleOpenInlineTerminal({ type: "open_inline_terminal", sessionId: "s1", cwd: "/other" } as never, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(sent[0].msg).toMatchObject({ type: "terminal_error", code: "cwd_not_admitted", inline: true });
  });
});
