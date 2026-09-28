/**
 * i18n orphan removal — the 7 banner-only keys dropped with the
 * ModelProxySection coexistence advisory must be absent from every locale
 * source, and the retained secondPort placeholder key must survive.
 *
 * See change: remove-pi-model-proxy-upstream-references (E17).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const REMOVED_KEYS = [
  "common.note",
  "common.theUpstream",
  "common.whileTheUpstreamUses",
  "common.consider",
  "common.toAvoidDuplicateListeners",
  "packages.disablingTheUpstreamExtension",
  "packages.extensionIsAlsoActiveInOne",
] as const;

/** Locate the client package root from an arbitrary vitest cwd. */
function findClientRoot(start: string): string {
  const marker = join("src", "lib", "i18n", "i18n.tsx");
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, marker))) return dir;
    if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

const root = findClientRoot(process.cwd());
const catalogs: Array<[string, string]> = [
  ["i18n-en-source.json", readFileSync(join(root, "src/lib/i18n-en-source.json"), "utf8")],
  ["i18n.tsx (zh-CN)", readFileSync(join(root, "src/lib/i18n/i18n.tsx"), "utf8")],
  ["i18n-hu.ts", readFileSync(join(root, "src/lib/i18n/i18n-hu.ts"), "utf8")],
  ["i18n-legacy-aliases.ts", readFileSync(join(root, "src/lib/i18n/i18n-legacy-aliases.ts"), "utf8")],
];

describe("i18n orphan removal (E17)", () => {
  it("the 7 advisory-only keys are absent from every catalog and legacy aliases", () => {
    for (const key of REMOVED_KEYS) {
      for (const [label, source] of catalogs) {
        expect(source.includes(`"${key}"`), `${label} still contains ${key}`).toBe(false);
      }
    }
  });

  it("common.eG9876 (secondPort placeholder) survives in every catalog", () => {
    for (const [label, source] of catalogs) {
      expect(source.includes('"common.eG9876"'), `${label} lost common.eG9876`).toBe(true);
    }
  });
});

/**
 * Lifecycle-bar i18n: the Explore/Apply stepper nodes are gone, so their
 * labels are orphaned; the overflow + segment accessible-name keys are new.
 * See change: compact-openspec-lifecycle-bar (test-plan E12).
 */
describe("lifecycle bar i18n keys (E12)", () => {
  const LIFECYCLE_REMOVED = ["openspec.node.explore", "openspec.node.apply"] as const;
  const LIFECYCLE_ADDED = [
    "openspec.lifecycle",
    "openspec.moreActions",
    "openspec.exploreChange",
    "openspec.segment.tasksCount",
    "openspec.segment.noTasks",
    "openspec.segmentState.done",
    "openspec.segmentState.current",
    "openspec.segmentState.todo",
    "openspec.segmentState.skipped",
  ] as const;
  const locales = catalogs.filter(([label]) => label === "i18n.tsx (zh-CN)" || label === "i18n-hu.ts" || label === "i18n-en-source.json");

  it("removed stepper-node keys are absent", () => {
    for (const key of LIFECYCLE_REMOVED) {
      for (const [label, source] of locales) {
        expect(source.includes(`"${key}"`), `${label} still contains ${key}`).toBe(false);
      }
    }
  });

  it("overflow + segment-name keys are present", () => {
    for (const key of LIFECYCLE_ADDED) {
      for (const [label, source] of locales) {
        expect(source.includes(`"${key}"`), `${label} missing ${key}`).toBe(true);
      }
    }
  });
});
