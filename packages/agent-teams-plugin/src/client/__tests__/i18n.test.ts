/**
 * Catalog key parity (test-plan S132) and the eager-catalog budget (S101, D9):
 * `en`, `zh-CN` and `hu` carry identical key sets with no empty strings; the
 * catalog holds BADGE labels only (every other string lives in the lazy modules'
 * own tables); the client entry barrel exports exactly the catalog, the badge
 * component and its predicate — never a lazy claim component.
 * The templates-hooks tables (Start team dialog, folder action, hook confirmation,
 * approval and playbook cards; test-plan #F8) hold the same parity rules.
 * See change: add-agent-teams-core, add-agent-teams-ui, add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalog } from "../../i18n.js";
import { APPROVAL_TABLES } from "../approval-i18n.js";
import * as entry from "../index.js";
import { START_TABLES } from "../start-i18n.js";

const LOCALES = ["en", "zh-CN", "hu"] as const;
const keysOf = (locale: (typeof LOCALES)[number]): string[] => Object.keys(catalog[locale]).sort();
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("i18n catalog parity (S132)", () => {
  it("exposes exactly en, zh-CN and hu", () => {
    expect(Object.keys(catalog).sort()).toEqual([...LOCALES].sort());
  });

  it("has identical, non-empty key sets in all three locales", () => {
    const reference = keysOf("en");
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) expect(keysOf(locale), locale).toEqual(reference);
  });

  it("has no empty or whitespace-only strings, and keys are unprefixed leaf keys", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalog[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
        expect(key.startsWith("plugin."), `${locale}.${key}`).toBe(false);
      }
    }
  });

  it("keeps `{var}` placeholders identical across locales", () => {
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
    for (const key of keysOf("en")) {
      const base = vars((catalog.en as Record<string, string>)[key] as string);
      for (const locale of LOCALES) expect(vars((catalog[locale] as Record<string, string>)[key] as string), `${locale}.${key}`).toEqual(base);
    }
  });
});

describe("eager catalog is badge labels only (S101, D9)", () => {
  const BADGE_KEYS = ["badgeLead", "badgeOpen", "badgeTeam"];

  it("holds exactly the badge label keys in every locale", () => {
    for (const locale of LOCALES) expect(keysOf(locale), locale).toEqual(BADGE_KEYS);
  });

  it("carries the `{role}` placeholder where the accessible name needs it", () => {
    for (const locale of LOCALES) expect((catalog[locale] as Record<string, string>).badgeOpen, locale).toContain("{role}");
  });
});

describe("client entry barrel (S132)", () => {
  it("exports the catalog, the badge component and its predicate — nothing else (lazy claims stay out)", () => {
    expect(Object.keys(entry).sort()).toEqual(["TeamBadge", "catalog", "isTeamSession"]);
    expect(entry.catalog).toBe(catalog);
  });

  it("the manifest names those exports", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"))["pi-dashboard-plugin"] as {
      i18nCatalog: string;
      client: string;
      claims: Array<{ slot: string; component: string; module?: string; predicate?: string }>;
    };
    expect(manifest.i18nCatalog).toBe("catalog");
    expect(Object.keys(entry)).toContain(manifest.i18nCatalog);
    for (const claim of manifest.claims.filter((c) => !c.module)) expect(Object.keys(entry), `${claim.slot}:${claim.component}`).toContain(claim.component);
    for (const claim of manifest.claims.filter((c) => c.predicate)) expect(Object.keys(entry)).toContain(claim.predicate);
  });
});

describe("templates-hooks string tables: key parity (F8, 14.5)", () => {
  const TABLES = { "Start team dialog / folder / hooks": START_TABLES, "approval + playbook cards": APPROVAL_TABLES } as const;
  const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

  for (const [name, tables] of Object.entries(TABLES)) {
    describe(name, () => {
      const keys = (l: (typeof LOCALES)[number]): string[] => Object.keys(tables[l]).sort();

      it("has identical, non-empty key sets in en, zh-CN and hu", () => {
        expect(keys("en").length).toBeGreaterThan(0);
        for (const l of LOCALES) expect(keys(l), l).toEqual(keys("en"));
      });

      it("has no empty strings and keeps `{var}` placeholders identical", () => {
        for (const key of keys("en")) {
          for (const l of LOCALES) {
            const value = tables[l][key] as string;
            expect(value.trim(), `${l}.${key}`).not.toBe("");
            expect(vars(value), `${l}.${key}`).toEqual(vars(tables.en[key] as string));
          }
        }
      });
    });
  }

  it("covers the dialog, folder, hook, template, error and approval key families", () => {
    const start = Object.keys(START_TABLES.en);
    for (const prefix of ["folder.", "dialog.", "template.", "hooks.", "error."]) expect(start.some((k) => k.startsWith(prefix)), prefix).toBe(true);
    const approval = Object.keys(APPROVAL_TABLES.en);
    for (const prefix of ["plan.", "decision.", "hookFeedback.", "playbook."]) expect(approval.some((k) => k.startsWith(prefix)), prefix).toBe(true);
  });

  it("is not part of the eager catalog (cold-chunk budget)", () => {
    const eager = new Set(Object.keys(catalog.en));
    for (const key of [...Object.keys(START_TABLES.en), ...Object.keys(APPROVAL_TABLES.en)]) expect(eager.has(key), key).toBe(false);
  });
});
