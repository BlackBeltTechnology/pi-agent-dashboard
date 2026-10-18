// Per-source schema-version / options-hash gate, shared by every docs writer
// (`kb index`, CLI auto-index, kb-extension reindex, dashboard reindex job).
// A source is forced to re-chunk when its `gate:<root>` record is absent or differs
// from `<SCHEMA_VERSION>:<indexOptionsHash>`, and is stamped only after its walk
// completed (not skipped, not missing, not thrown) — so a skipped, untrusted or
// failed source stays due. See change: fix-kb-index-integrity (D6).
import { frontmatterConfigHash, type IndexGateConfig, indexOptionsHash } from "./config.js";
import { SCHEMA_VERSION } from "./sqlite-store.js";
import type { KbStore } from "./types.js";

const gateKey = (root: string) => `gate:${root}`;
const gateValue = (cfg: IndexGateConfig) => `${SCHEMA_VERSION}:${indexOptionsHash(cfg)}`;

/** True when `root` must be force-reindexed: no current record, or the DB's
 *  `user_version` is behind the build's. */
export function sourceGateIsStale(store: KbStore, cfg: IndexGateConfig, root: string): boolean {
  if ((store.getUserVersion?.() ?? 0) < SCHEMA_VERSION) return true;
  return (store.getMeta?.(gateKey(root)) ?? null) !== gateValue(cfg);
}

/** Record that `root` was walked to completion under the current options. */
export function stampSource(store: KbStore, cfg: IndexGateConfig, root: string): void {
  store.setMeta?.(gateKey(root), gateValue(cfg));
}

/** Back-compat stamps written after every successful pass, read by pre-change code
 *  (`user_version` + the FRONTMATTER-ONLY `facetConfigHash`) so a rollback does not
 *  force a reindex. */
export function stampPass(store: KbStore, cfg: IndexGateConfig): void {
  store.setUserVersion?.(SCHEMA_VERSION);
  store.setMeta?.("facetConfigHash", frontmatterConfigHash(cfg.frontmatter));
}
