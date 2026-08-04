import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  capTranscript,
  createTerminalManager,
  deriveTranscriptCapBytes,
  detectShell,
  type TerminalManager,
} from "../terminal/terminal-manager.js";
import { DEFAULT_MAX_EVENT_DATA_SIZE } from "../persistence/memory-event-store.js";

// Mock node-pty
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();
let mockOnData: ((data: string) => void) | null = null;
let mockOnExit: ((e: { exitCode: number; signal?: number }) => void) | null = null;

// Per-instance PTY mock so multi-terminal retention tests can drive each
// terminal's data + exit independently (the module-level mockOnData/mockOnExit
// remain the LATEST-spawned for back-compat with the original single-term tests).
interface MockPty {
  write: typeof mockPtyWrite;
  onDataCbs: Array<(data: string) => void>;
  onExitCbs: Array<(e: { exitCode: number; signal?: number }) => void>;
  fireData(data: string): void;
  fireExit(): void;
}
let ptyInstances: MockPty[] = [];

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => {
    const inst: MockPty = {
      write: mockPtyWrite,
      onDataCbs: [],
      onExitCbs: [],
      fireData(data: string) {
        for (const cb of this.onDataCbs) cb(data);
      },
      fireExit() {
        for (const cb of [...this.onExitCbs]) cb({ exitCode: 0 });
      },
    };
    const p = {
      write: mockPtyWrite,
      resize: mockPtyResize,
      kill: mockPtyKill,
      onData: (cb: (data: string) => void) => {
        inst.onDataCbs.push(cb);
        mockOnData = cb;
        return { dispose: vi.fn() };
      },
      onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
        inst.onExitCbs.push(cb);
        mockOnExit = cb;
        return { dispose: vi.fn() };
      },
      pid: 12345,
    };
    ptyInstances.push(inst);
    return p;
  }),
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
    ptyInstances = [];
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

// ── preserve-inline-terminal-transcript ──────────────────────────────────
import { measureBytes } from "../persistence/memory-event-store.js";

describe("capTranscript (byte-measured tail cap)", () => {
  const CAP = 15_000;
  // measureBytes counts JSON serialized bytes INCLUDING the 2 surrounding
  // quotes, so an ASCII string of length L serializes to L + 2.
  const ascii = (bytes: number) => "a".repeat(bytes - 2);

  it("E1: exactly-15000 B is returned verbatim, no marker", () => {
    const s = ascii(15_000);
    expect(measureBytes(s, CAP)).toBe(15_000);
    const out = capTranscript(s, CAP);
    expect(out).toBe(s);
    expect(out).not.toContain("chars hidden");
  });

  it("E3: 14999 B is returned verbatim, no marker", () => {
    const s = ascii(14_999);
    const out = capTranscript(s, CAP);
    expect(out).toBe(s);
    expect(out).not.toContain("chars hidden");
  });

  it("E6: empty string returns empty, no marker", () => {
    expect(capTranscript("", CAP)).toBe("");
  });

  it("E2: 15001 B truncates — marker prefix, tail preserved, ≤ budget", () => {
    const s = ascii(15_001);
    const out = capTranscript(s, CAP);
    expect(out).toMatch(/^…\[\d+ chars hidden\]…\n/);
    expect(measureBytes(out, CAP)).toBeLessThanOrEqual(CAP);
    // Tail preserved: result ends with the original transcript's tail.
    const tail = out.slice(out.indexOf("\n") + 1);
    expect(s.endsWith(tail)).toBe(true);
    expect(tail.length).toBeGreaterThan(0);
  });

  it("E7: marker longer than the overflow — result incl. marker ≤ budget", () => {
    const CAP7 = 30;
    const s = ascii(31); // 1 byte over the tiny budget
    const out = capTranscript(s, CAP7);
    expect(out).toContain("chars hidden");
    expect(measureBytes(out, CAP7)).toBeLessThanOrEqual(CAP7);
  });

  it("E4: 15000 CJK code units (~45000 B) truncates — cap is bytes not length", () => {
    const s = "中".repeat(15_000); // ~45002 B serialized
    const out = capTranscript(s, CAP);
    expect(out.length).toBeLessThan(s.length);
    expect(measureBytes(out, CAP)).toBeLessThanOrEqual(CAP);
  });

  it("E5: 8000 ESC-dense code units (~48000 B) truncates", () => {
    const s = "\u001b".repeat(8_000); // each ESC → \u001b = 6 B
    const out = capTranscript(s, CAP);
    expect(measureBytes(out, CAP)).toBeLessThanOrEqual(CAP);
  });
});

