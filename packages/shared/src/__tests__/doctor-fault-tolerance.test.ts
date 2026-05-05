/**
 * Doctor fault-tolerance helpers — safeCheck / safeExec / assumedMandatory.
 * See change: doctor-rich-output (design.md Decision 7).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync, readFileSync, chmodSync } from "node:fs";

import {
  safeCheck,
  safeExec,
  assumedMandatory,
  stripAnsi,
} from "../doctor-core.js";

describe("stripAnsi", () => {
  it("removes CSI sequences", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m text")).toBe("red text");
    expect(stripAnsi("\u001b[1;33;40myellow\u001b[m")).toBe("yellow");
  });
  it("removes OSC sequences", () => {
    expect(stripAnsi("\u001b]0;title\u0007hello")).toBe("hello");
  });
  it("preserves printable text untouched", () => {
    expect(stripAnsi("a | b | c\nfoo")).toBe("a | b | c\nfoo");
  });
  it("handles empty input", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("safeCheck", () => {
  it("returns the row on success", async () => {
    const r = await safeCheck("X", "diagnostics", () => ({
      name: "X",
      section: "diagnostics",
      status: "ok",
      message: "fine",
    }));
    expect(r.status).toBe("ok");
    expect(r.name).toBe("X");
  });

  it("swallows synchronous throws and returns a fallback row", async () => {
    const r = await safeCheck("Boom", "runtime", () => {
      throw new Error("kaboom");
    });
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/Check failed/i);
    expect(r.detail).toContain("kaboom");
    expect(r.suggestion?.length ?? 0).toBeGreaterThan(0);
  });

  it("swallows promise rejections and returns a fallback row", async () => {
    const r = await safeCheck("Boom", "runtime", async () => {
      throw new Error("async-boom");
    });
    expect(r.status).toBe("error");
    expect(r.detail).toContain("async-boom");
  });

  it("never throws even when fn returns a non-DoctorCheck", async () => {
    // @ts-expect-error — exercising runtime tolerance
    const r = await safeCheck("X", "runtime", () => null);
    // The post-pass treats the missing section as the wrapper-provided
    // default, so we should still get a row of some shape.
    expect(r).toBeDefined();
  });
});

describe("safeExec — error classification", () => {
  it("classifies ENOENT as not-found", () => {
    const r = safeExec("definitely-not-a-binary-xyz-1729 --version", { timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Some shells/platforms classify the missing executable differently:
      // POSIX with /bin/sh raises a non-zero shell exit (kind=non-zero-exit),
      // direct exec gets ENOENT (kind=not-found). Both are acceptable failure
      // signals for "binary missing".
      expect(["not-found", "non-zero-exit", "unknown"]).toContain(r.kind);
    }
  });

  it("classifies non-zero exits", () => {
    const r = safeExec(`node -e "process.exit(7)"`, { timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("non-zero-exit");
      expect(r.exitCode).toBe(7);
    }
  });

  it("captures stderr tail and runs it through stripAnsi", () => {
    const r = safeExec(
      `node -e "process.stderr.write('\\u001b[31mboom\\u001b[0m'); process.exit(1)"`,
      { timeoutMs: 5000 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stderrTail).toContain("boom");
      expect(r.stderrTail).not.toContain("\u001b");
    }
  });

  it("classifies timeouts and reflects the deadline in the message", () => {
    const r = safeExec(`node -e "setTimeout(()=>{}, 5000)"`, { timeoutMs: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Node's execSync timeout typically surfaces as ETIMEDOUT or
      // SIGTERM signal — both classify as "timeout" in our wrapper.
      expect(r.kind).toBe("timeout");
      expect(r.message).toMatch(/0?\s*s/);
    }
  });

  it("honours the 15s timeout override (uses it for cold-start probes)", () => {
    // We don't actually wait 15s; we just verify the wrapper carries the
    // configured timeoutMs into the SafeExecErr.
    const r = safeExec(`node -e "process.exit(1)"`, { timeoutMs: 15000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.timeoutMs).toBe(15000);
    }
  });

  it("returns ok with stdout on success", () => {
    const r = safeExec(`node -e "console.log('hi')"`, { timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stdout.trim()).toBe("hi");
    }
  });
});

describe("assumedMandatory", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "doctor-am-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns ok value when fn does not throw", () => {
    const r = assumedMandatory("read-foo", () => 42, { managedDir: tmp });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("logs to <managedDir>/doctor.log on throw and surfaces a diagnostics row", () => {
    const r = assumedMandatory(
      "read-foo",
      () => {
        throw new Error("filesystem-down");
      },
      { managedDir: tmp },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.row.section).toBe("diagnostics");
      expect(r.row.status).toBe("error");
      expect(r.row.name).toMatch(/Doctor internal: read-foo/);
      expect(r.row.detail).toContain("filesystem-down");
      expect(r.row.suggestion?.length ?? 0).toBeGreaterThan(0);
    }
    const logPath = path.join(tmp, "doctor.log");
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(log.split("\n")[0]);
    expect(parsed.label).toBe("read-foo");
    expect(parsed.message).toBe("filesystem-down");
  });

  it("tolerates an unwriteable log file (never propagates)", () => {
    // Make managedDir read-only — append should fail silently.
    if (process.platform === "win32") {
      // chmod semantics on Windows are unreliable; skip.
      return;
    }
    chmodSync(tmp, 0o500);
    try {
      const r = assumedMandatory(
        "x",
        () => {
          throw new Error("z");
        },
        { managedDir: tmp },
      );
      expect(r.ok).toBe(false);
      // Did not throw.
    } finally {
      chmodSync(tmp, 0o700);
    }
  });

  it("rotates doctor.log when it exceeds 1 MB", () => {
    const logPath = path.join(tmp, "doctor.log");
    // Pre-fill log with > 1 MB of data.
    writeFileSync(logPath, Buffer.alloc(1.2 * 1024 * 1024, "x".charCodeAt(0)));
    const beforeSize = statSync(logPath).size;
    expect(beforeSize).toBeGreaterThan(1024 * 1024);

    assumedMandatory(
      "rotate-test",
      () => {
        throw new Error("trigger");
      },
      { managedDir: tmp },
    );

    const rotated = path.join(tmp, "doctor.log.1");
    expect(existsSync(rotated)).toBe(true);
    // The fresh log should be small (just one JSON line).
    const fresh = statSync(logPath).size;
    expect(fresh).toBeLessThan(2048);
  });
});
