/**
 * Host cwd-policy registry + `mergeCwdPolicy` (Part B — host-cwd-policy, #475).
 *
 * Covers the registry lifecycle (register / resolve / unregister / drop),
 * canonical-OR-lexical symlink robustness, target bounding (B7), immutability,
 * compose-never-overwrite nesting, and the non-weakening `mergeCwdPolicy`
 * composition algebra. The funnel-integration scenarios (policy → assembled
 * argv) live in `cwd-policy-funnel.test.ts`.
 *
 * See change: add-plugin-spawn-scope (Part B).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CwdPolicyRegistry,
  CwdPolicyRejectedError,
  mergeCwdPolicy,
} from "../cwd-policy.js";

// Fake workspace roots so target-bounding (B7) accepts the synthetic paths the
// registry unit tests use. Real symlink tests add their tmp root separately.
const FAKE_ROOTS = ["/w", "/work", "/projects", "/real", "/alias", "/work-link"];

function makeRegistry(extraRoots: string[] = []): CwdPolicyRegistry {
  return new CwdPolicyRegistry({
    recognizedRoots: () => [...FAKE_ROOTS, ...extraRoots],
    // Force POSIX-style case sensitivity for deterministic assertions.
    caseInsensitive: false,
    homedir: () => "/home/tester",
  });
}

describe("mergeCwdPolicy — non-weakening composition algebra", () => {
  it("CE15: allowlist intersection tightens the caller", () => {
    const merged = mergeCwdPolicy({ tools: ["read", "grep"] }, { tools: ["read", "grep", "write"] });
    expect(merged.tools).toEqual(["read", "grep"]);
    expect(merged.tools).not.toContain("write");
  });

  it("CE16: caller cannot widen a host ban", () => {
    const merged = mergeCwdPolicy({ noTools: true }, { noTools: false, tools: ["read"] });
    expect(merged.noTools).toBe(true);
  });

  it("CE17: denylist union", () => {
    const merged = mergeCwdPolicy({ excludeTools: ["exec"] }, { excludeTools: ["write"] });
    expect(merged.excludeTools).toEqual(expect.arrayContaining(["write", "exec"]));
    expect(merged.excludeTools).toHaveLength(2);
  });

  it("CE18: sticky-true booleans", () => {
    expect(mergeCwdPolicy({ noBuiltinTools: true }, {}).noBuiltinTools).toBe(true);
    expect(mergeCwdPolicy({}, { noBuiltinTools: true }).noBuiltinTools).toBe(true);
  });

  it("CE19: policy allowlist applies when the caller omits tools", () => {
    const merged = mergeCwdPolicy({ tools: ["read"] }, {});
    expect(merged.tools).toEqual(["read"]);
  });

  it("CE20: composition is order-independent across 3+ ancestors", () => {
    const p1 = { noTools: true };
    const p2 = { excludeTools: ["a"] };
    const p3 = { excludeTools: ["b"] };
    const forward = mergeCwdPolicy(p3, mergeCwdPolicy(p2, mergeCwdPolicy(p1, {})));
    const reverse = mergeCwdPolicy(p1, mergeCwdPolicy(p2, mergeCwdPolicy(p3, {})));
    expect(forward.noTools).toBe(true);
    expect(reverse.noTools).toBe(true);
    expect([...(forward.excludeTools ?? [])].sort()).toEqual(["a", "b"]);
    expect([...(reverse.excludeTools ?? [])].sort()).toEqual(["a", "b"]);
  });

  it("CE21: empty policy is identity (returns options unchanged)", () => {
    const options = { tools: ["read"], noSkills: true };
    const merged = mergeCwdPolicy({}, options);
    expect(merged).toBe(options);
  });
});

describe("CwdPolicyRegistry — register / resolve", () => {
  it("CE1: register then resolve carries the policy", () => {
    const reg = makeRegistry();
    reg.register("p1", "/w/secrets", { noTools: true });
    expect(reg.resolve("/w/secrets")?.noTools).toBe(true);
  });

  it("CE6: plugin-supplied extension fields are rejected (registers nothing)", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.register("p1", "/w/secrets", { noTools: true, extensions: ["/evil.js"] } as unknown),
    ).toThrow(CwdPolicyRejectedError);
    expect(reg.resolve("/w/secrets")).toBeUndefined();
  });

  it("CE6b: extensionConfig field is also rejected", () => {
    const reg = makeRegistry();
    expect(() =>
      reg.register("p1", "/w/secrets", { noTools: true, extensionConfig: { x: { k: "v" } } } as unknown),
    ).toThrow(CwdPolicyRejectedError);
    expect(reg.resolve("/w/secrets")).toBeUndefined();
  });

  it("CE7: overly-broad targets (fs root, home, non-workspace) are rejected", () => {
    const reg = makeRegistry();
    expect(() => reg.register("p1", "/", { noTools: true })).toThrow(CwdPolicyRejectedError);
    expect(() => reg.register("p1", "/home/tester", { noTools: true })).toThrow(CwdPolicyRejectedError);
    expect(() => reg.register("p1", "/etc/somewhere", { noTools: true })).toThrow(CwdPolicyRejectedError);
    expect(reg.resolve("/etc/somewhere")).toBeUndefined();
  });

  it("CE8: registered policy is immutable after registration", () => {
    const reg = makeRegistry();
    const arr = ["read"];
    reg.register("p1", "/w/secrets", { tools: arr });
    arr.push("exec");
    expect(reg.resolve("/w/secrets")?.tools).toEqual(["read"]);
  });

  it("CE24: sibling prefix does not false-match", () => {
    const reg = makeRegistry(["/work-shop"]);
    reg.register("p1", "/work", { noTools: true });
    expect(reg.resolve("/work-shop/app")).toBeUndefined();
  });

  it("CE22: broad ban survives a narrow looser registration", () => {
    const reg = makeRegistry();
    reg.register("p1", "/work", { noTools: true });
    reg.register("p1", "/work/secrets", { tools: ["read"] });
    const resolved = reg.resolve("/work/secrets/deep");
    expect(resolved?.noTools).toBe(true);
  });

  it("CE23: same-path second registration composes, not replaces", () => {
    const reg = makeRegistry();
    reg.register("p1", "/w/secrets", { excludeTools: ["exec"] });
    reg.register("p1", "/w/secrets", { excludeTools: ["write"] });
    expect(reg.resolve("/w/secrets")?.excludeTools).toEqual(expect.arrayContaining(["exec", "write"]));
  });

  it("CE25: no plugin-path registration produces an extension-bearing policy", () => {
    const reg = makeRegistry();
    reg.register("p1", "/w/secrets", { noTools: true });
    const resolved = reg.resolve("/w/secrets") as Record<string, unknown>;
    expect(resolved).not.toHaveProperty("extensions");
    expect(resolved).not.toHaveProperty("extensionConfig");
  });
});

describe("CwdPolicyRegistry — unregister / drop (owner-scoped)", () => {
  it("CE9: unregister removes only the caller's entry", () => {
    const reg = makeRegistry();
    reg.register("A", "/w/secrets", { noTools: true });
    reg.register("B", "/w/secrets", { noBuiltinTools: true });
    reg.unregister("B", "/w/secrets");
    const resolved = reg.resolve("/w/secrets");
    expect(resolved?.noTools).toBe(true);
    expect(resolved?.noBuiltinTools).toBeUndefined();
  });

  it("CE10: unregister an unregistered cwd is a no-op", () => {
    const reg = makeRegistry();
    reg.register("A", "/w/secrets", { noTools: true });
    expect(() => reg.unregister("A", "/never/registered")).not.toThrow();
    expect(reg.resolve("/w/secrets")?.noTools).toBe(true);
  });

  it("CE11: dropPlugin drops all of a plugin's policies", () => {
    const reg = makeRegistry();
    reg.register("A", "/w/secrets", { noTools: true });
    reg.dropPlugin("A");
    expect(reg.resolve("/w/secrets")).toBeUndefined();
  });

  it("CE5: an untrusted plugin (host gate no-op) registers nothing", () => {
    // The trust gate lives in the host (server.ts): a trusted plugin's hook
    // calls reg.register, an untrusted plugin's hook is a no-op. We model both
    // and assert the untrusted path leaves the registry (and any later spawn)
    // untouched — mirroring the server-context-provider-auth convention.
    const reg = makeRegistry();
    const makeRegisterHook = (trusted: boolean) => (cwd: string, policy: unknown) => {
      if (!trusted) return;
      reg.register("plug", cwd, policy);
    };
    makeRegisterHook(false)("/w/secrets", { noTools: true });
    expect(reg.resolve("/w/secrets")).toBeUndefined();
    makeRegisterHook(true)("/w/secrets", { noTools: true });
    expect(reg.resolve("/w/secrets")?.noTools).toBe(true);
  });
});

describe("CwdPolicyRegistry — symlink robustness (canonical OR lexical)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "cwd-policy-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("CE2: a policy registered through a symlink applies to the real path", () => {
    const real = path.join(tmp, "real-secrets");
    const alias = path.join(tmp, "alias-secrets");
    mkdirSync(real);
    symlinkSync(real, alias);
    const reg = new CwdPolicyRegistry({
      recognizedRoots: () => [tmp],
      caseInsensitive: false,
      homedir: () => "/home/tester",
    });
    reg.register("p1", alias, { noTools: true });
    // Spawn lands in the real (symlink-resolved) path.
    expect(reg.resolve(real)?.noTools).toBe(true);
  });

  it("CE3: a policy for a not-yet-created dir under a symlinked ancestor matches", () => {
    const realWork = path.join(tmp, "real-work");
    const workLink = path.join(tmp, "work-link");
    mkdirSync(realWork);
    symlinkSync(realWork, workLink);
    const reg = new CwdPolicyRegistry({
      recognizedRoots: () => [tmp],
      caseInsensitive: false,
      homedir: () => "/home/tester",
    });
    // Register BEFORE the child dir exists.
    reg.register("p1", path.join(workLink, "new"), { noTools: true });
    // Now create it and spawn there (via the real path).
    mkdirSync(path.join(realWork, "new"));
    expect(reg.resolve(path.join(realWork, "new"))?.noTools).toBe(true);
  });

  it("CE4: a symlink swap does not fail open (lexical match still applies)", () => {
    const target = path.join(tmp, "target");
    const elsewhere = path.join(tmp, "elsewhere");
    mkdirSync(target);
    mkdirSync(elsewhere);
    const reg = new CwdPolicyRegistry({
      recognizedRoots: () => [tmp],
      caseInsensitive: false,
      homedir: () => "/home/tester",
    });
    reg.register("p1", target, { noTools: true });
    // Replace the real dir with a symlink pointing elsewhere.
    rmSync(target, { recursive: true, force: true });
    symlinkSync(elsewhere, target);
    // The tightening floor must STILL apply (lexical match) — never fail open.
    expect(reg.resolve(target)?.noTools).toBe(true);
    unlinkSync(target);
  });
});
