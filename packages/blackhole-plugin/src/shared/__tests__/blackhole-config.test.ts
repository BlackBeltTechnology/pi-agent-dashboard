/**
 * L1 — the validator IS the security boundary (test-plan E1-E14, X10) plus the
 * descriptor drift guard (test-plan drift row / tasks 8.34).
 *
 * See change: add-blackhole-plugin.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  FIELD_DESCRIPTORS,
  KNOWN_KEYS,
  validateBlackholeConfig,
} from "../blackhole-config.js";
import snapshot from "../example-config.snapshot.json" with { type: "json" };

const ok = (body: unknown) => validateBlackholeConfig(body).ok;
const fields = (body: unknown) => validateBlackholeConfig(body).errors.map((e) => e.field);

describe("numeric bounds mirror blackhole's coercers", () => {
  // E1-E4 — observeAfterTokens is positiveInt: integer, strictly > 0.
  it("rejects observeAfterTokens 0 (E1)", () => {
    expect(ok({ observeAfterTokens: 0 })).toBe(false);
  });
  it("accepts observeAfterTokens 1 (E2)", () => {
    expect(ok({ observeAfterTokens: 1 })).toBe(true);
  });
  it("rejects observeAfterTokens -1 (E3)", () => {
    expect(ok({ observeAfterTokens: -1 })).toBe(false);
  });
  it("rejects observeAfterTokens 1.5 as non-integer (E4)", () => {
    const res = validateBlackholeConfig({ observeAfterTokens: 1.5 });
    expect(res.ok).toBe(false);
    expect(res.errors[0].message).toMatch(/integer/);
  });
  it("rejects a non-numeric token count", () => {
    expect(ok({ observeAfterTokens: "lots" })).toBe(false);
  });

  // E5/E6 — cooldownHours is nonNegativeInt: 0 means "disabled".
  it("accepts model cooldownHours 0 as disabled (E5)", () => {
    expect(ok({ observerModel: { provider: "p", id: "m", cooldownHours: 0 } })).toBe(true);
  });
  it("rejects model cooldownHours -1 (E6)", () => {
    expect(ok({ observerModel: { provider: "p", id: "m", cooldownHours: -1 } })).toBe(false);
  });

  // E7-E10 — dropperPressureThreshold is a finite number in (0, 1].
  it("rejects dropperPressureThreshold 0 — the interval is open at 0 (E7)", () => {
    expect(ok({ dropperPressureThreshold: 0 })).toBe(false);
  });
  it("accepts dropperPressureThreshold 1 (E8)", () => {
    expect(ok({ dropperPressureThreshold: 1 })).toBe(true);
  });
  it("rejects dropperPressureThreshold 1.0001 (E9)", () => {
    expect(ok({ dropperPressureThreshold: 1.0001 })).toBe(false);
  });
  it("rejects a non-finite dropperPressureThreshold (E10)", () => {
    expect(ok({ dropperPressureThreshold: Number.NaN })).toBe(false);
    expect(ok({ dropperPressureThreshold: null })).toBe(false);
  });
  it("rejects dropperPressureThreshold 1.8 (spec: bound violation)", () => {
    expect(ok({ dropperPressureThreshold: 1.8 })).toBe(false);
  });

  it("accepts 0 for the keys blackhole treats as nonNegativeInt", () => {
    expect(ok({ observerPreambleMaxTokens: 0 })).toBe(true);
    expect(ok({ providerIdleTimeoutMs: 0 })).toBe(true);
  });
});

describe("enum and type violations", () => {
  it("rejects compaction 'sometimes' (E11)", () => {
    expect(ok({ compaction: "sometimes" })).toBe(false);
  });
  it("accepts compaction 'off' (E12)", () => {
    expect(ok({ compaction: "off" })).toBe(true);
  });
  it("rejects a non-boolean for a boolean key", () => {
    expect(ok({ memory: "yes" })).toBe(false);
  });
  it("rejects a raw PUT body that is not an object (X10)", () => {
    expect(ok(null)).toBe(false);
    expect(ok([])).toBe(false);
    expect(ok("compaction=off")).toBe(false);
  });
});

describe("unknown keys and atomicity", () => {
  it("rejects a key absent from the descriptor map (E13)", () => {
    const res = validateBlackholeConfig({ nonExistentKey: 1 });
    expect(res.ok).toBe(false);
    expect(res.errors[0].message).toMatch(/unknown key/);
  });

  it("rejects a real blackhole key this surface deliberately does not manage", () => {
    // Preserved on write as an unmanaged key — but never accepted from a client.
    expect(ok({ dropperPoolFullnessThreshold: 0.2 })).toBe(false);
    expect(ok({ skipForProviders: ["openai"] })).toBe(false);
  });

  it("reports BOTH keys when one valid and one invalid key are sent (E14)", () => {
    const res = validateBlackholeConfig({ compaction: "off", agentMaxTurns: -3 });
    expect(res.ok).toBe(false);
    // Rejection is atomic: the caller writes nothing at all, so `compaction`
    // never reaches disk either. The route test asserts the file side.
    expect(fields({ compaction: "off", agentMaxTurns: -3 })).toContain("agentMaxTurns");
  });
});

describe("model entries", () => {
  it("requires a non-empty provider and id", () => {
    expect(ok({ observerModel: { provider: "", id: "m" } })).toBe(false);
    expect(ok({ observerModel: { provider: "p", id: "" } })).toBe(false);
    expect(ok({ observerModel: { provider: "p", id: "m" } })).toBe(true);
  });
  it("validates thinking against blackhole's level list", () => {
    expect(ok({ observerModel: { provider: "p", id: "m", thinking: "low" } })).toBe(true);
    expect(ok({ observerModel: { provider: "p", id: "m", thinking: "eager" } })).toBe(false);
  });
  it("requires contextWindow to be a positive integer when present", () => {
    expect(ok({ observerModel: { provider: "p", id: "m", contextWindow: 0 } })).toBe(false);
    expect(ok({ observerModel: { provider: "p", id: "m", contextWindow: 128_000 } })).toBe(true);
  });
  it("carries annotation keys inside a model object", () => {
    expect(ok({ observerModel: { _comment: "kept", provider: "p", id: "m" } })).toBe(true);
  });
  it("rejects an unknown key inside a model object", () => {
    expect(ok({ observerModel: { provider: "p", id: "m", temperature: 0.4 } })).toBe(false);
  });
  it("validates every entry of a fallback array", () => {
    expect(
      ok({ observerFallbackModels: [{ provider: "p", id: "a" }, { provider: "p", id: "b" }] }),
    ).toBe(true);
    expect(ok({ observerFallbackModels: [{ provider: "p", id: "a" }, { id: "b" }] })).toBe(false);
    expect(ok({ observerFallbackModels: {} })).toBe(false);
  });
});

describe("descriptor drift guard (task 8.34)", () => {
  /**
   * Compares our descriptor key set against a VENDORED snapshot of blackhole's
   * `example-config.json` at the pinned version.
   *
   * Honest statement of what this catches: it detects OUR descriptors drifting
   * from the PINNED version, not upstream drift — the snapshot is refreshed by
   * hand when the SOURCE-VERSION PIN is bumped, which is exactly the moment it
   * forces a diff review. It also catches key-SET changes only; a type, enum or
   * bound change to an existing key is invisible here. No network fetch runs in
   * CI by design.
   */
  const ANNOTATION = (k: string) => k.startsWith("_");
  /** Keys blackhole publishes that this surface deliberately leaves unmanaged. */
  const DELIBERATELY_UNMANAGED = new Set(["skipForProviders"]);

  it("every non-annotation snapshot key is either managed or deliberately unmanaged", () => {
    const managed = new Set<string>(KNOWN_KEYS as string[]);
    const uncovered = Object.keys(snapshot as Record<string, unknown>)
      .filter((k) => !ANNOTATION(k))
      .filter((k) => !managed.has(k) && !DELIBERATELY_UNMANAGED.has(k));
    expect(uncovered).toEqual([]);
  });

  it("every deliberately-unmanaged key is genuinely absent from the descriptors", () => {
    for (const k of DELIBERATELY_UNMANAGED) {
      expect(Object.hasOwn(FIELD_DESCRIPTORS, k)).toBe(false);
    }
  });

  it("the snapshot's scalar values validate against our descriptors", () => {
    const managed = new Set<string>(KNOWN_KEYS as string[]);
    const body = Object.fromEntries(
      Object.entries(snapshot as Record<string, unknown>).filter(([k]) => managed.has(k)),
    );
    const res = validateBlackholeConfig(body);
    expect(res.errors).toEqual([]);
  });

  it("DEFAULTS covers every non-model managed key", () => {
    const modelKinds = new Set(["model", "modelArray"]);
    const missing = KNOWN_KEYS.filter(
      (k) =>
        !modelKinds.has(FIELD_DESCRIPTORS[k].kind) &&
        k !== "providerIdleTimeoutMs" &&
        (DEFAULTS as Record<string, unknown>)[k] === undefined,
    );
    expect(missing).toEqual([]);
  });
});
