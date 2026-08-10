/**
 * Integration: `scanAllSessions()` (no explicit dir arg) resolves its scan
 * root through `getSessionsDir()` → `resolvePiSessionsDir()`.
 *
 * Asserts the config override (`config.json#piSessionsDir`) redirects the
 * scan to a fixture tree, and that with everything unset the scan defaults to
 * `$HOME/.pi/agent/sessions`. HOME is the ephemeral tmp dir the test harness
 * sets, so writing under it is safe.
 *
 * See change: configurable-pi-sessions-dir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanAllSessions } from "../session/session-scanner.js";

vi.mock("../session/session-stats-reader.js", () => ({
  extractSessionStats: vi.fn(() => ({
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    lastTotalTokens: 0,
    contextWindow: 200000,
    model: "anthropic/claude-sonnet-4-20250514",
    thinkingLevel: "medium",
  })),
}));

function writeFixtureSession(root: string, cwdEncoded: string, id: string): void {
  const dir = path.join(root, cwdEncoded);
  fs.mkdirSync(dir, { recursive: true });
  const sf = path.join(dir, `2026-03-30T21-39-43-034Z_${id}.jsonl`);
  fs.writeFileSync(
    sf,
    [
      JSON.stringify({ type: "session", id, cwd: "/fix/cwd", timestamp: "2026-03-30T21:39:43.034Z" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }),
      "",
    ].join("\n"),
  );
}

describe("session-scanner resolves scan dir via config", () => {
  let homeDir: string;

  beforeEach(() => {
    // Sandbox homedir to a temp dir so the test never touches the real ~/.pi,
    // independent of the test harness's HOME guard.
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
    // Isolate from any inherited pi env so the resolver layers are deterministic.
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", "");
    vi.stubEnv("PI_CODING_AGENT_DIR", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("config.json#piSessionsDir redirects scanAllSessions() to a fixture tree", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sessions-fixture-"));
    writeFixtureSession(fixtureRoot, "--fix-cwd--", "fixture-id");

    const configDir = path.join(os.homedir(), ".pi", "dashboard");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ piSessionsDir: fixtureRoot }, null, 2),
    );

    try {
      const result = scanAllSessions();
      expect(result.sessions.map((s) => s.id)).toContain("fixture-id");
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fs.rmSync(path.join(configDir, "config.json"), { force: true });
    }
  });

  it("all unset → scanAllSessions() targets $HOME/.pi/agent/sessions", () => {
    const defaultRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
    writeFixtureSession(defaultRoot, "--default-cwd--", "default-id");

    try {
      const result = scanAllSessions();
      expect(result.sessions.map((s) => s.id)).toContain("default-id");
    } finally {
      fs.rmSync(defaultRoot, { recursive: true, force: true });
    }
  });
});
