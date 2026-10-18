import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_MANAGED_SETTINGS_KEYS } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-keys.js";
import {
  PI_SETTINGS_BLOCKS,
  PI_SETTINGS_SCHEMA,
  type PiSettingDef,
} from "@blackbelt-technology/pi-dashboard-shared/pi-settings-schema.js";
import { describe, expect, it } from "vitest";

/**
 * Schema ↔ pi `docs/settings.md` parity (test-plan #E1). Fails when the schema
 * drifts from the installed pi's documented defaults, or when a managed key
 * sneaks into the typed set. See change: pi-settings-full-coverage (D1).
 */

/** The typed set the spec enumerates (49 keys). */
const SPEC_KEYS = {
  bool: [
    "hideThinkingBlock", "showCacheMissNotices", "compaction.enabled", "branchSummary.skipPrompt", "showHardwareCursor",
    "terminal.showImages", "terminal.clearOnShrink", "terminal.showTerminalProgress", "images.autoResize",
    "images.blockImages", "enableSkillCommands", "collapseChangelog", "enableInstallTelemetry", "enableAnalytics",
    "warnings.anthropicExtraUsage",
  ],
  enum: [
    "cacheWarming", "steeringMode", "followUpMode", "doubleEscapeAction", "treeFilterMode", "defaultProjectTrust",
    "codemode.mode", "markdown.mermaid", "transport",
  ],
  mixed: ["quietStartup", "terminal.hyperlinks", "terminal.trueColor", "terminal.images"],
  int: [
    "compaction.reserveTokens", "compaction.keepRecentTokens", "branchSummary.reserveTokens", "codemode.inlineBudget",
    "httpIdleTimeoutMs", "websocketConnectTimeoutMs", "thinkingBudgets.minimal", "thinkingBudgets.low",
    "thinkingBudgets.medium", "thinkingBudgets.high", "terminal.imageWidthCells", "editorPaddingX", "autocompleteMaxVisible",
  ],
  string: ["externalEditor", "sessionDir", "shellPath", "shellCommandPrefix", "httpProxy", "markdown.codeBlockIndent", "theme"],
  stringArray: ["enabledModels"],
} as const;

function piDocs(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "docs", "settings.md");
    if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pi-coding-agent docs/settings.md not found in any node_modules");
    dir = parent;
  }
}

/** `key → default cell` of every documented row. */
function docDefaults(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of piDocs().split("\n")) {
    // Escaped pipes (`\|`, inside the Type column) are not cell separators.
    const cells = line.replace(/\\\|/g, "\u0000").split("|");
    const key = /^\s*`([^`]+)`\s*$/.exec(cells[1] ?? "")?.[1];
    if (key && cells.length >= 5) out.set(key, (cells[3] ?? "").trim());
  }
  return out;
}

/** A documented default cell as a literal, or `null` when it is prose (None, Automatic, …). */
function literal(cell: string): boolean | number | string | null {
  const m = /^`(.*)`$/.exec(cell);
  if (!m) return null;
  const v = m[1];
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  const q = /^"(.*)"$/.exec(v);
  return q ? q[1] : null; // `$VISUAL`, `read`, … are prose-like, not literals
}

describe("pi settings schema parity", () => {
  const specSet = Object.values(SPEC_KEYS).flat();

  it("E1 the typed key set equals the spec list, by kind", () => {
    expect(PI_SETTINGS_SCHEMA.map((d) => d.key).sort()).toEqual([...specSet].sort());
    for (const [kind, keys] of Object.entries(SPEC_KEYS)) {
      const got = PI_SETTINGS_SCHEMA.filter((d) => d.kind === kind).map((d) => d.key);
      expect(got.sort(), kind).toEqual([...keys].sort());
    }
  });

  it("E1 no managed key is in the schema, and every dotted key's block is a known block", () => {
    const keys = PI_SETTINGS_SCHEMA.map((d) => d.key);
    for (const m of PI_MANAGED_SETTINGS_KEYS) expect(keys).not.toContain(m);
    for (const k of keys.filter((x) => x.includes("."))) expect(PI_SETTINGS_BLOCKS).toContain(k.split(".")[0]);
  });

  it("E1 every def equals the docs default", () => {
    const docs = docDefaults();
    const docKey = (d: PiSettingDef) => (d.key.startsWith("thinkingBudgets.") ? "thinkingBudgets" : d.key);
    for (const d of PI_SETTINGS_SCHEMA) {
      const cell = docs.get(docKey(d));
      expect(cell, `${d.key} is documented`).toBeDefined();
      expect(d.def, d.key).toEqual(literal(cell ?? ""));
    }
  });

  it("E1 documented bounds match", () => {
    const by = (k: string) => PI_SETTINGS_SCHEMA.find((d) => d.key === k);
    expect([by("editorPaddingX")?.min, by("editorPaddingX")?.max]).toEqual([0, 3]);
    expect([by("autocompleteMaxVisible")?.min, by("autocompleteMaxVisible")?.max]).toEqual([3, 20]);
    expect(by("terminal.imageWidthCells")?.min).toBe(1);
  });
});
