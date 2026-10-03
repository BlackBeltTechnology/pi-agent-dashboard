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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardCredentialStore } from "../../auth/dashboard-credential-store.js";
import { readAuthJson, writeCredential } from "../../auth/provider-auth-storage.js";

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
  it("sequential writes produce valid JSON with all fields", async () => {
    // Write provider A from "dashboard" side
    await writeCredential("anthropic", { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3600_000 });
    // Write provider B from "bridge" side (simulated as a second writeCredential)
    await writeCredential("openai", { type: "api_key", key: "sk-test" });

    const data = readAuthJson();
    expect(data["anthropic"]).toBeDefined();
    expect(data["openai"]).toBeDefined();
    expect(data["anthropic"].type).toBe("oauth");
    expect(data["openai"].type).toBe("api_key");
  });

  it("concurrent writes from two 'processes' leave valid JSON", async () => {
    // Pre-populate with initial state
    await writeCredential("anthropic", { type: "oauth", refresh: "r0", access: "a0", expires: Date.now() + 100 });
    await writeCredential("openai", { type: "api_key", key: "sk-old" });

    // Simulate two concurrent writes. The write is chained to the outer promise
    // so a rejection fails this test loudly instead of leaving it pending on an
    // unhandled rejection and timing out.
    const write1 = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        writeCredential("anthropic", { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3600_000 })
          .then(resolve, reject);
      }, 0);
    });

    const write2 = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        writeCredential("openai", { type: "api_key", key: "sk-new" }).then(resolve, reject);
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

  it("overlapping provider write: last writer wins, other provider preserved", async () => {
    // Initial state
    await writeCredential("anthropic", { type: "oauth", refresh: "r0", access: "a0", expires: 1 });
    await writeCredential("gemini", { type: "api_key", key: "gk-original" });

    // Refresh anthropic (simulates InternalAuthStorage OAuth refresh)
    await writeCredential("anthropic", { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3600_000 });

    const data = readAuthJson();
    // anthropic updated
    expect((data["anthropic"] as any).refresh).toBe("r1");
    // gemini unchanged
    expect((data["gemini"] as any).key).toBe("gk-original");
  });
});

/**
 * test-plan #X3 — a runtime-triggered persist killed between the temp write
 * and the rename leaves auth.json holding the previous complete JSON (the
 * persist is an atomic tmp+rename, never an in-place rewrite).
 * See change: collapse-model-proxy-onto-modelruntime (D1).
 */
describe("runtime-triggered persist is atomic (X3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("X3: a crash between temp write and rename leaves the previous complete auth.json", async () => {
    const previous = {
      anthropic: { type: "oauth", access: "a0", refresh: "r0", expires: Date.now() - 1 },
      openai: { type: "api_key", key: "sk-keep" },
    };
    fs.writeFileSync(AUTH_PATH, `${JSON.stringify(previous, null, 2)}\n`, { mode: 0o600 });
    const before = fs.readFileSync(AUTH_PATH, "utf-8");

    // "Process killed" at the rename: the temp file is fully written, the
    // rename never happens.
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("simulated kill before rename"), { code: "EKILLED" });
    });
    const store = new DashboardCredentialStore();
    await expect(
      store.modify("anthropic", async () => ({ type: "oauth", access: "a1", refresh: "r1", expires: Date.now() + 3_600_000 })),
    ).rejects.toThrow(/simulated kill/);
    expect(rename).toHaveBeenCalled();

    const after = fs.readFileSync(AUTH_PATH, "utf-8");
    expect(after).toBe(before);
    expect(() => JSON.parse(after)).not.toThrow();
    rename.mockRestore();

    // The next persist completes: the file holds the NEW complete JSON.
    await store.modify("anthropic", async () => ({ type: "oauth", access: "a2", refresh: "r2", expires: Date.now() + 3_600_000 }));
    expect(readAuthJson()).toMatchObject({ anthropic: { access: "a2" }, openai: { key: "sk-keep" } });
  });
});
