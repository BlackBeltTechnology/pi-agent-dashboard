/**
 * In-memory server ↔ lead-bridge lane harness with fault injection (task 2.5). It sits on a `TeamsEnv` (real server
 * runtime over the fake host, `FakeClock`): every `agent-teams:inproc` command the server emits to the lead session is
 * delivered to a scripted fake bridge (`onCommand`), and the bridge's `hello` / `ack` reach the server through the REAL
 * lane handler `agent-teams/inproc`. Faults apply per direction and per message, all on the injected fake clock:
 *   - `drop`      the message never arrives
 *   - `delayMs`   arrives later (a different delay per message also REORDERS them)
 *   - `duplicate` arrives twice (the copy right after the first)
 * No process boundary, no pi, no real timers.
 * See change: add-agent-teams-in-process.
 */
import type { InProcAck, InProcCommand, InProcHelloPayload } from "../../shared/inproc-protocol.js";
import { LANE_INPROC } from "../../shared/inproc-protocol.js";
import { REQUIRED_API_VERSION, REQUIRED_FEATURES, type SubagentsFeature, type UnavailableReason } from "../../shared/subagents-contract.js";
import type { RecordedEmit } from "./fake-host-ctx.js";
import type { TeamsEnv } from "./teams-env.js";

interface MessageFault {
  drop?: boolean;
  delayMs?: number;
  duplicate?: boolean;
}

interface LaneFaults {
  /** Server → bridge commands. */
  toBridge?: (cmd: InProcCommand, n: number) => MessageFault | undefined;
  /** Bridge → server acks. */
  toServer?: (ack: InProcAck, n: number) => MessageFault | undefined;
}

export type HelloShape =
  | { available: true; features?: readonly SubagentsFeature[]; maxConcurrent?: number; apiVersion?: number }
  | { available: false; reason: UnavailableReason; missing?: string[] };

export interface InProcLinkOptions {
  /** Lead session id the commands go to (default `env.lead`). */
  lead?: string;
  faults?: LaneFaults;
  /**
   * The scripted bridge: gets every command that arrives; the returned ack (default `undefined` = no ack) is sent back after
   * `afterMs` (default 0 = immediately, synchronously).
   */
  onCommand?: (cmd: InProcCommand & { secret: string }) => { ack: Omit<InProcAck, "op">; afterMs?: number } | undefined;
  /** Command secret this activation announces. */
  secret?: string;
  incarnation?: string;
}

export interface InProcLink {
  readonly lead: string;
  readonly secret: string;
  /** Commands that ARRIVED at the bridge (after faults), in arrival order. */
  readonly commands: Array<InProcCommand & { secret: string }>;
  /** Every `agent-teams:inproc` emit the server made (before faults). */
  readonly emitted: RecordedEmit[];
  readonly acksSent: InProcAck[];
  /** Send an `inproc hello` through the real lane. */
  hello(shape?: HelloShape, over?: Partial<Pick<InProcHelloPayload, "incarnation" | "commandSecret">>): Promise<any>;
  /** Send an ack to the server (after faults). */
  ack(ack: Omit<InProcAck, "op">): void;
  /** Direct lane call as the lead session (any op). */
  lane(payload: unknown): Promise<any>;
  setFaults(faults: LaneFaults | undefined): void;
  setOnCommand(fn: InProcLinkOptions["onCommand"]): void;
}

export function linkInProcBridge(env: TeamsEnv, opts: InProcLinkOptions = {}): InProcLink {
  const lead = opts.lead ?? env.lead;
  const secret = opts.secret ?? "secret-a";
  const incarnation = opts.incarnation ?? "inc-1";
  let faults = opts.faults;
  let onCommand = opts.onCommand;
  const commands: Array<InProcCommand & { secret: string }> = [];
  const emitted: RecordedEmit[] = [];
  const acksSent: InProcAck[] = [];
  let outN = 0;
  let inN = 0;

  const lane = (payload: unknown) => env.fake.lane(lead, LANE_INPROC, payload);

  function schedule(fault: MessageFault | undefined, deliver: () => void): void {
    if (fault?.drop) return;
    const run = (): void => {
      deliver();
      if (fault?.duplicate) deliver();
    };
    if (fault?.delayMs && fault.delayMs > 0) env.clock.setTimeout(run, fault.delayMs);
    else run();
  }

  function sendAck(ack: Omit<InProcAck, "op">): void {
    const full: InProcAck = { op: "ack", ...ack };
    schedule(faults?.toServer?.(full, ++inN), () => {
      acksSent.push(full);
      void lane(full);
    });
  }

  env.fake.base.onEmit((e) => {
    if (e.eventType !== "agent-teams:inproc" || e.sessionId !== lead) return;
    emitted.push(e);
    const cmd = e.data as unknown as InProcCommand & { secret: string };
    schedule(faults?.toBridge?.(cmd, ++outN), () => {
      commands.push(cmd);
      const reply = onCommand?.(cmd);
      if (!reply) return;
      if (reply.afterMs && reply.afterMs > 0) env.clock.setTimeout(() => sendAck(reply.ack), reply.afterMs);
      else sendAck(reply.ack);
    });
  });

  return {
    lead,
    secret,
    commands,
    emitted,
    acksSent,
    hello(shape = { available: true }, over = {}) {
      const inProcess: InProcHelloPayload["inProcess"] = shape.available
        ? { available: true, apiVersion: shape.apiVersion ?? REQUIRED_API_VERSION, features: [...(shape.features ?? [...REQUIRED_FEATURES, "interrupt"])] as SubagentsFeature[], limits: { maxConcurrent: shape.maxConcurrent ?? 4 } }
        : { available: false, reason: shape.reason, ...(shape.missing ? { missing: shape.missing } : {}) };
      return lane({ op: "hello", incarnation: over.incarnation ?? incarnation, commandSecret: over.commandSecret ?? secret, inProcess });
    },
    ack: sendAck,
    lane,
    setFaults(f) {
      faults = f;
    },
    setOnCommand(fn) {
      onCommand = fn;
    },
  };
}
