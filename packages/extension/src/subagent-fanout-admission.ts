/**
 * Subagent fan-out admission — the pure decision function plus the stateful
 * gate the bridge wires onto `tool_call` / `tool_execution_end`.
 *
 * The capability: keep a parent session alive through a wide `Agent` fan-out on
 * a loaded host by bounding how many children are in flight at once, refusing
 * the excess visibly and terminally instead of letting the parent stall and be
 * reaped. See change: bound-subagent-fanout-under-host-pressure.
 *
 * Three properties are load-bearing and easy to "simplify" away:
 *
 *  - **The bound is in-flight concurrency, not batch width.** The extension
 *    `tool_call` event carries only `{type, toolCallId, toolName, input}` — the
 *    assistant message is dropped before the extension sees it — so batch size
 *    and identity are not knowable at decision time. The count rises at
 *    ADMISSION, not execution: siblings preflight before any executes, so a
 *    count keyed on execution would read zero across a whole batch and admit it.
 *  - **Release on `tool_execution_end`, never `tool_result`.** An aborted call
 *    (Esc) finalizes with an error result and `tool_execution_end` but SKIPS the
 *    path that produces the extension's `tool_result`; a counter released on
 *    `tool_result` would leak a permit on every abort and eventually refuse all
 *    subagent work for the session.
 *  - **Never wait on a child.** Siblings are preflighted sequentially and only
 *    then executed concurrently, so awaiting a child deadlocks by construction.
 *    Admission is synchronous, reject-only; it never delays an admitted call.
 *
 * See change: bound-subagent-fanout-under-host-pressure (D2/D3/D4/D6/D8).
 */

