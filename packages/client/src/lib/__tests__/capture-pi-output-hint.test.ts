/**
 * The "Capture pi session output (debug)" hint says that OFF means new
 * sessions write no keeper log files — in every locale (test-plan #F1).
 * See change: keeper-log-toggle-gates-all-output.
 *
 * @structural-pin the en hint exists only as the inline t() fallback in SettingsPanel.tsx, so its copy is read from source
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { huCatalog } from "../i18n/i18n-hu.js";
import { zhCNCatalog } from "../i18n/i18n-zh-CN.js";

const SRC = join(import.meta.dirname, "..", "..");
const KEY = "settings.capturePiOutputHint";

/** Pre-change copy: said only pi output is archived, nothing about off. */
const OLD = {
  en: "Archives each session's full pi stdout/stderr into keeper-<id>.log for debugging. Consumes significant disk on long sessions — leave off unless diagnosing a session. Applies to new sessions.",
  hu: "Minden munkamenet teljes pi stdout/stderr kimenetét a keeper-<id>.log fájlba archiválja hibakeresés céljából. Hosszú munkameneteknél jelentős lemezterületet fogyaszt — hagyd kikapcsolva, kivéve ha egy munkamenetet diagnosztizálsz. Az újonnan indított munkamenetekre vonatkozik.",
  zh: "将每个会话的完整 pi stdout/stderr 归档到 keeper-<id>.log 以便调试。长会话会占用大量磁盘空间——除非正在诊断会话，否则请关闭。仅对新生成的会话生效。",
};

function enInlineDefault(): string {
  const src = readFileSync(join(SRC, "components", "settings", "SettingsPanel.tsx"), "utf8");
  const m = src.match(/t\("settings\.capturePiOutputHint", undefined, "([^"]+)"\)/);
  if (!m) throw new Error("capturePiOutputHint inline default not found in SettingsPanel.tsx");
  return m[1];
}

describe("capturePiOutputHint copy (F1)", () => {
  it("en says new sessions write no keeper log when off", () => {
    const en = enInlineDefault();
    expect(en).not.toBe(OLD.en);
    expect(en).toMatch(/new sessions write no keeper log/i);
  });

  it("hu is updated and non-empty", () => {
    const hu = huCatalog[KEY];
    expect(hu).toBeTruthy();
    expect(hu).not.toBe(OLD.hu);
  });

  it("zh-CN is updated and non-empty", () => {
    const zh = zhCNCatalog[KEY];
    expect(zh).toBeTruthy();
    expect(zh).not.toBe(OLD.zh);
  });
});
