#!/usr/bin/env node
/**
 * E2E-ONLY seed: lower pi's `compaction.keepRecentTokens`.
 *
 * A manual `/compact` runs `prepareCompaction` FIRST, which returns undefined
 * (→ "Nothing to compact") when no entry falls outside the kept-recent window.
 * The shipped default (20000) therefore needs ~80 KB of context before a
 * boundary can be produced — which would force the replay-compaction-boundary
 * browser specs to build enormous transcript rows and stream them at the faux
 * model's tokens/second. Seeding a small value lets a handful of small turns
 * cross the cut point. Never shipped; gated behind `PI_E2E_SEED`.
 *
 * Pure `mergeE2ECompaction` + a thin file wrapper (same shape as
 * `seed-settings-default-model.mjs`) so the L1 suite reaches the merge decision
 * without a prompt.
 *
 * See change: replay-compaction-boundary.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const E2E_KEEP_RECENT_TOKENS = 100;

/**
 * Pure merge: set `compaction.keepRecentTokens` when the config does not
 * already carry one (never clobber an explicit value). Returns the same object
 * reference + `changed:false` on a no-op.
 *
 * @param {Record<string, unknown>} cfg
 * @param {number} keepRecentTokens
 * @returns {{ cfg: Record<string, unknown>, changed: boolean }}
 */
export function mergeE2ECompaction(cfg, keepRecentTokens = E2E_KEEP_RECENT_TOKENS) {
  if (cfg.compaction?.keepRecentTokens !== undefined) return { cfg, changed: false };
  return {
    cfg: { ...cfg, compaction: { ...(cfg.compaction ?? {}), keepRecentTokens } },
    changed: true,
  };
}

/**
 * File wrapper: missing file → fresh `{}`; present-but-unparseable → left
 * untouched (exit 0); writes pretty JSON only when the merge changed something.
 *
 * @param {string} p settings.json path
 * @param {number} keepRecentTokens
 */
export function seedFile(p, keepRecentTokens = E2E_KEEP_RECENT_TOKENS) {
  let raw = null;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err; // only a MISSING file is fresh
    raw = null;
  }

  let cfg;
  if (raw === null) {
    cfg = {};
  } else {
    try {
      cfg = JSON.parse(raw);
    } catch {
      return; // present but unparseable → leave untouched
    }
  }

  const { cfg: merged, changed } = mergeE2ECompaction(cfg, keepRecentTokens);
  if (!changed) return;

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(
    `[test-entrypoint] PI_E2E_SEED: seeded compaction.keepRecentTokens=${keepRecentTokens} → ${p}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = process.argv[3];
  seedFile(process.argv[2], arg === undefined ? E2E_KEEP_RECENT_TOKENS : Number(arg));
}
