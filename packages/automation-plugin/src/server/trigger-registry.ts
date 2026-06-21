/**
 * Extensible trigger registry — the phase-1 seam for future event/plugin
 * trigger kinds.
 *
 * A `TriggerType` knows how to `parse` its kind-specific `on:` block into a
 * typed config and to `arm` that config against a `fire` callback, returning
 * a `Disposable` so the scheduler can dispose+re-arm on config change.
 *
 * Phase 1 registers only `schedule`. Later kinds (e.g. `openspec.complete`,
 * `slack.message`) register through the SAME interface — the on-disk
 * `automation.yaml` format never churns.
 *
 * See change: add-automation-plugin.
 */

export interface Disposable {
  dispose(): void;
}

/** Context handed to a trigger's `fire` callback when it fires. */
export interface FireContext {
  /** Epoch ms of the occurrence that fired. */
  firedAt: number;
}

export interface TriggerType<Cfg = unknown> {
  /** The `on.kind` value this type handles (e.g. "schedule"). */
  kind: string;
  /**
   * Validate + narrow the raw `on:` block into a typed config. Throws (or
   * returns via thrown Error) on invalid input; the scheduler treats a
   * throw as "automation invalid, isolate it".
   */
  parse(rawOn: unknown): Cfg;
  /**
   * Subscribe the trigger. Call `fire(ctx)` on each occurrence. Return a
   * Disposable; calling `dispose()` MUST stop all future fires.
   */
  arm(cfg: Cfg, fire: (ctx: FireContext) => void, deps: ArmDeps): Disposable;
}

/** Ambient dependencies an `arm` implementation may use (injectable for tests). */
export interface ArmDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { clear: () => void };
}

export class TriggerRegistry {
  private types = new Map<string, TriggerType>();

  register(type: TriggerType): void {
    this.types.set(type.kind, type);
  }

  get(kind: string): TriggerType | undefined {
    return this.types.get(kind);
  }

  has(kind: string): boolean {
    return this.types.has(kind);
  }

  kinds(): Set<string> {
    return new Set(this.types.keys());
  }
}
