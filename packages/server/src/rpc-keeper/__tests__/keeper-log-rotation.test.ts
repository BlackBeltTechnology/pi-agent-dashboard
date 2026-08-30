/**
 * Unit tests for keeper-log-rotation.cjs — the bounded-growth core of
 * keeper.cjs (which requires it; CJS-pure, Node built-ins only).
 *
 * The spawned-keeper integration tests (keeper.test.ts) cannot stub fs inside
 * the child, so the rotation contract's fault paths and throttle are proven
 * HERE with a stubbed fs namespace, and re-proven end-to-end there via the
 * PI_KEEPER_TEST_FAULTS env hook where externally observable.
 *
 * Covered: exact cap boundaries (E1/E2), fd-truncate fallback (X1),
 * swapped-path refusal (X2), double failure (X3 unit half), hot-path
 * throttle (P3), silent success (E5 invariant).
 * See change: fix-runaway-keeper-log-growth (D1-D4, tasks 2.7-2.16).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createKeeperLogRotation,
  parsePositiveIntEnv,
  KEEPER_LOG_CHECK_INTERVAL_MS_DEFAULT,
  KEEPER_LOG_MAX_BYTES_DEFAULT,
} = require("../keeper-log-rotation.cjs") as {
  createKeeperLogRotation: (opts: Record<string, unknown>) => {
    rotateIfNeeded: () => void;
    start: () => unknown;
    stop: () => void;
  };
  parsePositiveIntEnv: (raw: unknown, fallback: number) => number;
  KEEPER_LOG_CHECK_INTERVAL_MS_DEFAULT: number;
  KEEPER_LOG_MAX_BYTES_DEFAULT: number;
};

/** Stub fs namespace tracking fstat/truncate calls against a virtual file. */
function makeStubFs(initialSize: number, opts: { ino?: number; failFtruncate?: Error; failTruncate?: Error } = {}) {
  const state = {
    size: initialSize,
    ino: opts.ino ?? 4242,
    pathIno: opts.ino ?? 4242, // diverges when the test "swaps" the path
    pathSize: initialSize,
    fstatCalls: 0,
    ftruncateCalls: 0,
    truncateByPathCalls: [] as Array<[string, number]>,
  };
  const fsStub: Record<string, unknown> = {
    fstatSync: (_fd: number) => {
      state.fstatCalls += 1;
      return { size: state.size, ino: state.ino };
    },
    ftruncateSync: (_fd: number, len: number) => {
      state.ftruncateCalls += 1;
      if (opts.failFtruncate) throw opts.failFtruncate;
      state.size = len;
    },
    statSync: (_path: string) => {
      return { size: 7, ino: state.pathIno };
    },
    truncateSync: (path: string, len: number) => {
      state.truncateByPathCalls.push([path, len]);
      if (opts.failTruncate) throw opts.failTruncate;
      state.pathSize = len;
    },
  };
  return { fsStub, state };
}

function makeRotation(stub: ReturnType<typeof makeStubFs>, overrides: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const clock = { now: 1_000_000 };
  const rotation = createKeeperLogRotation({
    logFd: 7,
    logPath: "/sessions/keeper-s1.log",
    log: (line: string) => lines.push(line),
    maxBytes: 65_536,
    checkIntervalMs: 5_000,
    fs: stub.fsStub,
    now: () => clock.now,
    ...overrides,
  });
  return { rotation, lines, clock };
}

const EPERM = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
const EACCES = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parsePositiveIntEnv", () => {
  it.each([
    [undefined, 134217728],
    [null, 134217728],
    ["", 134217728],
    ["abc", 134217728],
    ["0", 134217728],
    ["-1", 134217728],
    ["65.5", 134217728],
  ])("env %p falls back to the default", (raw, expected) => {
    expect(parsePositiveIntEnv(raw as string, 134217728)).toBe(expected);
  });

  it("valid integers pass through; defaults match the documented constants", () => {
    expect(parsePositiveIntEnv("65536", 1)).toBe(65536);
    expect(parsePositiveIntEnv("0250", 1)).toBe(250); // decimal 250, octal-looking strings are base-10
    expect(KEEPER_LOG_MAX_BYTES_DEFAULT).toBe(134217728);
    expect(KEEPER_LOG_CHECK_INTERVAL_MS_DEFAULT).toBe(5000);
  });
});

