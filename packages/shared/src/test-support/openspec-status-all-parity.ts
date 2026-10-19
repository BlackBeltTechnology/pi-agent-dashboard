/**
 * Shared body of the `openspec-status-all-parity*.test.ts` shards.
 *
 * Guards the `status --all` poll path against the CLI it replaces, for the
 * repo's own active changes:
 *   (a) a change WITHOUT a CLI error: the `--all` artifact list equals
 *       `openspec status --change <name>` as a set of `id:status`;
 *   (b) a change WITH an error in `--all` also fails its per-change call;
 *   (c) locally counted `completedTasks`/`totalTasks` equal `openspec list`
 *       for every change present in both outputs whose schema is project-local
 *       or built-in (a schema shadowed from the user dir is excluded — it is
 *       outside the dashboard's gate by design).
 *
 * The per-change spawns run through a bounded pool and are partitioned across
 * shard files by a stable hash of the change name (same reasoning as
 * `openspec-poller-parity.ts`). The test skips ONLY when the CLI is genuinely
 * absent: a parse failure of present output fails the test.
 * `expect` is injected so this module needs no `vitest` dependency.
 *
 * See change: use-openspec-status-all.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  buildOpenSpecDataFromStatusAll,
  runOpenSpecList,
  runOpenSpecStatus,
  runOpenSpecStatusAll,
} from "../openspec-poller.js";
import { classifyStatusAll, mapLimit } from "../openspec-status-all.js";
import { userSchemasDir } from "../platform/openspec.js";

// repo root: packages/shared/src/test-support → ../../../..
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PARITY_SHARDS = 3;

function shardOf(name: string): number {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return sum % PARITY_SHARDS;
}

const artifactSet = (arts: Array<{ id: string; status: string }>) =>
  arts.map((a) => `${a.id}:${a.status}`).sort();

type Expect = (actual: unknown, message?: string) => { toEqual(expected: unknown): void; toBe(expected: unknown): void };

export async function runStatusAllParityShard(shard: number, expect: Expect): Promise<void> {
  const raw = await runOpenSpecStatusAll(REPO_ROOT);
  if (raw.failure === "not-found") return; // CLI genuinely absent → skip (and only then)

  const classified = classifyStatusAll(raw);
  // Present CLI + unusable output is a FAILURE, never a skip.
  expect(classified.kind, `status --all classification (stderr: ${raw.stderr.slice(0, 200)})`).toBe("ok");
  if (classified.kind !== "ok") return;

  const entries = classified.entries.filter((e) => shardOf(e.changeName) === shard);
  if (entries.length === 0) return;

  const list = await runOpenSpecList(REPO_ROOT);
  expect(Array.isArray(list?.changes), "openspec list --json parsed").toBe(true);
  const listByName = new Map((list?.changes ?? []).map((c) => [c.name, c]));

  const built = await buildOpenSpecDataFromStatusAll({
    cwd: REPO_ROOT,
    openspecDir: realpathSync(path.join(REPO_ROOT, "openspec")),
    rootPath: classified.root.path,
    entries,
    orderMtimes: {},
  });
  const builtByName = new Map(built.data.changes.map((c) => [c.name, c]));
  const userDir = userSchemasDir();

  await mapLimit(entries, 8, async (entry) => {
    const name = entry.changeName;
    const mine = builtByName.get(name)!;
    const perChange = await runOpenSpecStatus(REPO_ROOT, name);

    if (mine.error) {
      // (b) an error in `--all` ⇔ the per-change call fails.
      expect(perChange, `per-change status for broken change ${name}`).toBe(null);
    } else {
      // (a) artifact sets equal — compared on the RAW CLI lists (before dashboard overrides).
      const rawEntry = entry.artifacts ?? [];
      expect(artifactSet(rawEntry), `artifacts for ${name}`).toEqual(artifactSet(perChange?.artifacts ?? []));
    }

    // (c) local counts equal `openspec list` (built-in / project-local schemas only).
    const listed = listByName.get(name);
    const userShadowed = entry.schemaName ? existsSync(path.join(userDir, entry.schemaName, "schema.yaml")) : false;
    if (listed && !userShadowed) {
      expect([mine.completedTasks, mine.totalTasks], `task counts for ${name}`).toEqual([
        listed.completedTasks,
        listed.totalTasks,
      ]);
    }
  });
}
