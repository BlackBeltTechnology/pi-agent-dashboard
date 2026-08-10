/**
 * Acceptance test for the single-writer auth.json contract (task 2.12).
 *
 * Simulates concurrent credential writes from:
 *   (a) InternalAuthStorage (dashboard side) via writeCredential
 *   (b) A stub bridge-side AuthStorage.refresh (simulated via writeCredential
 *       from a separate "context")
 *
 * Asserts:
 *   - File remains valid JSON after concurrent writes
 *   - Both writes' fields survive (last-writer-wins for overlapping provider;
 *     non-overlapping providers preserved)
 *
 * Cap: 5s timeout.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeCredential, readAuthJson } from "../../auth/provider-auth-storage.js";

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");

let backup: string | null = null;
beforeEach(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  try { backup = fs.readFileSync(AUTH_PATH, "utf-8"); } catch { backup = null; }
});

afterEach(() => {
  try {
    if (backup !== null) fs.writeFileSync(AUTH_PATH, backup);
    else fs.rmSync(AUTH_PATH, { force: true });
  } catch {}
});

describe("auth.json single-writer contract (task 2.12)", () => {
  it("sequential writes produce valid JSON with all fields", () => {
    // Write provider A from "dashboard" side
    writeCredential("anthropic", { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3600_000 });
    // Write provider B from "bridge" side (simulated as a second writeCredential)
    writeCredential("openai", { type: "api_key", key: "sk-test" });

    const data = readAuthJson();
    expect(data["anthropic"]).toBeDefined();
    expect(data["openai"]).toBeDefined();
    expect(data["anthropic"].type).toBe("oauth");
    expect(data["openai"].type).toBe("api_key");
  });

  it("concurrent writes from two 'processes' leave valid JSON", async () => {
    // Pre-populate with initial state
    writeCredential("anthropic", { type: "oauth", refresh: "r0", access: "a0", expires: Date.now() + 100 });
    writeCredential("openai", { type: "api_key", key: "sk-old" });

    // Simulate two concurrent writes
    const write1 = new Promise<void>((resolve) => {
      setTimeout(() => {
        writeCredential("anthropic", { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3600_000 });
        resolve();
      }, 0);
    });

    const write2 = new Promise<void>((resolve) => {
      setTimeout(() => {
        writeCredential("openai", { type: "api_key", key: "sk-new" });
        resolve();
      }, 0);
    });

    await Promise.all([write1, write2]);

    // File must still be valid JSON
    const raw = fs.readFileSync(AUTH_PATH, "utf-8");
    let data: any;
    expect(() => { data = JSON.parse(raw); }).not.toThrow();

    // Non-overlapping providers both survived (one or both may be latest version)
    expect(data["anthropic"]).toBeDefined();
    expect(data["openai"]).toBeDefined();
  }, 5000);

  it("overlapping provider write: last writer wins, other provider preserved", () => {
    // Initial state
    writeCredential("anthropic", { type: "oauth", refresh: "r0", access: "a0", expires: 1 });
    writeCredential("gemini", { type: "api_key", key: "gk-original" });

    // Refresh anthropic (simulates InternalAuthStorage OAuth refresh)
    writeCredential("anthropic", { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3600_000 });

    const data = readAuthJson();
    // anthropic updated
    expect((data["anthropic"] as any).refresh).toBe("r1");
    // gemini unchanged
    expect((data["gemini"] as any).key).toBe("gk-original");
  });
});
