import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTerminalManager, detectShell, type TerminalManager } from "../terminal-manager.js";

// Mock node-pty
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();
let mockOnData: ((data: string) => void) | null = null;
let mockOnExit: ((e: { exitCode: number; signal?: number }) => void) | null = null;

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    write: mockPtyWrite,
    resize: mockPtyResize,
    kill: mockPtyKill,
    onData: (cb: (data: string) => void) => {
      mockOnData = cb;
      return { dispose: vi.fn() };
    },
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
      mockOnExit = cb;
      return { dispose: vi.fn() };
    },
    pid: 12345,
  })),
}));

// Mock platform/process.ts killProcess so the Windows path is observable in tests.
const mockKillProcess = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true, forced: false }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", () => ({
  killProcess: (...args: unknown[]) => mockKillProcess(...args),
}));

describe("TerminalManager", () => {
  let manager: TerminalManager;
  let exitCallbacks: Array<(termId: string) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnData = null;
    mockOnExit = null;
    exitCallbacks = [];
    manager = createTerminalManager({
      onExit: (termId) => exitCallbacks.forEach((cb) => cb(termId)),
    });
  });

  afterEach(() => {
    // Kill all terminals to clean up
    for (const t of manager.list()) {
      try { manager.kill(t.id); } catch {}
    }
  });

  describe("spawn", () => {
    it("creates a terminal with term- prefix ID", () => {
      const session = manager.spawn("/tmp");
      expect(session.id).toMatch(/^term-/);
      expect(session.cwd).toBe("/tmp");
      expect(session.status).toBe("active");
      expect(session.shell).toBeDefined();
    });

    it("detects shell from env", () => {
      const original = process.env.SHELL;
      process.env.SHELL = "/bin/zsh";
      const session = manager.spawn("/tmp");
      expect(session.shell).toBe("/bin/zsh");
      process.env.SHELL = original;
    });

    it("falls back to /bin/bash when SHELL not set", () => {
      const original = process.env.SHELL;
      delete process.env.SHELL;
      const session = manager.spawn("/tmp");
      expect(session.shell).toBe("/bin/bash");
      process.env.SHELL = original;
    });

    it("marks ephemeral terminals (inline cards) and defaults others to non-ephemeral", () => {
      const inline = manager.spawn("/tmp", { ephemeral: true });
      const normal = manager.spawn("/tmp");
      expect(inline.ephemeral).toBe(true);
      expect(normal.ephemeral).toBeUndefined();
    });

    it("getTranscript returns buffered PTY output as a string", () => {
      const session = manager.spawn("/tmp", { ephemeral: true });
      mockOnData?.("hello transcript");
      expect(manager.getTranscript(session.id)).toBe("hello transcript");
      expect(manager.getTranscript("term-missing")).toBe("");
    });

    it("spawns node-pty with correct args", async () => {
      const pty = await import("node-pty");
      manager.spawn("/home/user");
      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          cwd: "/home/user",
          cols: 80,
          rows: 24,
        }),
      );
    });
  });

  describe("list and get", () => {
    it("lists all active terminals", () => {
      manager.spawn("/tmp/a");
      manager.spawn("/tmp/b");
      expect(manager.list()).toHaveLength(2);
    });

    it("gets a terminal by ID", () => {
      const session = manager.spawn("/tmp");
      expect(manager.get(session.id)).toEqual(session);
    });

    it("returns undefined for unknown ID", () => {
      expect(manager.get("term-nonexistent")).toBeUndefined();
    });
  });

  describe("updateTitle", () => {
    it("updates the title", () => {
      const session = manager.spawn("/tmp");
      manager.updateTitle(session.id, "my title");
      expect(manager.get(session.id)?.title).toBe("my title");
    });
  });

  describe("kill", () => {
    beforeEach(() => {
      mockKillProcess.mockClear();
    });

    it("POSIX: sends SIGHUP to PTY (bash on Linux ignores SIGTERM)", () => {
      if (process.platform === "win32") return; // skipped on Windows; covered below
      const session = manager.spawn("/tmp");
      manager.kill(session.id);
      expect(mockPtyKill).toHaveBeenCalledWith("SIGHUP");
      expect(mockKillProcess).not.toHaveBeenCalled();
    });

    it("Windows: routes kill through platform killProcess (tree kill via taskkill /F /T)", () => {
      if (process.platform !== "win32") return; // skipped off-Windows
      const session = manager.spawn("C:\\tmp");
      manager.kill(session.id);
      // pty.kill MUST NOT be called on Windows — killProcess(pid) does the tree-kill.
      expect(mockPtyKill).not.toHaveBeenCalled();
      expect(mockKillProcess).toHaveBeenCalledWith(12345, expect.objectContaining({ timeoutMs: 2000 }));
    });

    it("fallback cleanup fires if onExit does not within 3 s (simulates Windows ConPTY)", async () => {
      vi.useFakeTimers();
      try {
        const session = manager.spawn("/tmp");
        let exitCalled = false;
        manager = createTerminalManager({
          onExit: () => { exitCalled = true; },
        });
        const session2 = manager.spawn("/tmp");
        manager.kill(session2.id);
        // Simulate node-pty NOT firing onExit (the actual Windows failure mode).
        await vi.advanceTimersByTimeAsync(3001);
        expect(exitCalled).toBe(true);
        expect(manager.get(session2.id)).toBeUndefined(); // removed from map
      } finally {
        vi.useRealTimers();
      }
    });

    it("throws for unknown ID", () => {
      expect(() => manager.kill("term-unknown")).toThrow();
    });
  });

  describe("attach", () => {
    it("replays buffer contents on attach", () => {
      const session = manager.spawn("/tmp");
      // Simulate PTY output
      mockOnData?.("hello world");

      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
      } as any;

      manager.attach(session.id, mockWs);

      // First call should be the replay
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.any(Buffer),
      );
      const sentData = mockWs.send.mock.calls[0][0];
      expect(sentData.toString()).toBe("hello world");
    });

    it("routes binary frames to pty.write", () => {
      const session = manager.spawn("/tmp");
      const handlers: Record<string, Function> = {};

      const mockWs = {
        send: vi.fn(),
        on: vi.fn((event: string, cb: any) => { handlers[event] = cb; }),
        readyState: 1,
        OPEN: 1,
      } as any;

      manager.attach(session.id, mockWs);

      // Simulate binary input from browser
      const input = Buffer.from("ls\n");
      handlers.message(input, true);
      expect(mockPtyWrite).toHaveBeenCalledWith(input.toString());
    });

    it("routes non-JSON text frames to pty.write (AttachAddon sends text)", () => {
      const session = manager.spawn("/tmp");
      const handlers: Record<string, Function> = {};

      const mockWs = {
        send: vi.fn(),
        on: vi.fn((event: string, cb: any) => { handlers[event] = cb; }),
        readyState: 1,
        OPEN: 1,
      } as any;

      manager.attach(session.id, mockWs);

      // AttachAddon sends keystrokes as text frames
      const input = Buffer.from("ls\n");
      handlers.message(input, false);
      expect(mockPtyWrite).toHaveBeenCalledWith("ls\n");
    });

    it("handles resize control message", () => {
      const session = manager.spawn("/tmp");
      const handlers: Record<string, Function> = {};

      const mockWs = {
        send: vi.fn(),
        on: vi.fn((event: string, cb: any) => { handlers[event] = cb; }),
        readyState: 1,
        OPEN: 1,
      } as any;

      manager.attach(session.id, mockWs);

      // Simulate resize control message (text frame)
      const resizeMsg = Buffer.from(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
      handlers.message(resizeMsg, false);
      expect(mockPtyResize).toHaveBeenCalledWith(120, 40);
    });

    // Resize floor — see change: fix-terminal-half-height-dual-mount.
    // PTYs at <2 cols/rows are non-functional for every supported shell
    // and the most common cause is a transient display:none container
    // measured by FitAddon during a route transition.
    describe("resize floor", () => {
      function attachAndSendResize(cols: number, rows: number) {
        const session = manager.spawn("/tmp");
        const handlers: Record<string, Function> = {};
        const mockWs = {
          send: vi.fn(),
          on: vi.fn((event: string, cb: any) => { handlers[event] = cb; }),
          readyState: 1,
          OPEN: 1,
        } as any;
        manager.attach(session.id, mockWs);
        const msg = Buffer.from(JSON.stringify({ type: "resize", cols, rows }));
        handlers.message(msg, false);
      }

      it("ignores resize with cols below floor (cols=1)", () => {
        attachAndSendResize(1, 24);
        expect(mockPtyResize).not.toHaveBeenCalled();
      });

      it("ignores resize with rows below floor (rows=0)", () => {
        attachAndSendResize(80, 0);
        expect(mockPtyResize).not.toHaveBeenCalled();
      });

      it("ignores resize with both dimensions below floor", () => {
        attachAndSendResize(1, 1);
        expect(mockPtyResize).not.toHaveBeenCalled();
      });

      it("accepts resize at the floor (cols=2, rows=2)", () => {
        attachAndSendResize(2, 2);
        expect(mockPtyResize).toHaveBeenCalledWith(2, 2);
      });

      it("accepts a normal resize", () => {
        attachAndSendResize(80, 24);
        expect(mockPtyResize).toHaveBeenCalledWith(80, 24);
      });
    });
  });

  describe("PTY exit", () => {
    it("calls onExit callback and removes terminal", () => {
      const cb = vi.fn();
      exitCallbacks.push(cb);

      const session = manager.spawn("/tmp");
      // Simulate PTY exit
      mockOnExit?.({ exitCode: 0 });

      expect(cb).toHaveBeenCalledWith(session.id);
      expect(manager.get(session.id)).toBeUndefined();
    });
  });
});

