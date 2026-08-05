/**
 * `resolveActivation()` sits on the `/api/pi-resources` critical path and can
 * perform network I/O for temporary git sources, so it is bounded by
 * `RESOLVE_TIMEOUT_MS`. Expiry must read exactly like a throw — `null`, which
 * the scanner reports as degraded — rather than hanging the payload.
 *
 * Every scanner test injects its own resolver, so this is the only coverage of
 * the real timer path. The seam is the tool registry: `resolveActivation`
 * loads pi through it, so a fake module there exercises the whole function.
 * See change: fix-skill-discovery-parity (test-plan C1).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const resolveModuleMock = vi.fn();
vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({
  getDefaultRegistry: () => ({ resolveModule: (...args: unknown[]) => resolveModuleMock(...args) }),
}));

const { RESOLVE_TIMEOUT_MS, resolveActivation } = await import("../pi/pi-resource-activation.js");

/** Make the registry hand back a pi core whose `resolve()` behaves as `impl`. */
function withPiResolve(impl: () => Promise<unknown>) {
  resolveModuleMock.mockResolvedValue({
    module: {
      SettingsManager: { create: () => ({}) },
      DefaultPackageManager: class {
        resolve() {
          return impl();
        }
      },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  resolveModuleMock.mockReset();
});

describe("resolveActivation timeout (C1)", () => {
  it("bounds resolve() at 5 seconds", () => {
    expect(RESOLVE_TIMEOUT_MS).toBe(5000);
  });

  it("returns null when resolve() never settles", async () => {
    withPiResolve(() => new Promise(() => {}));
    vi.useFakeTimers();

    const pending = resolveActivation("/some/cwd", "/agent/dir");
    // Let the awaited pi load settle before the timer fires.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS + 1);

    await expect(pending).resolves.toBeNull();
  });

  it("returns the resolved paths when resolve() settles in time", async () => {
    const paths = { extensions: [], skills: [], prompts: [], themes: [] };
    withPiResolve(async () => paths);

    await expect(resolveActivation("/some/cwd", "/agent/dir")).resolves.toEqual(paths);
  });

  it("returns null when resolve() throws", async () => {
    withPiResolve(async () => {
      throw new Error("pi is unavailable");
    });

    await expect(resolveActivation("/some/cwd", "/agent/dir")).resolves.toBeNull();
  });

  it("returns null when pi itself cannot be loaded", async () => {
    resolveModuleMock.mockRejectedValue(new Error("pi not installed"));

    await expect(resolveActivation("/some/cwd", "/agent/dir")).resolves.toBeNull();
  });
});
