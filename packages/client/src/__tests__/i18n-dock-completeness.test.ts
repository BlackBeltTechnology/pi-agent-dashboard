/**
 * Task 9.4: every new composer-dock / toolbar string exists in every shipped
 * locale. English lives at the call sites (`t(key, vars, "English")`), so the
 * shipped catalogs to check are `hu` and `zh-CN` (core) and each plugin's own
 * `catalog` (the subagents plugin owns the `dock*` row strings).
 *
 * Scans the dock/toolbar sources for translated keys, so a string added later
 * without a Hungarian and Chinese entry fails here rather than showing English
 * in a localized dock. See change: add-composer-dock (task 9.4).
 *
 * @structural-pin the catalogs are TS object literals read as text; the call-site keys are only knowable from source
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_SRC = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(p, "utf-8");

const huSrc = read(path.join(CLIENT_SRC, "lib/i18n/i18n-hu.ts"));
const zhSrc = read(path.join(CLIENT_SRC, "lib/i18n/i18n-zh-CN.ts"));
const hasKey = (src: string, key: string) => src.includes(`"${key}":`);

/** Dock + toolbar sources (relative to `packages/client/src`). */
const DOCK_FILES = [
  "components/chat/ComposerDock.tsx",
  "components/chat/ComposerDockHost.tsx",
  "components/chat/ChangesLane.tsx",
  "components/chat/ContextLane.tsx",
  "components/chat/ProcessesLane.tsx",
  "components/chat/ProcessesLaneBody.tsx",
  "components/chat/QueueLane.tsx",
  "components/chat/composer-dock-model.ts",
  "components/chat/useComposerDockLanes.ts",
  "components/chat/ComposerDeliveryMenu.tsx",
  "components/session/ComposerSessionActions.tsx",
  "components/session/QueuePanel.tsx",
  "components/worktree/GitIdentity.tsx",
  "hooks/useDockDiff.ts",
  "lib/chat/working-status.ts",
];

/** Keys the new toolbar (CommandInput / chips) introduced; the rest of its catalog predates this change. */
const TOOLBAR_KEYS = [
  "command.deliveryModeValue",
  "command.steerDescription",
  "command.queueDescription",
  "command.deliveryHeading",
  "command.modelChipName",
];

function usedKeys(file: string): string[] {
  const src = read(path.join(CLIENT_SRC, file));
  return [...src.matchAll(/\b(?:t|i18nT)\(\s*["'`]([A-Za-z][\w]*(?:\.[\w]+)+)["'`]/g)].map((m) => m[1] as string);
}

describe("composer dock i18n completeness (9.4)", () => {
  const dockKeys = [...new Set(DOCK_FILES.flatMap(usedKeys).filter((k) => k.startsWith("dock.")))];
  const keys = [...dockKeys, ...TOOLBAR_KEYS];

  it("finds the dock keys it is meant to guard", () => {
    expect(dockKeys.length).toBeGreaterThan(40);
  });

  it("every dock.* key the dock uses, and every new toolbar key, is in hu and zh-CN", () => {
    const missing = keys.flatMap((k) => [
      ...(hasKey(huSrc, k) ? [] : [`hu: ${k}`]),
      ...(hasKey(zhSrc, k) ? [] : [`zh-CN: ${k}`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("the dock catalogs carry the same dock.* key set in hu and zh-CN", () => {
    const dockKeys = (src: string) =>
      [...src.matchAll(/"(dock\.[\w.]+)":/g)].map((m) => m[1] as string).sort();
    expect(dockKeys(huSrc)).toEqual(dockKeys(zhSrc));
  });

  it("subagents-plugin dock row strings are in both plugin locales", () => {
    const pluginSrc = read(path.resolve(CLIENT_SRC, "../../subagents-plugin/src/i18n.ts"));
    const rows = read(path.resolve(CLIENT_SRC, "../../subagents-plugin/src/client/SubagentDockGroup.tsx"));
    const used = [...rows.matchAll(/\bt\(\s*"(dock\w+)"/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(0);
    for (const key of new Set(used)) {
      // once per locale block (zh-CN, hu)
      expect(pluginSrc.split(`${key}:`).length - 1, key).toBe(2);
    }
  });
});
