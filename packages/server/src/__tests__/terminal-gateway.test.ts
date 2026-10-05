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
});
