/**
 * Regenerates `fixtures/hermes-golden/` against the INSTALLED pi-hermes-memory.
 * Never called by the CLI. A regenerated golden bumps `REPLICA_VERSION`
 * (src/retrievers/builtin.ts) and is reviewed as a diff.
 *
 *   NODE_OPTIONS=--experimental-sqlite npx tsx packages/memory-eval/scripts/regen-hermes-golden.ts [hermes-package-dir]
 *
 * See change: add-memory-eval-tier-r (design M4, "Faithfulness").
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHermesDb, type FxMessage } from "../src/__tests__/helpers/hermes-db.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = resolve(here, "..", "fixtures", "hermes-golden");

export interface GoldenQuery {
  query: string;
  project: string;
}

export const QUERIES: GoldenQuery[] = [
  "kaboom failure",
  "the and of",
  "DO NOT USE FIND /",
  "vitest timeout error",
  "ab",
  '"exact phrase here"',
  "zzzzqqq",
  "pnpm install failed",
  "megint ugyanaz a hiba",
  "kaboom OR gadget",
  "Cannot find module",
  "worktree branch collision",
].map((query) => ({ query, project: "synth" }));

const SNIPPETS = [
  "kaboom failure while running the build on a fresh checkout",
  "the vitest timeout error appeared again after the upgrade",
  "pnpm install failed with a lockfile mismatch in the workspace",
  "Cannot find module while importing the shared package",
  "exact phrase here appears in this message only",
  "megint ugyanaz a hiba jelentkezett a szerveren",
  "a gadget broke during the kaboom test run",
  "worktree branch collision when checking out develop twice",
  "unrelated chatter about lunch and the weather today",
  "do not use find on the whole disk it is far too slow",
  "the and of are stop words in english text",
  "ab is a two character token the trigram index cannot match",
];

export function buildFixtureDb(path: string): void {
  rmSync(path, { force: true });
  const messages: FxMessage[] = [];
  const sessions = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `s-synth-${i}`, project: "synth" })),
    { id: "s-other-0", project: "other" },
  ];
  let t = Date.parse("2026-01-01T00:00:00.000Z");
  for (let i = 0; i < 60; i++) {
    t += 3_600_000 + i * 1000; // strictly increasing, unique timestamps
    const session = i % 11 === 10 ? "s-other-0" : `s-synth-${i % 8}`;
    messages.push({ id: `m-${String(i).padStart(3, "0")}`, session, content: `${SNIPPETS[(i * 5) % SNIPPETS.length]} (${i})`, ts: new Date(t).toISOString(), role: i % 2 ? "assistant" : "user" });
  }
  createHermesDb(path, { sessions, messages }).close();
}

export async function loadInstalledSearch(pkgDir: string): Promise<(db: DatabaseSync, q: string, o: { project?: string; limit?: number }) => Array<{ sessionId: string }>> {
  const mod = (await import(pathToFileURL(join(pkgDir, "src", "store", "session-search.ts")).href)) as {
    searchSessions: (mgr: { getDb(): unknown }, q: string, o: { project?: string; limit?: number }) => Array<{ sessionId: string }>;
  };
  return (db, q, o) => mod.searchSessions({ getDb: () => db }, q, o);
}

async function main() {
  const pkgDir = process.argv[2] ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-hermes-memory");
  const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const dbPath = join(FIXTURE_DIR, "sessions.db");
  buildFixtureDb(dbPath);
  const search = await loadInstalledSearch(pkgDir);
  const db = new DatabaseSync(dbPath);
  const expected: Record<string, string[]> = {};
  for (const q of QUERIES) expected[q.query] = search(db, q.query, { project: q.project, limit: 10 }).map((r) => r.sessionId);
  db.exec("PRAGMA journal_mode=DELETE");
  db.close();
  writeFileSync(join(FIXTURE_DIR, "queries.json"), `${JSON.stringify(QUERIES, null, 2)}\n`);
  writeFileSync(join(FIXTURE_DIR, "expected.json"), `${JSON.stringify({ hermesVersion: version, expected }, null, 2)}\n`);
  console.log(`golden regenerated against pi-hermes-memory ${version}: ${QUERIES.length} queries`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
