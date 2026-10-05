import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTerminalGateway } from "../terminal/terminal-gateway.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";

describe("TerminalGateway", () => {
  let mockManager: TerminalManager;

  beforeEach(() => {
    mockManager = {
      spawn: vi.fn(),
      attach: vi.fn(),
      detach: vi.fn(),
      kill: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => []),
      updateTitle: vi.fn(),
      getTranscript: vi.fn(() => ""),
      getTerminalRecord: vi.fn(() => undefined),
      releaseTranscript: vi.fn(),
      isReleased: vi.fn(() => false),
    };
  });

  it("parses terminal ID from URL path", () => {
    const gateway = createTerminalGateway(mockManager);
    expect(gateway.parseTerminalId("/ws/terminal/term-abc123")).toBe("term-abc123");
    expect(gateway.parseTerminalId("/ws/terminal/")).toBeNull();
    expect(gateway.parseTerminalId("/ws")).toBeNull();
    expect(gateway.parseTerminalId("/ws/terminal")).toBeNull();
  });

  it("rejects upgrade for non-existent terminal", () => {
    const gateway = createTerminalGateway(mockManager);
    (mockManager.get as any).mockReturnValue(undefined);

    const socket = { destroy: vi.fn() } as any;
    gateway.handleUpgrade(
      { url: "/ws/terminal/term-nonexistent" } as any,
      socket,
      Buffer.alloc(0),
    );

    expect(socket.destroy).toHaveBeenCalled();
    expect(mockManager.attach).not.toHaveBeenCalled();
  });

  it("accepts upgrade for existing terminal", () => {
    const gateway = createTerminalGateway(mockManager);
    (mockManager.get as any).mockReturnValue({ id: "term-abc", status: "active" });

    const mockWs = { on: vi.fn() };
    const handleUpgradeMock = vi.fn((_req: any, _socket: any, _head: any, cb: any) => {
      cb(mockWs);
    });
    (gateway.wss as any).handleUpgrade = handleUpgradeMock;

    const socket = { destroy: vi.fn() } as any;
    const request = { url: "/ws/terminal/term-abc" } as any;

    gateway.handleUpgrade(request, socket, Buffer.alloc(0));

    expect(handleUpgradeMock).toHaveBeenCalled();
    expect(mockManager.attach).toHaveBeenCalledWith("term-abc", mockWs);
  });

  it("an authorize callback that refuses ⇒ socket destroyed, nothing attached (same as a missing terminal)", () => {
    const gateway = createTerminalGateway(mockManager);
    (mockManager.get as any).mockReturnValue({ id: "term-abc", status: "active" });
    const wsUpgrade = vi.fn();
    (gateway.wss as any).handleUpgrade = wsUpgrade;
    const socket = { destroy: vi.fn() } as any;
    const authorize = vi.fn(() => false);
    gateway.handleUpgrade({ url: "/ws/terminal/term-abc" } as any, socket, Buffer.alloc(0), authorize);
    expect(authorize).toHaveBeenCalledWith("term-abc");
    expect(socket.destroy).toHaveBeenCalled();
    expect(wsUpgrade).not.toHaveBeenCalled();
    expect(mockManager.attach).not.toHaveBeenCalled();
  });

  it("an authorize callback that allows ⇒ attaches; a ?ticket query never leaks into the id", () => {
    const gateway = createTerminalGateway(mockManager);
    (mockManager.get as any).mockReturnValue({ id: "term-abc", status: "active" });
    (gateway.wss as any).handleUpgrade = vi.fn((_r: any, _s: any, _h: any, cb: any) => cb({ on: vi.fn() }));
    const socket = { destroy: vi.fn() } as any;
    gateway.handleUpgrade({ url: "/ws/terminal/term-abc?ticket=t" } as any, socket, Buffer.alloc(0), () => true);
    expect(mockManager.get).toHaveBeenCalledWith("term-abc");
    expect(mockManager.attach).toHaveBeenCalledWith("term-abc", expect.anything());
  });

  // ── review B1: an ATTACHED PTY socket must not outlive the principal's token ──
  function attachedSocket() {
    const gateway = createTerminalGateway(mockManager);
    (mockManager.get as any).mockReturnValue({ id: "term-abc", status: "active" });
    const handlers: Record<string, () => void> = {};
    const ws = {
      close: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn((ev: string, fn: () => void) => { handlers[ev] = fn; }),
    } as any;
    (gateway.wss as any).handleUpgrade = vi.fn((_r: any, _s: any, _h: any, cb: any) => cb(ws));
    return { gateway, ws, handlers };
  }

  it("closes the attached socket with 4001 when the ticket's principal expires, and never earlier", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws } = attachedSocket();
      const expiresAt = Date.now() + 5_000;
      gateway.handleUpgrade({ url: "/ws/terminal/term-abc" } as any, { destroy: vi.fn() } as any, Buffer.alloc(0), undefined, expiresAt);
      expect(mockManager.attach).toHaveBeenCalled();
      vi.advanceTimersByTime(4_900);
      expect(ws.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(ws.close).toHaveBeenCalledWith(4001, "identity expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an already-expired ticket closes the socket immediately after attach", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws } = attachedSocket();
      gateway.handleUpgrade({ url: "/ws/terminal/term-abc" } as any, { destroy: vi.fn() } as any, Buffer.alloc(0), undefined, Date.now() - 1);
      expect(ws.close).toHaveBeenCalledWith(4001, "identity expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("no expiry (inert plane / principal-less ticket) installs no timers; the timers are released on close", () => {
    vi.useFakeTimers();
    try {
      const inert = attachedSocket();
      inert.gateway.handleUpgrade({ url: "/ws/terminal/term-abc" } as any, { destroy: vi.fn() } as any, Buffer.alloc(0));
      expect(vi.getTimerCount()).toBe(0);

      const live = attachedSocket();
      live.gateway.handleUpgrade({ url: "/ws/terminal/term-abc" } as any, { destroy: vi.fn() } as any, Buffer.alloc(0), undefined, Date.now() + 60_000);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      live.handlers.close?.();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