describe("detectShell", () => {
  const origShell = process.env.SHELL;
  const origComspec = process.env.COMSPEC;

  afterEach(() => {
    if (origShell !== undefined) process.env.SHELL = origShell;
    else delete process.env.SHELL;
    if (origComspec !== undefined) process.env.COMSPEC = origComspec;
    else delete process.env.COMSPEC;
  });

  it("should use SHELL on macOS", () => {
    process.env.SHELL = "/bin/zsh";
    expect(detectShell("darwin")).toBe("/bin/zsh");
  });

  it("should use SHELL on Linux", () => {
    process.env.SHELL = "/usr/bin/fish";
    expect(detectShell("linux")).toBe("/usr/bin/fish");
  });

  it("should fall back to /bin/bash on Unix when SHELL unset", () => {
    delete process.env.SHELL;
    expect(detectShell("linux")).toBe("/bin/bash");
  });

  it("should use COMSPEC on Windows", () => {
    process.env.COMSPEC = "C:\\Windows\\system32\\cmd.exe";
    expect(detectShell("win32")).toBe("C:\\Windows\\system32\\cmd.exe");
  });

  it("should fall back to powershell.exe on Windows when COMSPEC unset", () => {
    delete process.env.COMSPEC;
    expect(detectShell("win32")).toBe("powershell.exe");
  });
});
