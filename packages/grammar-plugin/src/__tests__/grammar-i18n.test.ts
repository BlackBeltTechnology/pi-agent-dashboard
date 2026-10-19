/**
 * @structural-pin the `t("key")` call sites are the only list of keys the settings body resolves; no runtime path enumerates them
 *
 * E31 (retro-ux-plugin-settings-wave-2): every translatable key the settings
 * section resolves through `t("<key>", …)` exists in the shipped `hu` catalog.
 * English lives inline at the call site, so a key missing here silently shows
 * English to a Hungarian user and no type check notices.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog } from "../i18n.js";

describe("grammar settings i18n", () => {
  it("E31: every t() key used by GrammarSettings.tsx is present in the hu catalog", () => {
    const src = readFileSync(resolve(__dirname, "../GrammarSettings.tsx"), "utf8");
    const keys = new Set([...src.matchAll(/\bt\(\s*"([A-Za-z][\w.]*)"/g)].map((m) => m[1]));
    // Recommended-model notes are looked up by the data table's `noteKey` field.
    for (const m of src.matchAll(/noteKey:\s*"([A-Za-z]\w*)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(20);
    const missing = [...keys].filter((k) => !(k in catalog.hu));
    expect(missing).toEqual([]);
  });
});
