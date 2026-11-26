/**
 * Inline "Other" strings are defined exactly once per catalog (en / hu / zh-CN),
 * so the new component carries no hardcoded English. Test-plan #F10.
 * See change: add-ask-user-inline-other.
 *
 * Also pins the write-mode grant strings (Access "Write" badge, write prompt copy) —
 * test-plan #S49 of fix-file-link-editor-routing; defined once per catalog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = join(__dirname, "..", "lib");
const read = (rel: string) => readFileSync(join(LIB, rel), "utf8");

const EXPECTED = {
  "common.other": { en: "Other", hu: "Egyéb", zh: "其他" },
  "common.otherAnswer": { en: "Other answer", hu: "Egyéb válasz", zh: "其他答案" },
  "common.otherPlaceholder": { en: "Type your answer", hu: "Írd be a válaszod", zh: "输入你的答案" },
  "access.modeWrite": { en: "Write", hu: "Írás", zh: "写入" },
  "grantPrompt.reason.filesystemWrite": {
    en: "A write was blocked because this path is outside the session's working directory. Allowing it also allows reading and saving text documents under the chosen folder.",
    hu: "Egy írás le lett tiltva, mert ez az útvonal a munkamenet munkakönyvtárán kívül esik. Az engedélyezés a kiválasztott mappa alatti szöveges dokumentumok olvasását és mentését is engedélyezi.",
    zh: "写入被阻止，因为此路径位于会话工作目录之外。允许后，也将允许读取和保存所选文件夹下的文本文档。",
  },
  "editor.unsaved.title": { en: "Unsaved changes", hu: "Nem mentett módosítások", zh: "未保存的更改" },
  "editor.unsaved.body": { en: "Leaving now would lose the unsaved changes in:", hu: "Ha most kilépsz, a következő fülek nem mentett módosításai elvesznek:", zh: "现在离开将丢失以下标签页中未保存的更改：" },
  "editor.unsaved.save": { en: "Save", hu: "Mentés", zh: "保存" },
  "editor.unsaved.discard": { en: "Discard", hu: "Elvetés", zh: "丢弃" },
  "editor.unsaved.cancel": { en: "Cancel", hu: "Mégse", zh: "取消" },
  "editor.unsaved.saving": { en: "Saving…", hu: "Mentés…", zh: "正在保存…" },
} as const;

const FILES = { en: "i18n-en-source.json", hu: "i18n/i18n-hu.ts", zh: "i18n/i18n-zh-CN.ts" } as const;

describe("inline Other i18n strings", () => {
  for (const [lang, file] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const src = read(file);
    for (const [key, values] of Object.entries(EXPECTED)) {
      it(`${lang}: ${key} is defined once`, () => {
        expect(src.split(`"${key}":`).length - 1).toBe(1);
        expect(src).toContain(`"${key}": ${JSON.stringify(values[lang])}`);
      });
    }
  }
});
