// Per-source schema-version / options-hash gate, shared by every docs writer
// (`kb index`, CLI auto-index, kb-extension reindex, dashboard reindex job).
// A source is forced to re-chunk when its `gate:<root>` record is absent or differs
// from `<SCHEMA_VERSION>:<indexOptionsHash>`, and is stamped only after its walk
// completed (not skipped, not missing, not thrown) — so a skipped, untrusted or
// failed source stays due. See change: fix-kb-index-integrity (D6).
import { readFileSync } from "node:fs";
import { frontmatterConfigHash, type IndexGateConfig, indexOptionsHash } from "./config.js";
import { SCHEMA_VERSION } from "./sqlite-store.js";
import type { KbStore } from "./types.js";

const gateKey = (root: string) => `gate:${root}`;
const engineKey = (root: string) => `engine:${root}`;
const gateValue = (cfg: IndexGateConfig) => `${SCHEMA_VERSION}:${indexOptionsHash(cfg)}`;

let engineCache: string | null | undefined;
/** The running kb engine: `srcHash` of the shipped `engine-fingerprint.json`, read once per
 *  process; `null` when it cannot be read (then no engine record is kept or required and no
 *  seed is accepted). `KB_ENGINE_FINGERPRINT` overrides it (test seam for child processes).
 *  See change: add-kb-worktree-seed (D6). */
export function runningEngine(): string | null {
  if (engineCache !== undefined) return engineCache;
  const env = process.env.KB_ENGINE_FINGERPRINT;
  if (env) return (engineCache = env);
  try {
    const raw = JSON.parse(readFileSync(new URL("../engine-fingerprint.json", import.meta.url), "utf8")) as { srcHash?: unknown };
    engineCache = typeof raw.srcHash === "string" && raw.srcHash ? raw.srcHash : null;
  } catch {
    engineCache = null;
  }
  return engineCache;
}
/** Test seam: pin the running engine (`undefined` re-reads the fingerprint file). */
export function setRunningEngineForTest(v: string | null | undefined): void {
  engineCache = v;
}

/** True when `root` must be force-reindexed: no current record, a record written by another
 *  kb engine (absent counts), or the DB's `user_version` is behind the build's. */
export function sourceGateIsStale(store: KbStore, cfg: IndexGateConfig, root: string): boolean {
  if ((store.getUserVersion?.() ?? 0) < SCHEMA_VERSION) return true;
  if ((store.getMeta?.(gateKey(root)) ?? null) !== gateValue(cfg)) return true;
  const eng = runningEngine();
  return eng !== null && (store.getMeta?.(engineKey(root)) ?? null) !== eng;
}

/** Record that `root` was walked to completion under the current options and engine. */
export function stampSource(store: KbStore, cfg: IndexGateConfig, root: string, opts: { engine?: string | null } = {}): void {
  store.setMeta?.(gateKey(root), gateValue(cfg));
  const eng = opts.engine === undefined ? runningEngine() : opts.engine;
  if (eng !== null) store.setMeta?.(engineKey(root), eng);
}

/** For a FORCED pass of `root`: returns the hook that clears its engine record inside the first
 *  batch's transaction (pass it as `IndexOptions.onFirstBatch`). An interrupted forced pass then
 *  leaves no record, so its partly rebuilt rows are never trusted as a seed and the next pass
 *  forces the source again. `stampSource` writes the record back on completion. */
export function beginForcedSource(store: KbStore, root: string): () => void {
  return () => store.deleteMeta?.(engineKey(root));
}

/** True when `root`'s rows in `store` were produced by the running engine under the current options. */
export function sourceIsSeedable(store: KbStore, cfg: IndexGateConfig, root: string): boolean {
  return runningEngine() !== null && !sourceGateIsStale(store, cfg, root);
}

/** Back-compat stamps written after every successful pass, read by pre-change code
 *  (`user_version` + the FRONTMATTER-ONLY `facetConfigHash`) so a rollback does not
 *  force a reindex. */
export function stampPass(store: KbStore, cfg: IndexGateConfig): void {
  store.setUserVersion?.(SCHEMA_VERSION);
  store.setMeta?.("facetConfigHash", frontmatterConfigHash(cfg.frontmatter));
}
