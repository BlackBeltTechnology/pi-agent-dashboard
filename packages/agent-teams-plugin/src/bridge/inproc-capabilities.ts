/**
 * Lead-bridge capability probe (design D10, spec "Availability gate"): asks `subagents:capabilities` over the
 * lead's event bus and turns the answer into a fail-closed verdict (`shared/subagents-contract.ts`), reporting every
 * probe result through `report` (the caller sends it as an `inproc hello`).
 *
 * Triggers (the host wires them): `session_start`, the FIRST `subagents:*` event while unavailable (the probe at
 * `session_start` may have lost the race with the subagents extension's own activation), and every empty reply of a
 * later spawn/steer request. At most ONE probe is in flight (a burst of events never storms); an answer arriving after
 * the 500 ms deadline never flips that probe's verdict, the next trigger re-probes. The handler fills `out` before
 * `emit` returns (a plain object, or a Promise for an async answer); no `out` at all means nobody is listening.
 * See change: add-agent-teams-in-process.
 */
import type { Clock } from "../shared/clock.js";
import { type CapabilityVerdict, evaluateCapabilities, SUBAGENTS_CHANNEL } from "../shared/subagents-contract.js";

/** The slice of `pi.events` the probe uses. */
export interface ProbeBus {
  emit(channel: string, payload: unknown): void;
}

export const CAPABILITY_PROBE_TIMEOUT_MS = 500;

export type ProbeTrigger = "session_start" | "subagents_event" | "empty_reply";

export interface CapabilityProberDeps {
  bus: ProbeBus;
  clock: Clock;
  /** Called once per finished probe with its verdict (send an `inproc hello`). Must not throw. */
  report(verdict: CapabilityVerdict, trigger: ProbeTrigger): void;
  timeoutMs?: number;
}

export interface CapabilityProber {
  /** Probe now; joins a probe already in flight. */
  probe(trigger: ProbeTrigger): Promise<CapabilityVerdict>;
  /** A `subagents:*` event arrived: re-probe once when still unavailable. */
  onSubagentsEvent(): void;
  /** A spawn/steer request returned with no `out`: repeat the probe. */
  onEmptyReply(): void;
  /** The last settled verdict. */
  readonly verdict: CapabilityVerdict | undefined;
  /** Forget everything (session shutdown). */
  dispose(): void;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => v !== null && typeof v === "object" && typeof (v as { then?: unknown }).then === "function";

export function createCapabilityProber(deps: CapabilityProberDeps): CapabilityProber {
  const timeoutMs = deps.timeoutMs ?? CAPABILITY_PROBE_TIMEOUT_MS;
  let verdict: CapabilityVerdict | undefined;
  let inFlight: Promise<CapabilityVerdict> | undefined;
  let eventProbed = false;
  let disposed = false;

  /** Ask the bus. A synchronous answer settles at once; a Promise races the inclusive deadline; nothing at all means nobody listens. */
  function ask(settle: (answer: unknown) => void, armDeadline: (fire: () => void) => void): void {
    const query: { out?: unknown } = {};
    try {
      deps.bus.emit(SUBAGENTS_CHANNEL.capabilities, query);
    } catch {
      settle(undefined);
      return;
    }
    const out = query.out;
    if (!isThenable(out)) {
      settle(out); // undefined = the extension is absent
      return;
    }
    // Inclusive deadline: a reply AT `timeoutMs` still counts, so the verdict is taken one 0 ms tick after the timer.
    armDeadline(() => settle(undefined));
    out.then(settle, () => settle(undefined));
  }

  /** Record and report a finished probe (a disposed prober reports nothing). */
  function conclude(answer: unknown, trigger: ProbeTrigger): CapabilityVerdict {
    const v = evaluateCapabilities(answer);
    if (disposed) return v;
    verdict = v;
    try {
      deps.report(v, trigger);
    } catch {
      // the reporter owns its errors; a probe never throws into the bridge
    }
    return v;
  }

  function run(trigger: ProbeTrigger): Promise<CapabilityVerdict> {
    return new Promise<CapabilityVerdict>((resolve) => {
      let settled = false;
      let deadline: unknown;
      const settle = (answer: unknown): void => {
        if (settled) return;
        settled = true;
        if (deadline !== undefined) deps.clock.clearTimeout(deadline);
        resolve(conclude(answer, trigger));
      };
      ask(settle, (fire) => {
        deadline = deps.clock.setTimeout(() => {
          deadline = deps.clock.setTimeout(fire, 0);
        }, timeoutMs);
      });
    });
  }

  function probe(trigger: ProbeTrigger): Promise<CapabilityVerdict> {
    if (inFlight) return inFlight;
    if (trigger === "session_start") eventProbed = false; // a new session: the first subagents event may re-probe again
    const p = run(trigger);
    inFlight = p;
    void p.finally(() => {
      if (inFlight === p) inFlight = undefined;
    });
    return p;
  }

  return {
    probe,
    onSubagentsEvent() {
      if (disposed || eventProbed || inFlight || verdict?.available === true) return;
      eventProbed = true;
      void probe("subagents_event");
    },
    onEmptyReply() {
      if (disposed) return;
      void probe("empty_reply");
    },
    get verdict() {
      return verdict;
    },
    dispose() {
      disposed = true;
      verdict = undefined;
      inFlight = undefined;
      eventProbed = false;
    },
  };
}
