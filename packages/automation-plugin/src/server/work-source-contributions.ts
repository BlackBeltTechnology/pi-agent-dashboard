/**
 * Cross-plugin work-source registration seam (the collect half).
 *
 * Any plugin publishes one contribution — `{ id, source }`, or an array of
 * them — under `automation.worksource.<source>`; this module collects the
 * published values into validated descriptors, which `server/index.ts` wraps in
 * a `WorkSourceProvider` consulted lazily by the registry. Mirrors the action
 * registry's publish/collect shape (`ACTION_CONTRIBUTION_PREFIX`), so load
 * order is irrelevant and the publishing plugin keeps ownership of its
 * instance — a work-source carries lease state, so the instance MUST be created
 * once by its owner and never re-collected into a copy.
 *
 * Deliberately domain-free: the collector validates only the structural
 * contract (`next`/`ack`/`nack`), never what an item is.
 *
 * See change: relocate-fanout-to-work-source.
 */
import type { AnyWorkSource } from "../shared/work-source.js";

/** Key prefix a plugin publishes its work-sources under. */
export const WORK_SOURCE_CONTRIBUTION_PREFIX = "automation.worksource.";

/** One published work-source: the id an automation names in `on.source`. */
export interface WorkSourceContribution {
  id: string;
  source: AnyWorkSource;
}

/** Structural check: the three required members of the work-source contract. */
function isWorkSource(v: unknown): v is AnyWorkSource {
  const s = v as Partial<AnyWorkSource> | null;
  return (
    !!s &&
    typeof s === "object" &&
    typeof s.next === "function" &&
    typeof s.ack === "function" &&
    typeof s.nack === "function"
  );
}

/**
 * Collect published contributions into validated descriptors. An entry with a
 * missing/empty id, a non-conforming source, or a duplicate id is dropped with
 * a warning — one bad publisher never costs the others their sources.
 */
export function collectWorkSourceContributions(
  entries: Array<{ key: string; value: unknown }>,
  opts?: { warn?: (msg: string) => void },
): WorkSourceContribution[] {
  const warn = opts?.warn ?? (() => {});
  const out: WorkSourceContribution[] = [];
  const seen = new Set<string>();
  for (const { key, value } of entries) {
    const contribs = Array.isArray(value) ? value : [value];
    for (const c of contribs) {
      const entry = c as Partial<WorkSourceContribution> | null;
      if (!entry || typeof entry !== "object") {
        warn(`automation work-source "${key}": ignored — not an object`);
        continue;
      }
      if (typeof entry.id !== "string" || entry.id.trim() === "") {
        warn(`automation work-source "${key}": ignored — missing/empty id`);
        continue;
      }
      if (!isWorkSource(entry.source)) {
        warn(`automation work-source "${entry.id}" (${key}): ignored — not a work source (next/ack/nack)`);
        continue;
      }
      if (seen.has(entry.id)) {
        warn(`automation work-source "${entry.id}" (${key}): ignored — duplicate id`);
        continue;
      }
      seen.add(entry.id);
      out.push({ id: entry.id, source: entry.source });
    }
  }
  return out;
}
