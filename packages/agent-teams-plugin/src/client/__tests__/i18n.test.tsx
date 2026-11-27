// @vitest-environment jsdom
/**
 * Lazy-module string tables (test-plan S101, task 13.55): three locales × three modules
 * (Team view, mail card, tool renderers) carry identical key sets, no empty strings,
 * identical `{var}` placeholders; a missing key falls back to the `en` text (never the
 * raw key); the lazy module picks its locale with `useLanguage()`; every key the code
 * references exists; no module imports another module's table. The eager catalog is
 * covered by `i18n.test.ts`. See change: add-agent-teams-ui.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { announcementLines } from "../announcements.js";
import { APPROVAL_TABLES } from "../approval-i18n.js";
import { makeTranslate, resolveLocale, type Tables } from "../lazy-i18n.js";
import { MailEntryCard } from "../MailEntryCard.js";
import { MAIL_TABLES } from "../mail-i18n.js";
import { START_TABLES } from "../start-i18n.js";
import { MEMBER_STATUS, TASK_BLOCKED, TASK_STATUS, TEAM_STATUS, URGENT_MARKER } from "../status-map.js";
import { TeamHeader } from "../TeamHeader.js";
import { TEAM_VIEW_TABLES } from "../team-view-i18n.js";
import { TOOL_TABLES } from "../tool-i18n.js";
import { header } from "./mail-fixtures.js";
import { renderHost, snap } from "./view-fixtures.js";

afterEach(cleanup);

const LOCALES = ["en", "zh-CN", "hu"] as const;
const MODULES: Array<[string, Tables]> = [
  ["Team view", TEAM_VIEW_TABLES],
  ["mail card", MAIL_TABLES],
  ["tool renderers", TOOL_TABLES],
  ["approval + playbook cards (templates-hooks)", APPROVAL_TABLES],
  ["Start team dialog (templates-hooks)", START_TABLES],
];
const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("string tables (S101)", () => {
  for (const [name, tables] of MODULES) {
    describe(name, () => {
      it("exposes exactly en, zh-CN and hu", () => expect(Object.keys(tables).sort()).toEqual([...LOCALES].sort()));
      it("identical, non-empty key sets in all three locales", () => {
        const reference = Object.keys(tables.en).sort();
        expect(reference.length).toBeGreaterThan(10);
        for (const l of LOCALES) expect(Object.keys(tables[l]).sort(), l).toEqual(reference);
      });
      it("no empty strings and identical placeholders in every locale", () => {
        for (const key of Object.keys(tables.en)) {
          for (const l of LOCALES) {
            const text = tables[l][key] as string;
            expect(text.trim(), `${l}.${key}`).not.toBe("");
            expect(vars(text), `${l}.${key}`).toEqual(vars(tables.en[key] as string));
          }
        }
      });
      it("non-English tables are really translated (most values differ from English)", () => {
        for (const l of ["zh-CN", "hu"] as const) {
          const same = Object.keys(tables.en).filter((k) => tables[l][k] === tables.en[k]).length;
          expect(same / Object.keys(tables.en).length, l).toBeLessThan(0.2);
        }
      });
    });
  }
});

describe("translator", () => {
  it("resolves locales and falls back to English", () => {
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("zh")).toBe("zh-CN");
    expect(resolveLocale("hu-HU")).toBe("hu");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
  it("a key missing in a locale falls back to the en text, never the raw key; a key missing everywhere returns the key", () => {
    const tables: Tables = { en: { a: "English {x}", b: "only en" }, "zh-CN": { a: "中文 {x}" }, hu: { a: "magyar {x}" } };
    expect(makeTranslate(tables, "zh-CN")("a", { x: 1 })).toBe("中文 1");
    expect(makeTranslate(tables, "zh-CN")("b")).toBe("only en");
    expect(makeTranslate(tables, "hu")("zzz")).toBe("zzz");
  });
});

describe("keys the code references exist", () => {
  const view = TEAM_VIEW_TABLES.en;
  const tool = TOOL_TABLES.en;
  it("status-map text and sentence keys exist in the view table; member/task keys also in the tool table", () => {
    for (const e of [...Object.values(MEMBER_STATUS), ...Object.values(TEAM_STATUS), ...Object.values(TASK_STATUS), TASK_BLOCKED, URGENT_MARKER]) expect(view[e.textKey], e.textKey).toBeDefined();
    for (const e of Object.values(MEMBER_STATUS)) {
      expect(view[e.sentenceKey], e.sentenceKey).toBeDefined();
      expect(tool[e.textKey], e.textKey).toBeDefined();
    }
    for (const e of Object.values(TASK_STATUS)) expect(tool[e.textKey], e.textKey).toBeDefined();
    expect(view["announce.member.unknown"]).toBeDefined();
    expect(view["status.unknown"]).toBeDefined();
    expect(tool["status.unknown"]).toBeDefined();
  });
  it("every announcement line key exists", () => {
    const lines = announcementLines({ members: Object.keys(MEMBER_STATUS).map((s) => ({ name: "a", status: s })).concat({ name: "a", status: "weird" }), tasksCompleted: ["1"], teamClosed: true });
    for (const l of lines) expect(view[l.key], l.key).toBeDefined();
  });
  it("each source file only uses keys that exist in ITS table", () => {
    const keysIn = (file: string, re: RegExp): string[] => [...fs.readFileSync(path.join(CLIENT, file), "utf8").matchAll(re)].map((m) => m[1] as string);
    const viewFiles = ["MembersGrid.tsx", "TaskBoard.tsx", "MessageLog.tsx", "TeamHeader.tsx", "TeamTabs.tsx", "TeamView.tsx", "LiveRegion.tsx", "view-kit.tsx"];
    for (const f of viewFiles) for (const k of keysIn(f, /\bt\("([a-zA-Z0-9_.]+)"/g)) expect(view[k], `${f}: ${k}`).toBeDefined();
    for (const k of keysIn("MailEntryCard.tsx", /\bt\("([a-zA-Z0-9_.]+)"/g)) expect(MAIL_TABLES.en[k], `MailEntryCard: ${k}`).toBeDefined();
    for (const k of keysIn("TeamToolRenderers.tsx", /\bt\("([a-zA-Z0-9_.]+)"/g)) expect(tool[k], `TeamToolRenderers: ${k}`).toBeDefined();
  });
});

describe("tables stay with their module", () => {
  const importsOf = (file: string): string[] => [...fs.readFileSync(path.join(CLIENT, file), "utf8").matchAll(/from "\.\/([\w-]+)\.js"/g)].map((m) => m[1] as string);
  it("the mail card and the tool renderers import no other module's table (nor the Team view kit)", () => {
    for (const f of ["MailEntryCard.tsx", "TeamToolRenderers.tsx"]) {
      const imports = importsOf(f);
      expect(imports, f).not.toContain("team-view-i18n");
      expect(imports, f).not.toContain("view-kit");
    }
    expect(importsOf("MailEntryCard.tsx")).not.toContain("tool-i18n");
    expect(importsOf("TeamToolRenderers.tsx")).not.toContain("mail-i18n");
  });
  it("no lazy module imports the eager catalog", () => {
    for (const f of ["MailEntryCard.tsx", "TeamToolRenderers.tsx", "TeamView.tsx", "lazy-i18n.ts", "view-kit.tsx"]) expect(fs.readFileSync(path.join(CLIENT, f), "utf8")).not.toMatch(/from "\.\.\/i18n\.js"/);
  });
});

describe("rendering under each locale (the lazy module reads `useLanguage()`)", () => {
  const body = `${header("message", "bob")}\nhi`;
  const card = (language: string) =>
    render(
      <PluginContextProvider connectionStatus="connected" language={language}>
        <MailEntryCard customType="agent-teams-mail" body={body} timestamp={1} expanded={false} onToggle={() => undefined} payloadLoading={false} />
      </PluginContextProvider>,
    );
  it.each([
    ["en", "Agent message", "Teammate bob"],
    ["zh-CN", "智能体消息", "队友 bob"],
    ["hu", "Ügynökűzenet", "Társ: bob"],
    ["fr", "Agent message", "Teammate bob"], // unsupported locale → English, never a raw key
  ])("%s", (language, title, sender) => {
    card(language);
    expect(screen.getByTestId("team-mail-title").textContent).toBe(title);
    expect(screen.getByTestId("team-mail-sender").textContent).toBe(sender);
    expect(document.body.textContent).not.toMatch(/\bcard\.|\brole\./);
  });

  it("an unwired runtime (no provider) falls back to English", () => {
    render(<MailEntryCard customType="agent-teams-mail" body={body} timestamp={1} expanded={false} onToggle={() => undefined} payloadLoading={false} />);
    expect(screen.getByTestId("team-mail-title").textContent).toBe("Agent message");
  });

  it("the Team view header under hu", () => {
    renderHost(
      <PluginContextProvider connectionStatus="connected" language="hu">
        <TeamHeader snap={snap()} shutdownPending={false} shutdownNote={undefined} onShutdown={() => undefined} onBack={() => undefined} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("team-back").textContent).toContain("Vissza");
    expect(screen.getByTestId("team-shutdown").textContent).toBe("Csapat leállítása");
  });
});
