/**
 * Work-source registry — keyed by source id, mirroring `trigger-registry.ts`.
 *
 * Holds STABLE source instances (a work-source carries lease state, so it must
 * not be re-collected per read like the action registry). `automation-schema`
 * validates `on.source` against `ids()`; the engine resolves the instance via
 * `get(id)` at fire time.
 *
 * Two population paths, both yielding STABLE instances:
 *   - `register(id, source)` — sources this plugin constructs itself (config-
 *     declared folder sources);
 *   - `addProvider(p)` — the CROSS-PLUGIN seam: another plugin owns the
 *     instance (and therefore its lease state) and exposes it through a
 *     provider resolved lazily on every read, so plugin load order is
 *     irrelevant. Locally registered ids win a collision.
 *
 * See change: automation-work-source-fanout, relocate-fanout-to-work-source.
 */
import type { AnyWorkSource } from "../shared/work-source.js";

/**
 * A lazily-consulted supplier of work-sources owned OUTSIDE this plugin. Read
 * on every `get`/`has`/`ids`, so a provider registered before the owning plugin
 * activated starts resolving as soon as it does.
 * See change: relocate-fanout-to-work-source.
 */
export interface WorkSourceProvider {
  /** Ids this provider can resolve right now (drives schema validation). */
  ids(): Iterable<string>;
  /** The stable instance for `id`, or undefined when this provider has none. */
  get(id: string): AnyWorkSource | undefined;
}

export class WorkSourceRegistry {
  private sources = new Map<string, AnyWorkSource>();
  private providers: WorkSourceProvider[] = [];

  register(id: string, source: AnyWorkSource): void {
    this.sources.set(id, source);
  }

  /** Add a cross-plugin provider (see {@link WorkSourceProvider}). */
  addProvider(provider: WorkSourceProvider): void {
    this.providers.push(provider);
  }

  get(id: string): AnyWorkSource | undefined {
    const own = this.sources.get(id);
    if (own) return own;
    for (const p of this.providers) {
      // A provider is foreign code resolved on a hot path — isolate its throw.
      try {
        const hit = p.get(id);
        if (hit) return hit;
      } catch {
        /* provider unavailable — try the next */
      }
    }
    return undefined;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  ids(): Set<string> {
    const all = new Set(this.sources.keys());
    for (const p of this.providers) {
      try {
        for (const id of p.ids()) all.add(id);
      } catch {
        /* provider unavailable — skip */
      }
    }
    return all;
  }
}