describe("deriveTranscriptCapBytes (startup config validation)", () => {
  it("E12: maxStringFieldSize=0, ceiling 20000 passes", () => {
    expect(deriveTranscriptCapBytes(20_000, 0)).toBe(15_000);
  });

  it("E13: maxStringFieldSize=3334 (×6 ≥ ceiling) fails naming both values", () => {
    expect(() => deriveTranscriptCapBytes(20_000, 3334)).toThrow(/3334[\s\S]*20000|20000[\s\S]*3334/);
  });

  it("E14: maxStringFieldSize=3333 (×6 < ceiling) passes", () => {
    expect(deriveTranscriptCapBytes(20_000, 3333)).toBe(15_000);
  });

  it("E15: maxEventDataSize=0 falls back to the default ceiling, not a 0 budget", () => {
    // D9 (fit-attachments-for-display): the 0.75 x derivation stays COUPLED to
    // the event ceiling, so raising it 20 KB -> 256 KiB moves this fallback
    // 15 KB -> 192 KiB. Accepted and documented, not decoupled.
    expect(deriveTranscriptCapBytes(0, 0)).toBe(Math.floor(DEFAULT_MAX_EVENT_DATA_SIZE * 0.75));
    expect(deriveTranscriptCapBytes(0, 0)).toBe(196_608);
  });
});

// The assert previously ran against `config.maxStringFieldSize ?? 0`, and the
// `!== 0` guard made an UNSET cap skip the check entirely - it validated only
// explicitly-configured values. `undefined` now resolves to the store's real
// default (DEFAULT_MAX_STRING_SIZE), so the production configuration is the
// one being asserted. `0` keeps its explicit "string pass disabled" meaning.
// See change: fit-attachments-for-display (task 3.7, test-plan #E11 #E12 #E13).
describe("deriveTranscriptCapBytes (boot assert armed for the unset cap)", () => {
  it("E11: unset maxStringFieldSize at the 256 KiB ceiling returns 192 KiB and does not throw", () => {
    expect(deriveTranscriptCapBytes(262_144)).toBe(196_608);
  });

  it("E12: unset maxStringFieldSize at the pre-raise 20 KB ceiling throws", () => {
    // The negative proof the assert no longer skips: 4000 x 6 = 24000 >= 20000.
    // Before the fix this silently returned 15000.
    expect(() => deriveTranscriptCapBytes(20_000)).toThrow(/maxStringFieldSize/);
  });

  it("E13: maxStringFieldSize=50_000 at the 256 KiB ceiling throws", () => {
    // 50_000 x 6 = 300_000 >= 262_144.
    expect(() => deriveTranscriptCapBytes(262_144, 50_000)).toThrow(/50000[\s\S]*262144|262144[\s\S]*50000/);
  });

  it("E12b: an explicit 0 still means 'string pass disabled' and skips the check", () => {
    expect(deriveTranscriptCapBytes(20_000, 0)).toBe(15_000);
  });
});

