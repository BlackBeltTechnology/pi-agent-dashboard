/**
 * The plugin `spawnSession` host hook maps PluginSpawnOptions → spawnPiSession
 * options via `pluginSpawnToSessionOptions`. Proves `env` is forwarded when
 * present and omitted when absent (additive; absent ⇒ unchanged).
 * See change: scope-session-toolset-by-profile.
 */
import { describe, expect, it } from "vitest";
import { pluginSpawnToSessionOptions } from "../plugin-spawn-options.js";

describe("pluginSpawnToSessionOptions", () => {
  it("forwards a caller env into the spawnPiSession options", () => {
    const out = pluginSpawnToSessionOptions({
      cwd: "/work/acme",
      env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-9" },
    });
    expect(out.strategy).toBe("headless");
    expect(out.env).toEqual({ IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-9" });
  });

  it("omits env when the caller supplies none (unchanged)", () => {
    const out = pluginSpawnToSessionOptions({ cwd: "/work/acme", guard: true, model: "m" });
    expect(out).not.toHaveProperty("env");
    expect(out.guard).toBe(true);
    expect(out.model).toBe("m");
  });

  // §6 re-run: a resumeSessionFile maps to a --continue resume of that transcript.
  // See change: make-invoice-session-canonical.
  it("maps resumeSessionFile to a continue resume (sessionFile + mode)", () => {
    const out = pluginSpawnToSessionOptions({ cwd: "/work/acme", resumeSessionFile: "/work/acme/.s.jsonl" });
    expect(out.sessionFile).toBe("/work/acme/.s.jsonl");
    expect(out.mode).toBe("continue");
  });

  it("omits sessionFile/mode when no resume requested (fresh spawn unchanged)", () => {
    const out = pluginSpawnToSessionOptions({ cwd: "/work/acme" });
    expect(out).not.toHaveProperty("sessionFile");
    expect(out).not.toHaveProperty("mode");
  });
});
