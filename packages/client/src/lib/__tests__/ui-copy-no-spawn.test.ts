/**
 * User-facing copy says "new session" / "start" / "restart", never "spawn"
 * (test-plan E7, E8; design D9).
 *
 * E7 — repo-wide scan. Inputs:
 *   - `i18n-en-source.json` values,
 *   - every `configSchema.json` `title` / `description` (plugin settings UI),
 *   - every prose-like string literal / JSX text (contains whitespace or
 *     starts uppercase) in non-test `packages/<pkg>/src/**\/*.{ts,tsx}` — this
 *     covers `i18nT`/`t` fallbacks, plugin `src/i18n.ts` catalogs and
 *     hard-coded labels alike.
 *   The TypeScript AST is walked, so comments never match. Identifier-like
 *   strings (`spawn_session`, `spawnStrategy`, i18n KEYS) are not prose and
 *   are skipped by construction. Log-only / internal literals are exempted by
 *   exact (file, text) in `ui-copy-allowlist.json`, each with a reason; a stale
 *   allowlist entry fails too, so the list cannot rot.
 * E8 — the copy change renamed no i18n key and touched no translation except
 *   the goal-plugin zh 重生 → 重启: the D9 keys still resolve in en-source,
 *   the Hungarian catalog and the client zh map, and still carry their
 *   (unchanged) non-English wording.
 *
 * See change: align-ui-with-theme-tokens (tasks 3b.1, 4.4, 5.18, 5.19).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { huCatalog } from "../i18n/i18n-hu.js";
import { catalog as goalCatalog } from "../../../../goal-plugin/src/i18n.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const PACKAGES = join(ROOT, "packages");
const SPAWN = /\b(re)?spawn(s|ed|ing)?\b/i;

interface AllowEntry {
  file: string;
  text: string;
  reason: string;
}
const allowlist: AllowEntry[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "ui-copy-allowlist.json"), "utf8"),
).entries;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const n of names) {
    if (n === "node_modules" || n === "__tests__" || n === "dist") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(n) && !/\.(test|spec)\.tsx?$/.test(n) && !n.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

const isProse = (text: string): boolean => /\s/.test(text.trim()) || /^[A-Z]/.test(text);

interface Hit {
  file: string;
  text: string;
}

/** Prose-like literals mentioning spawn/respawn in one TS/TSX file. */
function scanSource(file: string): Hit[] {
  const src = readFileSync(file, "utf8");
  if (!SPAWN.test(src)) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | undefined;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    } else if (ts.isJsxText(node)) {
      text = node.text.trim();
    }
    if (text && isProse(text) && SPAWN.test(text)) hits.push({ file: relative(ROOT, file), text });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function scanJsonCatalogs(): Hit[] {
  const hits: Hit[] = [];
  const enSource = join(PACKAGES, "client", "src", "lib", "i18n-en-source.json");
  for (const value of Object.values(JSON.parse(readFileSync(enSource, "utf8")) as Record<string, string>)) {
    if (SPAWN.test(value)) hits.push({ file: relative(ROOT, enSource), text: value });
  }
  for (const pkg of readdirSync(PACKAGES)) {
    const schema = join(PACKAGES, pkg, "src", "configSchema.json");
    let raw: string;
    try {
      raw = readFileSync(schema, "utf8");
    } catch {
      continue;
    }
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) {
          if ((k === "title" || k === "description") && typeof child === "string" && SPAWN.test(child)) {
            hits.push({ file: relative(ROOT, schema), text: child });
          }
          walk(child);
        }
      }
    };
    walk(JSON.parse(raw));
  }
  return hits;
}

const key = (h: Hit) => `${h.file}\u0000${h.text}`;

