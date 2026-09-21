/**
 * E28 (task 10.28) — effects: Non-permissive licence rejected.
 *
 * The card schema (`meta.schema.json`) pins `licence` to the permissive SPDX
 * enum, so a card declaring `CC-BY-NC-SA-4.0` (or omitting `licence`) is
 * rejected by the same validator the corpus test runs — naming the licence enum.
 */
import { readFileSync } from "node:fs";
import Ajv, { type ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import { REGISTRY } from "../index.js";
import type { FxCard } from "../types.js";

const cardSchema = JSON.parse(readFileSync(new URL("../meta.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ allErrors: true }).compile(cardSchema);

function errorsFor(card: unknown): ErrorObject[] {
  validate(card);
  return (validate.errors ?? []) as ErrorObject[];
}

const BLOOM = REGISTRY.bloom.card;

describe("E28 non-permissive licences are rejected by the card schema", () => {
  it("accepts every shipped card", () => {
    for (const { card } of Object.values(REGISTRY)) {
      expect(validate(card), `${card.id}: ${JSON.stringify(errorsFor(card))}`).toBe(true);
    }
  });

  it("rejects CC-BY-NC-SA-4.0 and names the licence enum", () => {
    const bad: FxCard = { ...BLOOM, id: "bad", licence: "CC-BY-NC-SA-4.0" };
    expect(validate(bad)).toBe(false);

    const licenceError = errorsFor(bad).find((e) => e.instancePath === "/licence");
    if (!licenceError) throw new Error("card schema did not report a /licence error");
    expect(licenceError.keyword).toBe("enum");
    const allowed = (licenceError.params as { allowedValues?: string[] }).allowedValues ?? [];
    expect(allowed).toContain("MIT");
    expect(allowed).toContain("OFL-1.1");
    expect(allowed).not.toContain("CC-BY-NC-SA-4.0");
  });

  it("rejects a card that omits the licence", () => {
    const missing = { ...BLOOM, id: "missing" } as Record<string, unknown>;
    delete missing.licence;
    expect(validate(missing)).toBe(false);
    expect(errorsFor(missing).some((e) => e.keyword === "required" && (e.params as { missingProperty?: string }).missingProperty === "licence")).toBe(
      true,
    );
  });
});
