/**
 * Close-policy declaration on the pending-plugin-ref seam (test-plan #E1, #E2,
 * #E3): `close` is validated when filed (finite integer `afterMs` >= 1000,
 * mode sleep|archive, default sleep), an invalid block is dropped with a
 * warning naming plugin id + spawn token, and a `pluginRef` body can never set
 * the core-owned `closePolicy`.
 * See change: add-session-close-plugin-hook.
 */
import { describe, expect, it } from "vitest";
import {
  createPendingPluginRefRegistry,
  normalizeCloseDeclaration,
} from "../pending-plugin-ref-registry.js";

function registry() {
  const warnings: string[] = [];
  const reg = createPendingPluginRefRegistry({ warn: (m) => warnings.push(m) });
  return { reg, warnings };
}

describe("close declaration validation", () => {
  it.each([
    [1000, true],
    [1_800_000, true],
    [999, false],
    [1000.5, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.NaN, false],
    ["30", false],
  ])("E1: afterMs %s accepted=%s (test-plan #E1)", (afterMs, accepted) => {
    const { reg, warnings } = registry();
    reg.file("tok", {}, "team", { close: { idle: { afterMs: afterMs as number } } });
    const resolved = reg.resolve("tok");
    if (accepted) {
      expect(resolved?.lifecycle?.close).toEqual({ idle: { afterMs }, mode: "sleep" });
      expect(warnings).toEqual([]);
    } else {
      expect(resolved?.lifecycle?.close).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"team"');
      expect(warnings[0]).toContain("tok");
    }
  });

  it("E2: mode partitions — sleep/archive kept, absent ⇒ sleep, unknown dropped (test-plan #E2)", () => {
    expect(normalizeCloseDeclaration({ mode: "sleep" })).toEqual({ mode: "sleep" });
    expect(normalizeCloseDeclaration({ mode: "archive", idle: { afterMs: 5000 } })).toEqual({
      idle: { afterMs: 5000 },
      mode: "archive",
    });
    expect(normalizeCloseDeclaration({ idle: { afterMs: 5000 } })).toEqual({ idle: { afterMs: 5000 }, mode: "sleep" });
    expect(normalizeCloseDeclaration({ mode: "detach" })).toBeNull();
    expect(normalizeCloseDeclaration(undefined)).toBeUndefined();

    const { reg, warnings } = registry();
    reg.file("t2", {}, "team", { recover: false, close: { mode: "detach" as "sleep" } });
    const resolved = reg.resolve("t2");
    expect(resolved?.lifecycle).toEqual({ recover: false });
    expect(warnings).toHaveLength(1);
  });

  it("E2: a valid close-only declaration is filed on its own", () => {
    const { reg } = registry();
    expect(reg.file("t3", {}, "team", { close: { mode: "archive" } })).toBe(true);
    expect(reg.resolve("t3")?.lifecycle?.close).toEqual({ mode: "archive" });
  });

  it("E3: a pluginRef body cannot forge closePolicy (test-plan #E3)", () => {
    const { reg, warnings } = registry();
    reg.file("t4", { closePolicy: { owner: "victim", idleAfterMs: 1000 }, conv: "c1" }, "attacker");
    const resolved = reg.resolve("t4");
    expect(resolved?.ref).toEqual({ conv: "c1" });
    expect(resolved?.lifecycle).toBeUndefined();
    expect(warnings.some((w) => w.includes('"closePolicy"'))).toBe(true);
    // Same boundary on post-spawn merges.
    expect(reg.sanitize({ closePolicy: { owner: "x" } }, "attacker")).toEqual({});
  });
});
