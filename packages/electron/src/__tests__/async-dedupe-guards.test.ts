/**
 * E4 — the narrowed inflight guards still dedupe concurrent work.
 *
 * Two production sites were narrowed from a truthiness guard to an explicit
 * `!== null` check:
 *   - server-lifecycle.ts  `requestServerLaunch` (`inflightLaunch`)
 *   - doctor-window.ts     `doctor:run` handler   (`inFlightRun`)
 * Both memoize an in-flight promise. This suite proves the memoization holds:
 * the underlying work runs EXACTLY ONCE under two concurrent invocations and
 * both callers observe the SAME result.
 *
 * Honest teeth note: reverting the narrowing to the old truthiness form
 * (`if (inflightLaunch)`) does NOT make these runtime assertions red — a
 * Promise is always truthy, so the dedupe behaves identically. The falsifiable
 * property that the narrowing DOES fix is the static one: Biome's
 * `noMisusedPromises` fires on the truthiness form and reports zero on `!== null`.
 * That is asserted in the final `describe` block.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #E4)
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// ── Deferred helper: a promise whose resolution we control, so overlap of the
// two concurrent callers is guaranteed with zero real timers. ──────────────
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ── server-lifecycle.ts: requestServerLaunch ────────────────────────────────
describe("E4: requestServerLaunch dedupes concurrent launches (inflight !== null)", () => {
  const health = deferred<{ running: boolean }>();
  const isDashboardRunning = vi.fn(() => health.promise);

  beforeEach(() => {
    vi.resetModules();
    isDashboardRunning.mockClear();
  });

  it("runs the underlying probe once and both callers get the same outcome", async () => {
    vi.doMock("../lib/health-check.js", () => ({ isDashboardRunning }));
    const { requestServerLaunch } = await import("../lib/server-lifecycle.js");

    // Two concurrent calls while the shared promise is in flight.
    const p1 = requestServerLaunch();
    const p2 = requestServerLaunch();

    // Memoization: the underlying probe kicked off exactly once despite two
    // invocations — the second call short-circuited on the in-flight guard.
    // (`requestServerLaunch` is itself `async`, so each call returns a fresh
    // wrapper promise; identity of the wrappers is not the dedupe property —
    // the single underlying call is.)
    expect(isDashboardRunning).toHaveBeenCalledTimes(1);

    // Complete the shared work; both callers settle to the identical result.
    health.resolve({ running: true });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ kind: "already-running", url: "http://localhost:8000" });
    expect(r2).toEqual(r1);
    // Still only one probe after settling.
    expect(isDashboardRunning).toHaveBeenCalledTimes(1);

    vi.doUnmock("../lib/health-check.js");
  });
});

// ── doctor-window.ts: doctor:run IPC handler ────────────────────────────────
describe("E4: doctor:run dedupes concurrent runs (inFlightRun !== null)", () => {
  const doctorGate = deferred<{ ok: true }>();
  const runDoctor = vi.fn(() => doctorGate.promise);
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  class FakeBrowserWindow {
    isDestroyed(): boolean {
      return false;
    }
    isMinimized(): boolean {
      return false;
    }
    focus(): void {}
    restore(): void {}
    loadFile(): void {}
    on(): void {}
  }

  beforeEach(() => {
    vi.resetModules();
    runDoctor.mockClear();
    handlers.clear();
  });

  afterEach(() => {
    vi.doUnmock("electron");
    vi.doUnmock("../lib/doctor.js");
  });

  it("runs runDoctor once and both callers observe the same report", async () => {
    vi.doMock("../lib/doctor.js", () => ({ runDoctor }));
    vi.doMock("electron", () => ({
      app: {},
      BrowserWindow: FakeBrowserWindow,
      clipboard: { writeText: vi.fn() },
      ipcMain: {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn);
        },
      },
      shell: { openPath: vi.fn() },
    }));

    const { openDoctorWindow } = await import("../lib/doctor-window.js");
    // Registers the IPC handlers (idempotent) and captures `doctor:run`.
    openDoctorWindow();
    const handler = handlers.get("doctor:run");
    expect(handler).toBeTypeOf("function");

    const report = { ok: true } as const;
    // Two concurrent invocations while the first run is in flight.
    const p1 = handler?.({});
    const p2 = handler?.({});

    // runDoctor kicked off exactly once despite two invocations.
    expect(runDoctor).toHaveBeenCalledTimes(1);

    doctorGate.resolve(report);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(report);
    expect(r2).toEqual(report);
    expect(runDoctor).toHaveBeenCalledTimes(1);
  });
});

// ── Falsifiable static property: the narrowing silences noMisusedPromises ────
describe("E4: `!== null` narrowing keeps noMisusedPromises at zero (the real teeth)", () => {
  function misusedPromisesCount(relFile: string): number {
    const out = execFileSync(
      "npx",
      [
        "biome",
        "lint",
        "--only=lint/nursery/noMisusedPromises",
        relFile,
        "--reporter=json",
      ],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    return (JSON.parse(out).diagnostics ?? []).length;
  }

  it("server-lifecycle.ts reports zero misused-promise conditionals", () => {
    expect(misusedPromisesCount("packages/electron/src/lib/server-lifecycle.ts")).toBe(0);
  }, 120_000);

  it("doctor-window.ts reports zero misused-promise conditionals", () => {
    expect(misusedPromisesCount("packages/electron/src/lib/doctor-window.ts")).toBe(0);
  }, 120_000);

  it("the guards are the explicit `!== null` form (not bare truthiness)", () => {
    const readSrc = (rel: string): string =>
      execFileSync("cat", [rel], { cwd: repoRoot, encoding: "utf8" });
    const sl = readSrc("packages/electron/src/lib/server-lifecycle.ts");
    const dw = readSrc("packages/electron/src/lib/doctor-window.ts");
    expect(sl).toMatch(/if\s*\(\s*inflightLaunch\s*!==\s*null\s*\)/);
    expect(dw).toMatch(/if\s*\(\s*inFlightRun\s*!==\s*null\s*\)/);
  });
});
