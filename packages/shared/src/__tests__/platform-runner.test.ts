/**
 * Tests for packages/shared/src/platform/runner.ts — the Recipe engine.
 * Uses real subprocess execution against node itself (always available)
 * so we test the full pipeline: resolve → spawn → parse → Result.
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { run, unwrap, resetResolverCache, type Recipe } from "../platform/runner.js";

// A trivial Recipe that runs `node --version` and returns the version string.
const NODE_VERSION: Recipe<Record<string, never>, string> = {
  argv: () => [process.execPath, "--version"],
  parse: (stdout) => stdout.trim(),
};

// A Recipe that runs `node -e "process.exit(N)"` where N comes from input.
const NODE_EXIT: Recipe<{ code: number }, string> = {
  argv: ({ code }) => [process.execPath, "-e", `process.exit(${code})`],
  parse: (stdout) => stdout.trim(),
};

// A Recipe that uses tolerate to accept exit 1.
const NODE_EXIT_1_TOLERATED: Recipe<Record<string, never>, string> = {
  argv: () => [process.execPath, "-e", "process.exit(1)"],
  parse: (stdout) => stdout.trim() || "exited-1-but-ok",
  tolerate: [1],
};

// A Recipe that times out (sleeps 10s, we allow 100ms).
const NODE_SLEEP_LONG: Recipe<Record<string, never>, string> = {
  argv: () => [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
  parse: (stdout) => stdout,
  timeout: 100,
};

// A Recipe pointing at a binary that cannot be on PATH.
const NONEXISTENT_BINARY: Recipe<Record<string, never>, string> = {
  argv: () => ["this-binary-does-not-exist-12345abcde", "--help"],
  parse: (stdout) => stdout,
};

describe("run()", () => {
  beforeEach(() => {
    resetResolverCache();
  });

  it("executes a successful recipe and returns parsed value", () => {
    const result = run(NODE_VERSION, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/^v\d+\.\d+\.\d+/);
    }
  });

  it("returns { ok: false, error: not-found } when binary is missing", () => {
    const result = run(NONEXISTENT_BINARY, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not-found");
      if (result.error.kind === "not-found") {
        expect(result.error.binary).toBe("this-binary-does-not-exist-12345abcde");
      }
    }
  });

  it("returns { ok: false, error: exit } when subprocess exits non-zero (not tolerated)", () => {
    const result = run(NODE_EXIT, { code: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("exit");
      if (result.error.kind === "exit") {
        expect(result.error.code).toBe(42);
      }
    }
  });

  it("returns { ok: true } when non-zero exit code is in recipe.tolerate", () => {
    const result = run(NODE_EXIT_1_TOLERATED, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("exited-1-but-ok");
    }
  });

  it("returns { ok: false, error: timeout } when subprocess exceeds timeout", () => {
    const result = run(NODE_SLEEP_LONG, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
      if (result.error.kind === "timeout") {
        expect(result.error.timeoutMs).toBe(100);
      }
    }
  }, 2000);

  it("ctx.timeout overrides recipe.timeout", () => {
    // Recipe says 100ms, context says 10s — a 500ms subprocess should succeed.
    const FAST: Recipe<Record<string, never>, string> = {
      argv: () => [process.execPath, "-e", "setTimeout(() => process.exit(0), 200)"],
      parse: () => "ok",
      timeout: 50, // would cause timeout without override
    };
    const result = run(FAST, {}, { timeout: 5000 });
    expect(result.ok).toBe(true);
  }, 10000);

  it("caches binary resolution across calls", () => {
    // First call resolves + caches
    const a = run(NODE_VERSION, {});
    expect(a.ok).toBe(true);
    // Second call reuses cache — behavior identical
    const b = run(NODE_VERSION, {});
    expect(b.ok).toBe(true);
  });

  it("resetResolverCache forces re-resolution", () => {
    const a = run(NODE_VERSION, {});
    expect(a.ok).toBe(true);
    resetResolverCache();
    const b = run(NODE_VERSION, {});
    expect(b.ok).toBe(true);
  });

  it("passes cwd from ctx to the subprocess", () => {
    const PWD: Recipe<Record<string, never>, string> = {
      argv: () => [process.execPath, "-e", "process.stdout.write(process.cwd())"],
      parse: (out) => out.trim(),
    };
    const result = run(PWD, {}, { cwd: process.cwd() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Normalize separators for cross-platform comparison
      const normalizedOut = result.value.replace(/\\/g, "/").toLowerCase();
      const normalizedCwd = process.cwd().replace(/\\/g, "/").toLowerCase();
      expect(normalizedOut).toBe(normalizedCwd);
    }
  });

  it("passes env from ctx to the subprocess (merged over process.env)", () => {
    const PRINT_ENV: Recipe<Record<string, never>, string> = {
      argv: () => [process.execPath, "-e", "process.stdout.write(process.env.TEST_VAR_RUNNER || 'unset')"],
      parse: (out) => out.trim(),
    };
    const result = run(PRINT_ENV, {}, { env: { TEST_VAR_RUNNER: "hello-from-ctx" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("hello-from-ctx");
    }
  });

  it("rejects recipes with empty argv", () => {
    const EMPTY: Recipe<Record<string, never>, string> = {
      argv: () => [],
      parse: () => "",
    };
    const result = run(EMPTY, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("spawn-failure");
    }
  });
});

describe("unwrap()", () => {
  it("returns value on success", () => {
    expect(unwrap({ ok: true, value: 42 }, 0)).toBe(42);
  });

  it("returns fallback on error", () => {
    expect(unwrap({ ok: false, error: { kind: "not-found", binary: "x" } }, 99)).toBe(99);
  });
});
