/**
 * F4 catalog parity: en (fallback map), zh-CN and hu carry identical key sets
 * and no empty values; `{var}` placeholders survive translation.
 * See change: add-obs-studio-plugin (test-plan F4).
 */
import { describe, expect, it } from "vitest";
import { catalog } from "../../i18n.js";
import { en } from "../../messages.js";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("F4 obs-studio catalog", () => {
  it("en, zh-CN and hu have identical key sets", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(catalog["zh-CN"]).sort()).toEqual(keys);
    expect(Object.keys(catalog.hu).sort()).toEqual(keys);
  });

  it("no empty values and the same placeholders per key", () => {
    for (const [k, v] of Object.entries(en)) {
      for (const loc of [catalog["zh-CN"], catalog.hu]) {
        const tr = loc[k as keyof typeof en];
        expect(tr.trim().length, k).toBeGreaterThan(0);
        expect(vars(tr), k).toEqual(vars(v));
      }
    }
  });
});