describe("transcript tombstone + input tracking", () => {
  let mgr: TerminalManager;
  let exits: string[];

  beforeEach(() => {
    ptyInstances = [];
    exits = [];
    mgr = createTerminalManager({ onExit: (id) => exits.push(id) });
  });

  function attachWs(id: string) {
    const handlers: Record<string, (...a: any[]) => void> = {};
    const ws = {
      send: vi.fn(),
      on: vi.fn((event: string, cb: any) => { handlers[event] = cb; }),
      readyState: 1,
      OPEN: 1,
    } as any;
    mgr.attach(id, ws);
    return handlers;
  }

  it("X2: dead ephemeral removal semantics unchanged + tombstone retained", () => {
    const s = mgr.spawn("/tmp", { ephemeral: true });
    ptyInstances[0].fireData("hello");
    ptyInstances[0].fireExit();
    expect(exits).toContain(s.id);
    expect(mgr.list().find((t) => t.id === s.id)).toBeUndefined();
    expect(mgr.get(s.id)).toBeUndefined();
    expect(() => mgr.attach(s.id, {} as any)).toThrow();
    expect(mgr.getTranscript(s.id)).toBe("hello");
  });

  it("X3: kill-fallback path retains a capped transcript (mock PTY never exits)", async () => {
    vi.useFakeTimers();
    try {
      const s = mgr.spawn("/tmp", { ephemeral: true });
      ptyInstances[0].fireData("fallback transcript");
      mgr.kill(s.id);
      await vi.advanceTimersByTimeAsync(3001); // never fires onExit
      expect(mgr.get(s.id)).toBeUndefined();
      expect(mgr.getTranscript(s.id)).toBe("fallback transcript");
    } finally {
      vi.useRealTimers();
    }
  });

  it("E8: 65th exit evicts the oldest tombstone", () => {
    const ids: string[] = [];
    for (let i = 0; i < 65; i++) {
      const s = mgr.spawn("/tmp", { ephemeral: true });
      ids.push(s.id);
      ptyInstances[i].fireData(`t${i}`);
      ptyInstances[i].fireExit();
    }
    expect(mgr.getTranscript(ids[0])).toBe(""); // oldest evicted
    expect(mgr.getTranscript(ids[1])).toBe("t1");
    expect(mgr.getTranscript(ids[64])).toBe("t64");
  });

  it("E9: exactly 64 exits — all retained", () => {
    const ids: string[] = [];
    for (let i = 0; i < 64; i++) {
      const s = mgr.spawn("/tmp", { ephemeral: true });
      ids.push(s.id);
      ptyInstances[i].fireData(`t${i}`);
      ptyInstances[i].fireExit();
    }
    for (let i = 0; i < 64; i++) expect(mgr.getTranscript(ids[i])).toBe(`t${i}`);
  });

  it("E10: ephemeral retains, non-ephemeral does not", () => {
    const eph = mgr.spawn("/tmp", { ephemeral: true });
    const norm = mgr.spawn("/tmp");
    ptyInstances[0].fireData("eph");
    ptyInstances[1].fireData("norm");
    ptyInstances[0].fireExit();
    ptyInstances[1].fireExit();
    expect(mgr.getTranscript(eph.id)).toBe("eph");
    expect(mgr.getTranscript(norm.id)).toBe("");
  });

  it("E11: non-ephemeral churn does not evict a retained ephemeral", () => {
    for (let i = 0; i < 100; i++) {
      mgr.spawn("/tmp");
      ptyInstances[i].fireData(`n${i}`);
      ptyInstances[i].fireExit();
    }
    const eph = mgr.spawn("/tmp", { ephemeral: true });
    ptyInstances[100].fireData("survivor");
    ptyInstances[100].fireExit();
    expect(mgr.getTranscript(eph.id)).toBe("survivor");
  });

  it("X5: release-then-exit writes no tombstone", () => {
    const s = mgr.spawn("/tmp", { ephemeral: true });
    ptyInstances[0].fireData("secret");
    mgr.releaseTranscript(s.id);
    ptyInstances[0].fireExit();
    expect(mgr.getTranscript(s.id)).toBe("");
  });

  it("X4: fallback → close → late real onExit leaves no tombstone", async () => {
    vi.useFakeTimers();
    try {
      const s = mgr.spawn("/tmp", { ephemeral: true });
      ptyInstances[0].fireData("data");
      mgr.kill(s.id);
      await vi.advanceTimersByTimeAsync(3001); // fallback writes tombstone
      expect(mgr.getTranscript(s.id)).toBe("data");
      mgr.releaseTranscript(s.id); // card closed
      ptyInstances[0].fireExit(); // late real onExit
      expect(mgr.getTranscript(s.id)).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("X6: suppression still in force at 59 s", () => {
    vi.useFakeTimers();
    try {
      const s = mgr.spawn("/tmp", { ephemeral: true });
      ptyInstances[0].fireData("data");
      mgr.releaseTranscript(s.id);
      vi.advanceTimersByTime(59_000);
      ptyInstances[0].fireExit(); // late onExit
      expect(mgr.getTranscript(s.id)).toBe("");
      expect(mgr.isReleased(s.id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("X7: released record reclaimed past the 60 s TTL", () => {
    vi.useFakeTimers();
    try {
      const s = mgr.spawn("/tmp", { ephemeral: true });
      mgr.releaseTranscript(s.id);
      vi.advanceTimersByTime(60_001);
      expect(mgr.isReleased(s.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("F6: resize control frame does not set sawInput; a keystroke does", () => {
    const s = mgr.spawn("/tmp", { ephemeral: true });
    const handlers = attachWs(s.id);
    handlers.message(Buffer.from(JSON.stringify({ type: "resize", cols: 80, rows: 24 })), false);
    expect(mgr.getTerminalRecord(s.id)?.sawInput).toBe(false);
    handlers.message(Buffer.from("a"), false);
    expect(mgr.getTerminalRecord(s.id)?.sawInput).toBe(true);
  });
});