describe("user-facing copy — no spawn wording (E7)", () => {
  const sourceHits = readdirSync(PACKAGES).flatMap((pkg) => sourceFiles(join(PACKAGES, pkg, "src")).flatMap(scanSource));
  const hits = [...sourceHits, ...scanJsonCatalogs()];
  const allowed = new Set(allowlist.map(key));

  it("every prose string that says spawn/respawn is an allowlisted non-UI literal", () => {
    const offenders = hits.filter((h) => !allowed.has(key(h))).map((h) => `${h.file}: ${JSON.stringify(h.text)}`);
    expect(offenders).toEqual([]);
  });

  it("the allowlist has no stale entries and every entry states a reason", () => {
    const found = new Set(hits.map(key));
    const stale = allowlist.filter((e) => !found.has(key(e))).map((e) => `${e.file}: ${JSON.stringify(e.text)}`);
    expect(stale).toEqual([]);
    for (const e of allowlist) expect(e.reason.length, `${e.file}: reason`).toBeGreaterThan(10);
  });

  it("the scanner sees prose, skips identifiers and comments (self-check)", () => {
    const sf = ts.createSourceFile(
      "probe.tsx",
      `// Spawn in a comment is ignored
const a = "spawn_session"; const b = "spawnStrategy"; const c = "Spawn a session";
const d = <p>We respawn it</p>;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const texts: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) && isProse(n.text) && SPAWN.test(n.text)) texts.push(n.text);
      if (ts.isJsxText(n) && isProse(n.text.trim()) && SPAWN.test(n.text)) texts.push(n.text.trim());
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(texts).toEqual(["Spawn a session", "We respawn it"]);
  });
});

/** D9 keys whose English copy changed; their keys must survive unchanged. */
const D9_KEYS = [
  "git.spawnIntoThatWorktree",
  "session.spawnASessionAttachedToThis",
  "worktree.spawnAWorktreeForThisProposal",
  "session.spawnsASessionRunningTheNew",
  "session.createSpawn",
  "session.spawnWorktreeTitle",
  "session.noSpawnFailuresRecorded",
  "piRuntime.colSpawn",
  "piRuntime.laneSpawn",
  "piRuntime.customSpawn",
  "landing.addFolderDescription",
  "common.howLongToWaitForA",
  "git.gitSourceTakesEffect",
  "settings.capturePiOutputHint",
  "worktree.afterSpawningAWorktreeAutoRun",
  "worktree.showWorktreeSpawnButtonsInFolders",
] as const;

describe("user-facing copy — keys and translations stable (E8)", () => {
  const enSource = JSON.parse(readFileSync(join(PACKAGES, "client", "src", "lib", "i18n-en-source.json"), "utf8")) as Record<string, string>;
  const zhSource = readFileSync(join(PACKAGES, "client", "src", "lib", "i18n", "i18n.tsx"), "utf8");

  it("every D9 client key still has a Hungarian and a zh-CN entry (no key renamed)", () => {
    const missing: string[] = [];
    for (const k of D9_KEYS) {
      if (k === "git.spawnIntoThatWorktree") continue; // code-only fallback, never catalogued
      if (!(k in huCatalog)) missing.push(`hu:${k}`);
      if (!zhSource.includes(`"${k}":`)) missing.push(`zh:${k}`);
    }
    expect(missing).toEqual([]);
  });

  it("the nine en-source D9 keys keep their key and carry the new copy", () => {
    expect(enSource["session.spawnASessionAttachedToThis"]).toBe("New session for this proposal");
    expect(enSource["worktree.spawnAWorktreeForThisProposal"]).toBe("New worktree session for this proposal");
    expect(enSource["session.createSpawn"]).toBe("Create & start session");
    expect(enSource["session.noSpawnFailuresRecorded"]).toBe("No failed session starts recorded.");
    expect(enSource["worktree.showWorktreeSpawnButtonsInFolders"]).toBe("Show New Worktree buttons in folders and OpenSpec rows");
    for (const k of [
      "session.spawnsASessionRunningTheNew",
      "common.howLongToWaitForA",
      "git.gitSourceTakesEffect",
      "worktree.afterSpawningAWorktreeAutoRun",
    ]) {
      expect(enSource[k], k).toBeTruthy();
    }
  });

  it("Hungarian already said start (indítás) and is unchanged for the D9 keys", () => {
    expect(huCatalog["session.spawnASessionAttachedToThis"]).toBe("Ehhez a javaslathoz csatolt munkamenet indítása");
    expect(huCatalog["session.noSpawnFailuresRecorded"]).toBe("Nincs rögzített indítási hiba.");
  });

  it("goal-plugin zh says restart (重启), never respawn (重生); keys unchanged", () => {
    const zh = goalCatalog["zh-CN"] as Record<string, string>;
    for (const k of ["autoRespawnLabel", "autoRespawnDefaultLabel", "autoRespawnHelp"]) {
      expect(zh[k], k).toContain("重启");
      expect(zh[k], k).not.toContain("重生");
    }
  });
});
