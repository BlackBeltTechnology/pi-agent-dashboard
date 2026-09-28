/**
 * pi-ai module-shape detection (design D2).
 *
 * BOTH branches are positively identified. "not legacy ⇒ factory" is never
 * inferred — an unrecognized module is rejected with the members that are
 * missing, so a third generation surfaces as a diagnosable error rather than
 * a silently wrong catalogue.
 *
 * See change: adopt-piai-factory-api-registry.
 */

/** The seven global-registry members every ≤0.75.x pi-ai exports. */
export const LEGACY_MEMBERS = [
  "registerBuiltInApiProviders",
  "getModels",
  "getProviders",
  "getModel",
  "registerApiProvider",
  "unregisterApiProviders",
  "streamSimple",
] as const;

/** The factory-API markers every ≥0.85 pi-ai exports. */
export const FACTORY_MEMBERS = ["createModels", "createProvider"] as const;

export type Detection =
  | { kind: "legacy" }
  | { kind: "factory" }
  | { kind: "unrecognized"; reason: string };

function fnMembers(mod: unknown, names: readonly string[]): { present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  const rec = (mod ?? {}) as Record<string, unknown>;
  for (const n of names) {
    if (typeof rec[n] === "function") present.push(n);
    else missing.push(n);
  }
  return { present, missing };
}

/**
 * Classify a resolved pi-ai module.
 *
 * - `legacy` iff all seven global members are functions.
 * - `factory` iff `createModels` AND `createProvider` are functions AND no
 *   legacy member is present.
 * - otherwise `unrecognized`, naming what is missing or conflicting.
 */
export function detectPiAiShape(mod: unknown): Detection {
  if (mod === null || (typeof mod !== "object" && typeof mod !== "function")) {
    return { kind: "unrecognized", reason: `pi-ai module is not an object (got ${mod === null ? "null" : typeof mod})` };
  }

  const legacy = fnMembers(mod, LEGACY_MEMBERS);
  const factory = fnMembers(mod, FACTORY_MEMBERS);

  if (legacy.missing.length === 0) return { kind: "legacy" };

  if (factory.missing.length === 0) {
    if (legacy.present.length > 0) {
      return {
        kind: "unrecognized",
        reason:
          `pi-ai module exposes the factory API (${FACTORY_MEMBERS.join(", ")}) ` +
          `but also ${legacy.present.length} legacy global member(s): ${legacy.present.join(", ")}. ` +
          "Neither generation can be assumed.",
      };
    }
    return { kind: "factory" };
  }

  if (legacy.present.length > 0) {
    return {
      kind: "unrecognized",
      reason:
        `pi-ai module looks legacy but is missing ${legacy.missing.length} required member(s): ` +
        `${legacy.missing.join(", ")} (present: ${legacy.present.join(", ")}).`,
    };
  }

  if (factory.present.length > 0) {
    return {
      kind: "unrecognized",
      reason:
        `pi-ai module looks factory-shaped but is missing ${factory.missing.join(", ")} ` +
        `(present: ${factory.present.join(", ")}).`,
    };
  }

  return {
    kind: "unrecognized",
    reason:
      "pi-ai module exposes neither the legacy global API " +
      `(${LEGACY_MEMBERS.join(", ")}) nor the factory API (${FACTORY_MEMBERS.join(", ")}).`,
  };
}
