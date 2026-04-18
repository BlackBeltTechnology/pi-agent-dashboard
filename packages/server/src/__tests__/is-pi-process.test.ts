/**
 * Tests for isPiCommandLine (pure predicate used by isPiProcess).
 * See change: fix-windows-server-parity.
 */
import { describe, it, expect } from "vitest";
import { isPiCommandLine } from "../browser-handlers/session-action-handler.js";

describe("isPiCommandLine", () => {
  it("matches a typical pi cli invocation", () => {
    expect(isPiCommandLine("/usr/bin/node /usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js")).toBe(true);
  });

  it("matches when only 'pi' appears as a word", () => {
    expect(isPiCommandLine("pi --mode rpc")).toBe(true);
    expect(isPiCommandLine("/opt/pi/bin/pi")).toBe(true);
  });

  it("matches when only 'node' appears as a word", () => {
    expect(isPiCommandLine("node server.js")).toBe(true);
    expect(isPiCommandLine("/usr/bin/node --import tsx /app.ts")).toBe(true);
  });

  it("does not match unrelated commands", () => {
    expect(isPiCommandLine("/bin/bash -c sleep 10")).toBe(false);
    expect(isPiCommandLine("python3 script.py")).toBe(false);
    expect(isPiCommandLine("")).toBe(false);
  });

  it("does not match substrings of other words", () => {
    // \b word-boundary: 'api', 'epic', 'snode' must NOT match 'pi'/'node'
    expect(isPiCommandLine("api-server --port 8000")).toBe(false);
    expect(isPiCommandLine("epic-game.exe")).toBe(false);
    // 'snode' is actually a whole word containing "node" at the end; \bnode\b requires word boundary
    expect(isPiCommandLine("running snode-worker")).toBe(false);
  });
});
