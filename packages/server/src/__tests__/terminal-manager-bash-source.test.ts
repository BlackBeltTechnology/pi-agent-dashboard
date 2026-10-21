/**
 * PTY env wiring for `windowsBashSource`: the terminal manager feeds its env
 * through `augmentEnvWithGitSource` and hands the result to pty.spawn, so the
 * bundled usr\bin placement (host → last) reaches dashboard terminals.
 * Placement itself is pinned in shared ensure-bundled-git.test.ts; here the
 * real augment is wrapped to pretend win32 + a fake bundle on a POSIX host.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #F3).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => ({ dispose: vi.fn() }),
    onExit: () => ({ dispose: vi.fn() }),
    pid: 4242,
  })),
}));

const win = path.win32.join;
const RES = "C:\\res";
const GIT = win(RES, "git");
const present = new Set(
  [win(GIT, "cmd", "git.exe"), win(GIT, "cmd"), win(GIT, "usr", "bin"), win(GIT, "mingw64"), win(GIT, "mingw64", "bin")].map((p) =>
    p.toLowerCase(),
  ),
);

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git-source.js")>();
  return {
    ...actual,
    augmentEnvWithGitSource: (env: NodeJS.ProcessEnv, which: (c: string) => string | null) =>
      actual.augmentEnvWithGitSource(env, which, {
        platform: "win32",
        resourcesPath: RES,
        exists: (p: string) => present.has(p.toLowerCase()),
      }),
  };
});

const { createTerminalManager } = await import("../terminal/terminal-manager.js");
const git = await import("@blackbelt-technology/pi-dashboard-shared/platform/git-source.js");

describe("terminal-manager PTY env — windowsBashSource (F3)", () => {
  beforeEach(() => {
    git.setWindowsGitSourceSetting("bundled");
    git.invalidateGitSourceCache();
    vi.stubEnv("PATH", "C:\\Windows\\System32;C:\\Tools");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    git.setWindowsGitSourceSetting("auto");
    git.setWindowsBashSourceSetting("bundled");
    git.invalidateGitSourceCache();
  });

  const ptyPath = async (): Promise<string[]> => {
    const pty = await import("node-pty");
    const manager = createTerminalManager({ onExit: () => {} });
    const t = manager.spawn("/tmp");
    const env = vi.mocked(pty.spawn).mock.calls.at(-1)![2]!.env as Record<string, string>;
    manager.kill(t.id);
    return env.PATH.split(";");
  };

  it("host: cmd + libdir first, usr\\bin last", async () => {
    git.setWindowsBashSourceSetting("host");
    const parts = await ptyPath();
    expect(parts[0]).toBe(win(GIT, "cmd"));
    expect(parts[1]).toBe(win(GIT, "mingw64", "bin"));
    expect(parts.at(-1)).toBe(win(GIT, "usr", "bin"));
  });

  it("bundled: usr\\bin ahead of System32", async () => {
    git.setWindowsBashSourceSetting("bundled");
    const parts = await ptyPath();
    expect(parts.slice(0, 3)).toEqual([win(GIT, "cmd"), win(GIT, "usr", "bin"), win(GIT, "mingw64", "bin")]);
  });
});
