/**
 * Role-plane audit: every declared InvoiceBot role must resolve to the pinned
 * spawn model. Reproduces the observed live defect — spawn model and most roles
 * agreed while `rule-authoring` and `validation` pointed at a different
 * provider, with no runtime signal at all.
 *
 * Includes the executable configuration assertion: a role map with every
 * declared role set to `openai-codex/gpt-5.4` audits clean against that pin, and
 * the same map with a foreign-provider role does not.
 * See change: pin-invoicebot-role-models.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditRoleModels, IB_DECLARED_ROLES, readRoleMap } from "../role-models.js";

const PIN = "openai-codex/gpt-5.4";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ib-roles-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Write the deployment's role configuration exactly where pi keeps it. */
function writeProviders(doc: unknown): void {
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "providers.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
}

/** Every declared role assigned `model`. */
const allRoles = (model: string): Record<string, string> =>
  Object.fromEntries(IB_DECLARED_ROLES.map((r) => [r, model]));

describe("IB_DECLARED_ROLES", () => {
  it("declares exactly the InvoiceBot roles the deployment exposes", () => {
    expect([...IB_DECLARED_ROLES]).toEqual([
      "classification",
      "extraction",
      "bank-intake",
      "rule-authoring",
      "validation",
      "fast",
      "smart",
    ]);
  });
});

describe("readRoleMap", () => {
  it("reads the effective roles and the active preset", () => {
    writeProviders({
      roles: allRoles(PIN),
      rolePresets: [{ name: "invoicebot", roles: { classification: PIN } }],
      activePreset: "invoicebot",
    });
    const map = readRoleMap(home);
    expect(map.roles.classification).toBe(PIN);
    expect(map.activePresetName).toBe("invoicebot");
    expect(map.activePresetRoles.classification).toBe(PIN);
  });

  it.each([
    ["missing file", null],
    ["invalid JSON", "{ not json"],
    ["roles not an object", { roles: "nope" }],
    ["empty document", {}],
  ])("returns an empty map for %s instead of throwing", (_label, doc) => {
    if (doc !== null) writeProviders(doc);
    const map = readRoleMap(home);
    expect(map.roles).toEqual({});
    expect(map.activePresetRoles).toEqual({});
  });
});

describe("auditRoleModels", () => {
  it("CONFIGURATION ASSERTION: every declared role on openai-codex/gpt-5.4 audits clean", () => {
    writeProviders({ roles: allRoles(PIN), rolePresets: [{ name: "invoicebot", roles: allRoles(PIN) }], activePreset: "invoicebot" });

    const audit = auditRoleModels(readRoleMap(home), PIN);

    expect(audit.skipped).toBe(false);
    expect(audit.divergent).toEqual([]);
    expect(audit.unset).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(audit.checked).toBe(IB_DECLARED_ROLES.length);
  });

  it("reports exactly the two foreign-provider roles from the live defect", () => {
    writeProviders({
      roles: { ...allRoles(PIN), "rule-authoring": "deepseek/deepseek-v4-pro", validation: "deepseek/deepseek-v4-pro" },
    });

    const audit = auditRoleModels(readRoleMap(home), PIN);

    expect(audit.ok).toBe(false);
    expect(audit.divergent.map((d) => d.role).sort()).toEqual(["rule-authoring", "validation"]);
    for (const d of audit.divergent) {
      expect(d.assigned).toBe("deepseek/deepseek-v4-pro");
      expect(d.surface).toBe("roles");
    }
  });

  it("flags an Anthropic role assignment too (provider-agnostic rule)", () => {
    writeProviders({ roles: { ...allRoles(PIN), extraction: "anthropic/claude-opus-4-8" } });
    const audit = auditRoleModels(readRoleMap(home), PIN);
    expect(audit.divergent).toHaveLength(1);
    expect(audit.divergent[0]).toMatchObject({ role: "extraction", assigned: "anthropic/claude-opus-4-8" });
  });

  it("distinguishes an unset role from a divergent one", () => {
    writeProviders({ roles: { ...allRoles(PIN), smart: "", fast: "deepseek/deepseek-v4-pro" } });
    const audit = auditRoleModels(readRoleMap(home), PIN);
    expect(audit.unset).toEqual(["smart"]);
    expect(audit.divergent.map((d) => d.role)).toEqual(["fast"]);
    expect(audit.ok).toBe(false);
  });

  it("treats a whitespace-only difference as equal, not divergent", () => {
    writeProviders({ roles: { ...allRoles(PIN), classification: `  ${PIN} ` } });
    expect(auditRoleModels(readRoleMap(home), PIN).ok).toBe(true);
  });

  it("catches a divergent ACTIVE PRESET even when the effective map is clean", () => {
    writeProviders({
      roles: allRoles(PIN),
      rolePresets: [{ name: "invoicebot", roles: { ...allRoles(PIN), validation: "deepseek/deepseek-v4-pro" } }],
      activePreset: "invoicebot",
    });

    const audit = auditRoleModels(readRoleMap(home), PIN);

    expect(audit.ok).toBe(false);
    expect(audit.divergent).toHaveLength(1);
    expect(audit.divergent[0]).toMatchObject({ role: "validation", surface: "activePreset" });
  });

  it("ignores presets that are not active", () => {
    writeProviders({
      roles: allRoles(PIN),
      rolePresets: [{ name: "other", roles: { validation: "deepseek/deepseek-v4-pro" } }],
      activePreset: "invoicebot",
    });
    expect(auditRoleModels(readRoleMap(home), PIN).ok).toBe(true);
  });

  it("skips the audit when nothing is pinned (no reference to compare against)", () => {
    writeProviders({ roles: { classification: "deepseek/deepseek-v4-pro" } });
    const audit = auditRoleModels(readRoleMap(home), undefined);
    expect(audit.skipped).toBe(true);
    expect(audit.divergent).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("never throws on a malformed pin", () => {
    writeProviders({ roles: allRoles(PIN) });
    expect(() => auditRoleModels(readRoleMap(home), "no-provider")).not.toThrow();
    expect(auditRoleModels(readRoleMap(home), "no-provider").skipped).toBe(true);
  });
});
