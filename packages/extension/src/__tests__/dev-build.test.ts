import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDevBuild } from "../dev-build.js";

describe("runDevBuild", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let mockExecSync: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecSync = vi.fn();
    mockFetch = vi.fn().mockReturnValue(Promise.resolve({ ok: true }));
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function run(overrides: Partial<Parameters<typeof runDevBuild>[0]> = {}) {
    runDevBuild({
      packageRoot: "/my/project",
      serverPort: 8000,
      _execSync: mockExecSync as any,
      _fetch: mockFetch as any,
      _token: "dev-build-test-token",
      ...overrides,
    });
  }

  it("should build client and request server shutdown", () => {
    run();

    expect(mockExecSync).toHaveBeenCalledWith("npm run build", {
      cwd: "/my/project",
      stdio: "inherit",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/shutdown",
      { method: "POST", headers: { "X-Pi-Local-Proof": expect.stringMatching(/^v1\./) } },
    );
  });

  it("sends no proof header when this host has no local token", () => {
    run({ _token: undefined });
    expect(mockFetch).toHaveBeenCalledWith("http://127.0.0.1:8000/api/shutdown", { method: "POST", headers: {} });
  });

  it("should log progress messages", () => {
    run();

    const logs = logSpy.mock.calls.map((c: any) => c[0]);
    expect(logs).toContain("🔨 Dashboard: building client...");
    expect(logs).toContain("✅ Dashboard: client built");
    expect(logs).toContain("🛑 Dashboard: stopping server...");
    expect(logs).toContain("✅ Dashboard: server stopped");
  });

  it("should continue with shutdown even if build fails", () => {
    mockExecSync.mockImplementation(() => { throw new Error("build error"); });

    run();

    const logs = logSpy.mock.calls.map((c: any) => c[0]);
    expect(logs).toContain("❌ Dashboard: build failed — build error");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/shutdown",
      { method: "POST", headers: { "X-Pi-Local-Proof": expect.stringMatching(/^v1\./) } },
    );
  });

  it("should not throw if fetch fails synchronously", () => {
    mockFetch.mockImplementation(() => { throw new Error("connection refused"); });

    expect(() => run()).not.toThrow();
  });

  it("should use custom serverPort", () => {
    run({ serverPort: 3000 });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/shutdown",
      { method: "POST", headers: { "X-Pi-Local-Proof": expect.stringMatching(/^v1\./) } },
    );
  });
});
