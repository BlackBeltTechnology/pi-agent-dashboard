// Job 1 (reindex) / Job 2 (DOX nudge) predicate decoupling — design D5.
// Folded from openspec/changes/asciidoc-support/test-plan.md (E18 case
// variants, E19 both jobs fire on .adoc, E20 markdown behaviour unchanged).
// Exemplar: packages/kb-extension/src/__tests__/reindex.test.ts (temp project
// with a real KB config) + doc-type-discoverability.test.ts (fake `pi`).
//
// No module mocks: the extension's real `tool_result` hook is driven and both
// jobs are observed through their real effects — Job 2 via the injected `pi`
// object's `sendMessage`, Job 1 via the index the debounced walk produces.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import kbExtension, { isIndexable, isNudgeEligible } from "../extension.js";
import { closeKb, createReindexState, getKb, reindexNow } from "../reindex.js";

type Hook = (event: unknown, ctx: unknown) => unknown;

/** A temp project with a KB config, a docs source and NO AGENTS.md tree, so a
 *  non-markdown edit is nudge-eligible (`treeless`). */
function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-adoc-disp-"));
  mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "dashboard", "knowledge_base.json"),
    JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs", priority: 5 }], dbPath: ".pi/dashboard/kb/index.db" }),
  );
  mkdirSync(join(dir, "docs"), { recursive: true });
  return dir;
}

/** Load the extension with DOX enforcement on, capturing its `tool_result`
 *  hook and every `sendMessage` (the observable Job 2 effect). */
function loadExtension(): { hook: Hook; sent: Array<{ customType?: string; details?: { path?: string } }> } {
  const hooks = new Map<string, Hook>();
  const sent: Array<{ customType?: string; details?: { path?: string } }> = [];
  const pi = {
    registerTool: () => {},
    on: (name: string, fn: Hook) => hooks.set(name, fn),
    sendMessage: (m: { customType?: string }) => sent.push(m),
  } as unknown as Parameters<typeof kbExtension>[0];
  kbExtension(pi);
  const hook = hooks.get("tool_result");
  expect(hook, "extension must register a tool_result hook").toBeTruthy();
  return { hook: hook!, sent };
}

let dir: string;
let home: string;
let prevEnv: string | undefined;
let prevHome: string | undefined;
beforeEach(() => {
  dir = setupProject();
  // Isolate from the developer's own ~/.pi/dashboard/knowledge_base.json: a
  // global `include`/`extensions` override would otherwise decide what these
  // tests index. An empty HOME = no global layer = the shipped defaults.
  home = mkdtempSync(join(tmpdir(), "kb-adoc-home-"));
  prevHome = process.env.HOME;
  process.env.HOME = home;
  prevEnv = process.env.KB_DOX_ENFORCEMENT;
  process.env.KB_DOX_ENFORCEMENT = "1";
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.KB_DOX_ENFORCEMENT;
  else process.env.KB_DOX_ENFORCEMENT = prevEnv;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

/** Reindex the cwd and report whether `needle` is now searchable — the
 *  observable proof that the file was routed to Job 1. */
async function indexedContains(needle: string): Promise<boolean> {
  const state = createReindexState();
  try {
    await reindexNow(state, dir);
    return getKb(state, dir).store.search(needle, { limit: 3 }).length > 0;
  } finally {
    closeKb(state);
  }
}

describe("E19: an .adoc edit fires BOTH jobs", () => {
  it("sends a DOX nudge and leaves the file indexable", async () => {
    const rel = join("docs", "api.adoc");
    writeFileSync(join(dir, rel), "= API\n\n== Routes\nadoc payload padded well past the tiny-chunk merge threshold so it survives here.\n");
    const { hook, sent } = loadExtension();
    await hook({ toolName: "write", input: { path: join(dir, rel) } }, { cwd: dir });

    // Job 2: the nudge fired even though the file is ALSO indexable — the
    // predicate decoupling this change exists for (the old if/else returned
    // early and would have skipped this).
    expect(sent.map((m) => m.details?.path)).toContain(join(dir, rel));
    // Job 1: the same path is indexable.
    expect(await indexedContains("adoc payload padded")).toBe(true);
  });
});

describe("E20: markdown behaviour is unchanged", () => {
  it("indexes but never nudges", async () => {
    const rel = join("docs", "guide.md");
    writeFileSync(join(dir, rel), "# Guide\nmarkdown payload padded well past the tiny-chunk merge threshold so it survives.\n");
    const { hook, sent } = loadExtension();
    await hook({ toolName: "write", input: { path: join(dir, rel) } }, { cwd: dir });
    expect(sent).toHaveLength(0); // complement rule preserved
    expect(await indexedContains("markdown payload padded")).toBe(true);
  });
});

describe("E18: the job predicates are case-insensitive and independent", () => {
  it("classifies every extension variant", () => {
    for (const p of ["doc.adoc", "X.ASCIIDOC", "a.AdOc", "b.asciidoc"]) {
      expect(isIndexable(p), p).toBe(true);
      expect(isNudgeEligible(p), p).toBe(true); // adoc is non-markdown ⇒ both jobs
    }
    for (const p of ["a.md", "B.MD", "c.mdx", "d.markdown"]) {
      expect(isIndexable(p), p).toBe(true);
      expect(isNudgeEligible(p), p).toBe(false); // markdown documents itself
    }
    expect(isIndexable("e.ts")).toBe(false);
    expect(isNudgeEligible("e.ts")).toBe(true);
  });

  it("routes an uppercase .ASCIIDOC edit through the hook", async () => {
    const rel = join("docs", "X.ASCIIDOC");
    writeFileSync(join(dir, rel), "= X\n\n== Sec\nuppercase extension payload padded past the tiny-chunk merge threshold here.\n");
    const { hook, sent } = loadExtension();
    await hook({ toolName: "write", input: { path: join(dir, rel) } }, { cwd: dir });
    // Job 2 firing proves the hook ran on the uppercase path; Job 1 eligibility
    // is the predicate asserted above. (Whether the indexer's include GLOB is
    // case-sensitive is pre-existing behaviour shared with `.MD`, not part of
    // this change.)
    expect(sent.map((m) => m.details?.path)).toContain(join(dir, rel));
  });
});
