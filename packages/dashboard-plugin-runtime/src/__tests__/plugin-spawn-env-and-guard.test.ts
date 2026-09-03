/**
 * `pluginSpawnToSessionOptions` — the three plugin-spawn fields that are NOT
 * part of the nested `scope` block:
 *
 *   `env`               arbitrary, non-namespaced spawn env. Complementary to
 *                       `scope.extensionConfig` (which is namespaced into
 *                       `PI_EXT_*`): these keys arrive LITERALLY, which is what
 *                       a consumer reading a fixed key name requires. It is
 *                       AUTHORIZATION-BEARING, so a dropped key fails OPEN.
 *   `guard`             deprecated containment shorthand, forwarded as a marker
 *                       the spawn funnel expands (it, not this package, knows
 *                       the cwd and the host-shipped extension path).
 *   `resumeSessionFile` resume the given transcript instead of a fresh spawn.
 *
 * Same total-mapper contract as the rest of the mapper: untrusted plugin input
 * never throws, and an absent field leaves the result byte-identical.
 * See changes: scope-session-toolset-by-profile, make-invoice-session-canonical,
 * constrain-agent-tool-surface.
 */
import { describe, expect, it } from "vitest";
import { pluginSpawnToSessionOptions } from "../server/server-context.js";

describe("pluginSpawnToSessionOptions — arbitrary env", () => {
  it("forwards a caller env verbatim", () => {
    const out = pluginSpawnToSessionOptions({
      cwd: "/work/acme",
      env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-9", IB_ALLOWED_TOOLS: "ib_status" },
    });
    expect(out.strategy).toBe("headless");
    expect(out.env).toEqual({
      IB_TOOLSET: "scoped-invoice",
      IB_INVOICE_ID: "inv-9",
      IB_ALLOWED_TOOLS: "ib_status",
    });
  });

  it("omits env when the caller supplies none (unchanged)", () => {
    expect(pluginSpawnToSessionOptions({ cwd: "/work/acme", model: "m" })).not.toHaveProperty("env");
  });

  it("keeps the env map SEPARATE from the namespaced extensionConfig channel", () => {
    const out = pluginSpawnToSessionOptions({
      cwd: "/work/acme",
      env: { IB_ALLOWED_TOOLS: "ib_status" },
      scope: { extensionConfig: { guard: { allowedRoots: ["/work/acme"] } } },
    });
    expect(out.env).toEqual({ IB_ALLOWED_TOOLS: "ib_status" });
    expect(out.extensionConfig).toEqual({ guard: { allowedRoots: ["/work/acme"] } });
  });

  it("drops invalid keys/values and never throws on untrusted input", () => {
    const out = pluginSpawnToSessionOptions({
      cwd: "/work/acme",
      // biome-ignore lint/suspicious/noExplicitAny: plugin input is untrusted JS
      env: { GOOD: "v", "": "no-key", BAD: "nul\0byte", NUM: 3 as any, EMPTY_OK: "" },
    });
    expect(out.env).toEqual({ GOOD: "v", EMPTY_OK: "" });
  });

  it("an all-invalid or non-record env leaves no env property", () => {
    // biome-ignore lint/suspicious/noExplicitAny: plugin input is untrusted JS
    expect(pluginSpawnToSessionOptions({ cwd: "/w", env: { BAD: "nul\0" } as any })).not.toHaveProperty("env");
    // biome-ignore lint/suspicious/noExplicitAny: plugin input is untrusted JS
    expect(pluginSpawnToSessionOptions({ cwd: "/w", env: "nope" as any })).not.toHaveProperty("env");
    // biome-ignore lint/suspicious/noExplicitAny: plugin input is untrusted JS
    expect(pluginSpawnToSessionOptions({ cwd: "/w", env: ["a"] as any })).not.toHaveProperty("env");
  });
});

describe("pluginSpawnToSessionOptions — deprecated guard marker", () => {
  it("forwards guard: true for the spawn funnel to expand", () => {
    expect(pluginSpawnToSessionOptions({ cwd: "/work/acme", guard: true }).guard).toBe(true);
  });

  it("only literal true requests containment; absent ⇒ no marker", () => {
    // biome-ignore lint/suspicious/noExplicitAny: plugin input is untrusted JS
    expect(pluginSpawnToSessionOptions({ cwd: "/w", guard: 1 as any })).not.toHaveProperty("guard");
    expect(pluginSpawnToSessionOptions({ cwd: "/w" })).not.toHaveProperty("guard");
  });
});

describe("pluginSpawnToSessionOptions — resumeSessionFile", () => {
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

  it("drops a NUL-bearing resume path instead of forwarding it to spawn", () => {
    // biome-ignore lint/suspicious/noExplicitAny: plugin input is untrusted JS
    const out = pluginSpawnToSessionOptions({ cwd: "/w", resumeSessionFile: "/w/a\0b" as any });
    expect(out).not.toHaveProperty("sessionFile");
  });
});
