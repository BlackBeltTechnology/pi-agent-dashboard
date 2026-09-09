#!/usr/bin/env node
/**
 * Seed pi's settings.json with a SPLIT defaultProvider + defaultModel so the
 * faux model is selected at pi startup (before the bridge gate runs).
 *
 * pi 0.84 reads `defaultProvider` + `defaultModel` as separate keys; a combined
 * `defaultModel:"faux/faux-1"` no longer resolves. This module owns the merge
 * decision-table (pure `mergeDefaultModel`) plus a thin file wrapper so the L1
 * suite can reach the logic without an inline `node -e` program in the shell.
 *
 * See change: split-faux-seed-default-provider.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Pure merge: decide the split defaultProvider/defaultModel for a settings cfg.
 * All mutation is gated on an ABSENT `defaultProvider` (never clobber a real
 * provider). When a combined `defaultModel` is present it is normalized by
 * splitting on the FIRST `/`; otherwise faux is pinned (defaultModel only when
 * absent). Returns the same object reference + `changed:false` on a no-op.
 *
 * @param {Record<string, unknown>} cfg
 * @returns {{ cfg: Record<string, unknown>, changed: boolean }}
 */
export function mergeDefaultModel(cfg) {
  if (cfg.defaultProvider) return { cfg, changed: false };

  const dm = cfg.defaultModel;
  if (typeof dm === "string" && dm.includes("/")) {
    const i = dm.indexOf("/");
    return {
      cfg: { ...cfg, defaultProvider: dm.slice(0, i), defaultModel: dm.slice(i + 1) },
      changed: true,
    };
  }

  const next = { ...cfg, defaultProvider: "faux" };
  if (!dm) next.defaultModel = "faux-1";
  return { cfg: next, changed: true };
}

/**
 * File wrapper: read `p` (missing → treat as `{}`), leave a present-but-
 * unparseable file untouched (exit 0), write pretty JSON only when the merge
 * changed something, and log the seed line only on write.
 *
 * @param {string} p settings.json path
 */
export function seedFile(p) {
  let raw = null;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err; // only a MISSING file is fresh; surface EACCES/EISDIR
    raw = null; // missing file → fresh cfg
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

  const { cfg: merged, changed } = mergeDefaultModel(cfg);
  if (!changed) return;

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`[test-entrypoint] PI_E2E_SEED: seeded defaultProvider+defaultModel → ${p}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  seedFile(process.argv[2]);
}