import {
  resolveMaxConcurrentSubagents,
  parseSubagentSaturation,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { SaturationReading, SaturationThresholds } from "./subagent-saturation.js";

/** Resolved admission configuration. */
export interface AdmissionConfig {
  /** Effective cap: `0` = disabled; `Infinity` = fail-open/uncapped; else ≥ 1. */
  maxConcurrentSubagents: number;
  thresholds: SaturationThresholds;
}

/** Resolve admission config from a raw/dashboard-shaped object. Malformed admits. */
export function resolveAdmissionConfig(
  raw:
    | {
        maxConcurrentSubagents?: unknown;
        subagentSaturation?: unknown;
      }
    | undefined,
): AdmissionConfig {
  return {
    maxConcurrentSubagents: resolveMaxConcurrentSubagents(raw?.maxConcurrentSubagents),
    thresholds: parseSubagentSaturation(raw?.subagentSaturation) ?? {},
  };
}

export type AdmissionCause = "cap" | "saturation";

export type AdmissionDecision =
  | { action: "admit" }
  | { action: "refuse"; cause: AdmissionCause; reason: string };

/**
 * The effective cap for one decision. Disabled / malformed / non-finite → the
 * uncapped sentinel. Saturation narrows to a SINGLE child, never to zero, so a
 * saturated session still makes progress.
 */
export function effectiveCap(maxConcurrentSubagents: number, saturated: boolean): number {
  if (!Number.isFinite(maxConcurrentSubagents) || maxConcurrentSubagents < 1) {
    return Number.POSITIVE_INFINITY;
  }
  return saturated ? Math.min(maxConcurrentSubagents, 1) : maxConcurrentSubagents;
}

/** Model-facing refusal text: cause, in-flight count, and "re-issue after". */
export function refusalReason(cause: AdmissionCause, inFlight: number, cap: number): string {
  const running = `${inFlight} subagent${inFlight === 1 ? "" : "s"} already running`;
  const tail = "Re-issue after the running subagents finish.";
  if (cause === "saturation") {
    return `Refused by host admission: resource saturation (${running}). ${tail}`;
  }
  return `Refused by host admission: at the concurrency cap of ${cap} (${running}). ${tail}`;
}

/**
 * The decision. Pure and synchronous: in-flight count + config + saturation →
 * admit or refuse. It consults no child state and awaits nothing.
 */
export function decideAdmission(input: {
  inFlight: number;
  config: AdmissionConfig;
  saturated: boolean;
}): AdmissionDecision {
  const cap = effectiveCap(input.config.maxConcurrentSubagents, input.saturated);
  if (input.inFlight < cap) return { action: "admit" };
  const cause: AdmissionCause = input.saturated ? "saturation" : "cap";
  return { action: "refuse", cause, reason: refusalReason(cause, input.inFlight, cap) };
}

export interface FanoutAdmissionCounters {
  /** Calls admitted (a permit was taken). */
  fanoutAdmitted: number;
  /** Calls refused by the gate (any cause). */
  fanoutRefused: number;
  /** Refusals whose cause was resource saturation. */
  fanoutSaturationRefused: number;
}

/** A refusal, as written to the durable session record. */
export interface FanoutRefusalRecord {
  toolCallId: string;
  cause: AdmissionCause;
  inFlight: number;
  cap: number;
  reason: string;
  at: number;
}

export interface RefusalSaturationSource {
  read(thresholds: SaturationThresholds): { saturated: boolean; reading: SaturationReading };
}

export interface FanoutAdmissionGateOptions {
  /** Resolve the current config for each decision. */
  resolveConfig: () => AdmissionConfig;
  /** Synchronous saturation source (the sampler). */
  saturation: RefusalSaturationSource;
  /**
   * Durable refusal recorder. Called ONLY on refusal (the admit path stays free
   * of filesystem I/O). Its failure must never change the verdict.
   */
  recordRefusal?: (record: FanoutRefusalRecord) => void;
  /** Injectable clock for the durable record's `at`. */
  now?: () => number;
}

/**
 * The stateful gate: owns the admitted-id set (permits), the counters, and the
 * fail-open wrapping. Every public method is synchronous and non-throwing.
 */
export class FanoutAdmissionGate {
  private readonly admitted = new Set<string>();
  private readonly resolveConfig: () => AdmissionConfig;
  private readonly saturation: RefusalSaturationSource;
  private readonly recordRefusal?: (record: FanoutRefusalRecord) => void;
  private readonly now: () => number;

  readonly counters: FanoutAdmissionCounters = {
    fanoutAdmitted: 0,
    fanoutRefused: 0,
    fanoutSaturationRefused: 0,
  };

  constructor(opts: FanoutAdmissionGateOptions) {
    this.resolveConfig = opts.resolveConfig;
    this.saturation = opts.saturation;
    this.recordRefusal = opts.recordRefusal;
    this.now = opts.now ?? Date.now;
  }

  /** Current in-flight children (permits held). */
  get inFlight(): number {
    return this.admitted.size;
  }

  /**
   * Decide one `Agent` tool call. Returns `{block:true, reason}` to refuse, or
   * `undefined` to admit unchanged. Any failure in the decision path admits.
   */
  onToolCall(event: {
    toolName?: unknown;
    toolCallId?: unknown;
  }): { block: true; reason: string } | undefined {
    try {
      if (!event || event.toolName !== "Agent" || typeof event.toolCallId !== "string") {
        return undefined;
      }
      const config = this.resolveConfig();
      const cap = config.maxConcurrentSubagents;
      // Disabled / malformed / fail-open: exact no-op — no sampler read, no
      // permit, no durable write, no delay.
      if (!Number.isFinite(cap) || cap < 1) return undefined;

      const { saturated } = this.saturation.read(config.thresholds);
      const decision = decideAdmission({ inFlight: this.admitted.size, config, saturated });

      if (decision.action === "admit") {
        this.admitted.add(event.toolCallId);
        this.counters.fanoutAdmitted += 1;
        return undefined;
      }

      this.counters.fanoutRefused += 1;
      if (decision.cause === "saturation") this.counters.fanoutSaturationRefused += 1;
      if (this.recordRefusal) {
        try {
          this.recordRefusal({
            toolCallId: event.toolCallId,
            cause: decision.cause,
            inFlight: this.admitted.size,
            cap,
            reason: decision.reason,
            at: this.now(),
          });
        } catch {
          // Observability must never change the verdict.
        }
      }
      return { block: true, reason: decision.reason };
    } catch {
      // Fail open: a throwing handler would make pi refuse every Agent call.
      return undefined;
    }
  }

  /**
   * Release a permit on `tool_execution_end` — the signal pi emits on the
   * normal, blocked AND aborted paths. Keyed to ids this gate ADMITTED, so a
   * refused (or foreign) id returns nothing.
   */
  onExecutionEnd(event: { toolCallId?: unknown }): void {
    if (!event || typeof event.toolCallId !== "string") return;
    this.admitted.delete(event.toolCallId);
  }

  /** Session change / shutdown: drop every held permit and the counters' basis. */
  reset(): void {
    this.admitted.clear();
  }
}
