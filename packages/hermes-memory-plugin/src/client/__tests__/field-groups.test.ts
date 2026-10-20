/**
 * Every mirrored hermes field is placed in exactly one settings group, so a
 * re-mirror that adds a field cannot leave it uneditable in the form.
 * See change: resync-hermes-memory-config-0-9.
 */
import { describe, expect, it } from "vitest";
import { KNOWN_KEYS } from "../../shared/hermes-config.js";
import { FIELD_GROUPS } from "../field-groups.js";

describe("FIELD_GROUPS coverage", () => {
  const placed = FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key as string));

  it("places every KNOWN_KEY in a group", () => {
    expect(placed.slice().sort()).toEqual([...KNOWN_KEYS].sort());
  });

  it("places no key twice", () => {
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("gives every field a non-empty label and help text", () => {
    for (const g of FIELD_GROUPS) {
      for (const f of g.fields) {
        expect(f.label.trim(), f.key).not.toBe("");
        expect(f.help.trim(), f.key).not.toBe("");
      }
    }
  });
});

// test-plan #E21 — copy + placement rules (design D8)
describe("E21 FIELD_GROUPS copy rules", () => {
  const meta = (key: string) => FIELD_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key)!;
  const groupOf = (key: string) => FIELD_GROUPS.find((g) => g.fields.some((f) => f.key === key))?.title;

  it("places each of the 12 new keys in its design-D8 group", () => {
    const placement: Record<string, string> = {
      lazyInitialization: "Prompt & policy",
      standingInstructionsEnabled: "Prompt & policy",
      flushCompactTimeoutMs: "Flush on compact / shutdown",
      overflowGraceMs: "Overflow & consolidation",
      consolidationChunking: "Overflow & consolidation",
      consolidationChunkChars: "Overflow & consolidation",
      consolidationUsageSignals: "Overflow & consolidation",
      autoConsolidationWarnOnFailure: "Overflow & consolidation",
      llmFallbackModels: "Child LLM (background subprocess)",
      quickCheckOnOpen: "Storage & search",
      usageHitTrackingEnabled: "Storage & search",
      sessionRetentionDays: "Storage & search",
    };
    for (const [key, title] of Object.entries(placement)) expect(groupOf(key), key).toBe(title);
  });

  it("states the destructive / disabling semantics in help text", () => {
    expect(meta("sessionRetentionDays").help).toMatch(/permanently delet/i);
    expect(meta("flushCompactTimeoutMs").help).toMatch(/0 or less disables/i);
    expect(meta("autoConsolidate").help).toMatch(/ignored while Overflow strategy is set/);
  });

  it("uses no spawn wording (ui-terminology)", () => {
    for (const g of FIELD_GROUPS) {
      for (const f of g.fields) {
        expect(`${f.label} ${f.help}`, f.key).not.toMatch(/\bspawn(ed|s)?\b|respawn/i);
      }
    }
  });
});