describe("rotateIfNeeded — cap boundary (E1/E2, exact)", () => {
  it("E1: size at cap − 1 does NOT truncate", () => {
    const stub = makeStubFs(65_535);
    const { rotation } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(stub.state.ftruncateCalls).toBe(0);
  });

  it("E2: size at exactly the cap truncates the fd to 0", () => {
    const stub = makeStubFs(65_536);
    const { rotation } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(stub.state.ftruncateCalls).toBe(1);
    expect(stub.state.size).toBe(0);
  });

  it("E5 invariant: successful rotation is SILENT (no log line — a success line would re-grow the log)", () => {
    const stub = makeStubFs(65_536);
    const { rotation, lines } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(lines).toEqual([]);
  });
});

describe("rotateIfNeeded — throttle (P3)", () => {
  it("10 000 calls inside one checkIntervalMs window issue at most ONE fstat", () => {
    const stub = makeStubFs(0);
    const { rotation, clock } = makeRotation(stub);
    for (let i = 0; i < 10_000; i++) {
      rotation.rotateIfNeeded();
      // keep the clock inside a single window the whole time
      clock.now = 1_000_000 + Math.floor(i / 2_000); // stays within [0, 5) ms past the window start
    }
    expect(stub.state.fstatCalls).toBe(1);
  });

  it("a throttled call is skipped even when the file is over cap", () => {
    const stub = makeStubFs(130 * 1024 * 1024);
    const { rotation, clock } = makeRotation(stub);
    clock.now += 999_999; // arm nothing yet — first call fires and truncates
    rotation.rotateIfNeeded();
    expect(stub.state.ftruncateCalls).toBe(1);
    // Over cap again, but the throttle window has NOT elapsed → no check.
    stub.state.size = 200 * 1024 * 1024;
    rotation.rotateIfNeeded();
    expect(stub.state.ftruncateCalls).toBe(1);
    // After the window elapses, the next call fires.
    clock.now += 5_001;
    rotation.rotateIfNeeded();
    expect(stub.state.ftruncateCalls).toBe(2);
  });

  it("the failure WARN of a fired check cannot re-trigger a check via log() re-entry", () => {
    const stub = makeStubFs(65_536, { failFtruncate: EPERM, failTruncate: EACCES });
    // Wire the logger EXACTLY like keeper.cjs does: log() re-enters
    // rotateIfNeeded (throttled) before writing. A WARN emitted during a
    // fired check must therefore not consume a second fstat.
    const lines: string[] = [];
    const clock = { now: 1_000_000 };
    const rotation = createKeeperLogRotation({
      logFd: 7,
      logPath: "/sessions/keeper-s1.log",
      log: (line: string) => {
        lines.push(line);
        rotation.rotateIfNeeded(); // keeper.cjs log() wiring
      },
      maxBytes: 65_536,
      checkIntervalMs: 5_000,
      fs: stub.fsStub,
      now: () => clock.now,
    });
    rotation.rotateIfNeeded();
    expect(stub.state.fstatCalls).toBe(1); // one fired check, despite re-entry
    expect(lines.filter((l) => l.includes("rotation failed"))).toHaveLength(1);
  });
});

describe("rotateIfNeeded — fd truncate refused → path fallback (X1)", () => {
  it("ftruncateSync throwing EPERM attempts truncateSync(logPath, 0) on the SAME inode", () => {
    const stub = makeStubFs(65_536, { failFtruncate: EPERM });
    const { rotation, lines } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(stub.state.truncateByPathCalls).toEqual([["/sessions/keeper-s1.log", 0]]);
    // Fallback success is also silent.
    expect(lines).toHaveLength(0);
  });

  it("ftruncateSync throwing a non-EPERM error still takes the fallback (any fd failure)", () => {
    const stub = makeStubFs(65_536, { failFtruncate: EACCES });
    const { rotation } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(stub.state.truncateByPathCalls).toHaveLength(1);
  });
});

