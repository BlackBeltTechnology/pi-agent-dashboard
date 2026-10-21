/**
 * `tool-renderer` claim fields `expandWhileRunning` / `resultPending`
 * (design D5 item 7): validated and carried through; rejected elsewhere.
 *
 * See change: decouple-plugins-from-core (task 4.5).
 */
import { describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";

const manifest = (claim: Record<string, unknown>) => ({
  id: "subagents",
  displayName: "Subagents",
  priority: 100,
  claims: [{ slot: "tool-renderer", toolName: "Agent", component: "AgentToolRenderer", ...claim }],
});

describe("tool-renderer claim fields", () => {
  it("carries expandWhileRunning:true and resultPending onto the normalized claim", () => {
    const claim = validateManifest(manifest({ expandWhileRunning: true, resultPending: "isAgentResultNotReceived" })).claims[0];
    expect(claim.expandWhileRunning).toBe(true);
    expect(claim.resultPending).toBe("isAgentResultNotReceived");
  });

  it("omits both when absent (no churn for existing claims)", () => {
    const claim = validateManifest(manifest({})).claims[0];
    expect("expandWhileRunning" in claim).toBe(false);
    expect("resultPending" in claim).toBe(false);
  });

  it.each([
    ["expandWhileRunning", "yes"],
    ["resultPending", 7],
  ])("rejects a non-%s value of the wrong type", (field, value) => {
    expect(() => validateManifest(manifest({ [field]: value }))).toThrow(ManifestValidationError);
  });

  it.each(["expandWhileRunning", "resultPending"])("rejects %s on a slot other than tool-renderer, naming plugin and slot", (field) => {
    let err: unknown;
    try {
      validateManifest({
        id: "x",
        displayName: "X",
        priority: 100,
        claims: [{ slot: "settings-section", component: "S", [field]: field === "expandWhileRunning" ? true : "fn" }],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ManifestValidationError);
    expect((err as Error).message).toContain("settings-section");
    expect((err as Error).message).toContain(field);
  });
});
