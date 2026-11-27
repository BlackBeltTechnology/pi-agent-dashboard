/**
 * Catalog parity of the in-process string table (test-plan S94): every key exists in en, zh-CN and hu with the same
 * `{placeholder}` set, and every `t()` key the settings section uses is present.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { inprocTables } from "../client/inproc-i18n.js";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe("inproc i18n tables", () => {
  const en = inprocTables.en;
  it("has the settings-section and unavailable-reason keys", () => {
    for (const k of ["settings.title", "settings.teammateMode.label", "settings.idleTtl.label", "settings.lean.label", "settings.cmdTimeout.label", "settings.queueTimeout.label", "unavailable.subagents_extension_missing", "unavailable.subagents_extension_outdated", "unavailable.no_context"]) {
      expect(en[k], k).toBeTruthy();
    }
  });

  for (const locale of ["zh-CN", "hu"] as const) {
    it(`${locale} has exactly the en key set`, () => {
      expect(Object.keys(inprocTables[locale]).sort()).toEqual(Object.keys(en).sort());
    });

    it(`${locale} keeps the same placeholders and no empty value`, () => {
      for (const [key, text] of Object.entries(en)) {
        const other = inprocTables[locale][key] as string;
        expect(other, `${locale}.${key}`).toBeTruthy();
        expect(placeholders(other), `${locale}.${key}`).toEqual(placeholders(text));
      }
    });
  }
});