describe("rotateIfNeeded — swapped path refused (X2)", () => {
  it("a path naming a DIFFERENT inode is NOT truncated; rotation recorded as failed", () => {
    const stub = makeStubFs(65_536, { failFtruncate: EPERM, ino: 1111 });
    stub.state.pathIno = 9999; // the path was replaced while the fd kept the original
    const { rotation, lines } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(stub.state.truncateByPathCalls).toEqual([]); // replacement file untouched
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/refused.*inode/i);
  });

  it("an unreadable path (statSync throws) is also refused, not truncated blind", () => {
    const stub = makeStubFs(65_536, { failFtruncate: EPERM });
    stub.fsStub.statSync = () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    const { rotation, lines } = makeRotation(stub);
    rotation.rotateIfNeeded();
    expect(stub.state.truncateByPathCalls).toEqual([]);
    expect(lines.join("\n")).toMatch(/refused/i);
  });
});

describe("rotateIfNeeded — both truncation paths fail (X3, unit half)", () => {
  it("no throw escapes the call; each fired check attempts exactly once and WARNs", () => {
    const stub = makeStubFs(65_536, { failFtruncate: EPERM, failTruncate: EACCES });
    const { rotation, lines, clock } = makeRotation(stub);
    expect(() => rotation.rotateIfNeeded()).not.toThrow();
    expect(() => rotation.rotateIfNeeded()).not.toThrow(); // throttled — no new attempt
    clock.now += 5_001;
    expect(() => rotation.rotateIfNeeded()).not.toThrow();
    // Exactly one attempt per elapsed window: 2 fired checks → 2 WARN lines.
    const warns = lines.filter((l) => l.includes("rotation failed"));
    expect(warns).toHaveLength(2);
  });

  it("a throwing clock/fs blow-up is contained (never reaches uncaughtException)", () => {
    const stub = makeStubFs(65_536);
    stub.fsStub.ftruncateSync = () => {
      throw new Error("boom");
    };
    stub.fsStub.statSync = () => {
      throw new Error("kaboom");
    };
    const { rotation } = makeRotation(stub);
    expect(() => rotation.rotateIfNeeded()).not.toThrow();
  });
});

describe("start() — interval timer", () => {
  it("a checkIntervalMs over 2^31 ms is clamped for the TIMER (no 1 ms busy tick from Node's delay clamp)", async () => {
    // Node clamps setInterval delays >= 2^31 ms down to 1 ms. Without the
    // clamp, start() with an absurd config would spin rotateIfNeeded every
    // millisecond (visible here as fstat calls firing within 50 ms).
    const stub = makeStubFs(65_536);
    const { rotation } = makeRotation(stub, { checkIntervalMs: 2_147_483_648 });
    rotation.start();
    await new Promise((r) => setTimeout(r, 50));
    rotation.stop();
    expect(stub.state.fstatCalls).toBe(0); // clamped timer has not fired
  });

  it("start()/stop() are idempotent", () => {
    const stub = makeStubFs(0);
    const { rotation } = makeRotation(stub, { checkIntervalMs: 60_000 });
    rotation.start();
    rotation.start(); // second start is a no-op
    expect(() => rotation.stop()).not.toThrow();
    expect(() => rotation.stop()).not.toThrow(); // double stop is a no-op
  });
});

describe("fstatSync (not statSync) is the size oracle", () => {
  it("the check reads the fd — a swapped path does not fool the size comparison", () => {
    // The over-cap file lives behind the FD (the original inode); the PATH
    // now names a small replacement. A path-based check would see size 7 and
    // skip rotation; the fd-based check must still fire.
    const stub = makeStubFs(0, { ino: 1111 });
    stub.state.pathIno = 9999;
    stub.state.size = 65_536; // fd's inode is over cap
    const { rotation, lines } = makeRotation(stub, { checkIntervalMs: 0 });
    rotation.rotateIfNeeded();
    // The fd-based check fired and truncated the fd's (over-cap) inode...
    expect(stub.state.ftruncateCalls).toBe(1);
    // ...silently: the PATH names someone else's small file, and ftruncate
    // on the fd needed no fallback at all. (The swapped-path refusal with a
    // FAILING ftruncate is covered by the X2 describe above.)
    expect(lines).toHaveLength(0);
  });
});
