/**
 * Work-source registry — keyed by source id, mirroring `trigger-registry.ts`.
 *
 * Holds STABLE source instances (a work-source carries lease state, so it must
 * not be re-collected per read like the action registry). `automation-schema`
 * validates `on.source` against `ids()`; the engine resolves the instance via
 * `get(id)` at fire time.
 *
 * See change: automation-work-source-fanout.
 */
import type { WorkSource } from "../shared/work-source.js";

export class WorkSourceRegistry {
  private sources = new Map<string, WorkSource>();

  register(id: string, source: WorkSource): void {
    this.sources.set(id, source);
  }

  get(id: string): WorkSource | undefined {
    return this.sources.get(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  ids(): Set<string> {
    return new Set(this.sources.keys());
  }
}
