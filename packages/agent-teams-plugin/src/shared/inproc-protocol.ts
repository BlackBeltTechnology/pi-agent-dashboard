/**
 * In-process mode wire protocol (design D3): the server → lead-bridge COMMANDS carried by the
 * `agent-teams:inproc` event, and the bridge → server `agent-teams/inproc` lane ops (`hello`, `ack`, `event`).
 * Types + tiny pure helpers only; no I/O. Every command carries a `cmdId` (idempotent: a repeated id is
 * executed once and its stored ack replayed) and the per-activation `secret` the bridge announced in its hello
 * (decision B101). The member `proxyToken` travels ONLY inside a `spawn` command.
 * See change: add-agent-teams-in-process.
 */
import type { SubagentsFeature, SubagentsLimits, UnavailableReason } from "./subagents-contract.js";

/** Request-lane type of the in-process ops (`{op: "hello" | "ack" | "event", …}`). */
export const LANE_INPROC = "agent-teams/inproc";
export const INPROC_OPS = ["hello", "ack", "event"] as const;
export type InProcOp = (typeof INPROC_OPS)[number];

/** `Team.mode` / `TeamCreate {mode}` value of this mode. */
export const IN_PROCESS_MODE = "in-process";

/** Config-independent bounds of the server-side command queue (decision B94). */
export const INPROC_QUEUE_MAX_ENTRIES = 1000;
export const INPROC_QUEUE_MAX_BYTES = 8 * 1024 * 1024;

/** The fixed, content-free text of a `nudge` steer (decision B107): no ids, no mail bodies. */
export const NUDGE_TEXT = "[agent-teams · continue]";

// ── hello ────────────────────────────────────────────────────────────────────────────────

export type InProcAvailabilityReport =
  | { available: true; apiVersion: number; features: SubagentsFeature[]; limits: SubagentsLimits }
  | { available: false; reason: UnavailableReason; missing?: string[] };

/** One child as the lead host knows it (`snapshot` member). `run` = current run number; `lastIdleRun` from `idle {run}` only. */
export interface InProcSnapshotMember {
  member: string;
  childId: string;
  agentId: string;
  state: "spawning" | "busy" | "idle";
  run: number;
  lastIdleRun: number;
  /** Mail ids already handed to this child (last 200). */
  deliveredMailIds: number[];
  /** The newest settle (`idle` report) the server has not acknowledged yet; the outbox re-sends it after the hello. */
  unackedSettle?: { run: number; finalText?: string; error?: string; aborted?: boolean };
}

export interface InProcSnapshot {
  members: InProcSnapshotMember[];
  /** Server-side parse only: names of rows that were present but failed validation (the child may still run: never "absent"). */
  unreadable?: string[];
}

/** `agent-teams/inproc {op:"hello"}`: sent by the lead bridge after core's `hello`, on every availability change and reconnect. */
export interface InProcHelloPayload {
  op: "hello";
  /** Random id of this bridge activation: constant across reconnects, fresh after a reload. */
  incarnation: string;
  /** Per-activation secret echoed in every command (decision B101); kept in server memory only. */
  commandSecret: string;
  inProcess: InProcAvailabilityReport;
  snapshot?: InProcSnapshot;
}

// ── commands (server → lead bridge, `agent-teams:inproc`) ───────────────────────────────────────

export interface CommandBase {
  /** Idempotency key. A `steer` derives it from its mail ids; a `nudge` carries a fresh nonce. */
  cmdId: string;
  /** The bridge's `commandSecret`; a wrong or missing one is ignored (`inproc_bad_command`). */
  secret: string;
}

/** What the child is built from: the resolved spawn spec, same ordered `promptFiles`, `env` as a closure map. */
export interface InProcSpawnSpec {
  cwd: string;
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
  skills?: string[];
  noMcp: boolean;
  noContextFiles: boolean;
  /** Ordered absolute prompt files (protocol, agent, member, contributors). */
  promptFiles: string[];
  env: Record<string, string | string[]>;
  /** Config `inProcessLeanChildren`. */
  leanChildren: boolean;
  /** Config `inProcessIdleTtlSec` (absent = keep alive until stopped). */
  idleTtlSec?: number;
  /** Set only when core's cwd confinement passed AND the feature `cwd_scope` exists. */
  cwdScope?: "any";
}

export interface SpawnCommand extends CommandBase {
  cmd: "spawn";
  teamId: string;
  member: string;
  role?: string;
  /** Text of the member's `spawn_prompt` mail: the child's prompt (core has no `initialPrompt`). */
  prompt: string;
  /** Short task title for the dock row text (`<member> — <title>`); absent ⇒ the first line of `prompt`. */
  title?: string;
  /** Id of that mail; the server marks it handed over once the spawn is acknowledged. */
  promptMailId?: number;
  spec: InProcSpawnSpec;
  /** Lead-proxied identity secret of this member. Sent here and nowhere else. */
  proxyToken: string;
}

export interface SteerCommand extends CommandBase {
  cmd: "steer";
  member: string;
  /** Mail ids covered (ledger key); empty for a nudge. */
  mailIds: number[];
  /** One framed block per mail, mail-id order; absent for a nudge. */
  blocks?: string[];
  /** Content-free continuation of a child whose queued steer lost its run (fresh nonce cmdId, exempt from the ledger drop). */
  nudge?: true;
}

export interface InterruptCommand extends CommandBase {
  cmd: "interrupt";
  member: string;
}

export interface StopCommand extends CommandBase {
  cmd: "stop";
  member: string;
  childId?: string;
  agentId?: string;
}

export interface SnapshotCommand extends CommandBase {
  cmd: "snapshot";
}

export type InProcCommand = SpawnCommand | SteerCommand | InterruptCommand | StopCommand | SnapshotCommand;
export type InProcCmdName = InProcCommand["cmd"];

/** The member a command is about (`undefined` for `snapshot`): the key of per-member command serialisation. */
export function commandMember(cmd: InProcCommand): string | undefined {
  return cmd.cmd === "snapshot" ? undefined : cmd.member;
}

// ── ack / events (bridge → server, lane `agent-teams/inproc`) ────────────────────────────────────

/** `{op:"ack"}`: the result of one command (replayed byte-identical for a repeated `cmdId`). */
export interface InProcAck {
  op: "ack";
  cmdId: string;
  ok: boolean;
  /** Stable error code (`subagents_extension_missing`, `cap`, `spawn_vetoed`, `invalid_args`, `unknown_member`, …) when `ok` is false. */
  error?: string;
  message?: string;
  childId?: string;
  agentId?: string;
  status?: "queued" | "running";
  /** 1-based. */
  queuePosition?: number;
  /** `steer`: `started | queued | duplicate`; `interrupt`: `interrupted | not_busy | not_running`. */
  result?: string;
  /** `steer` acked `queued`: the run number the queued message belongs to (`lastIdleRun + 1` while busy), recorded as `Member.steerAckRun`. */
  run?: number;
  /** `snapshot`: the host's current member registry (never replayed from a stored copy). */
  snapshot?: InProcSnapshot;
}

/** `{op:"event"}`: lifecycle reports of the lead host (`started`, `idle`, `gone`, `state`); handled by the lifecycle mapping. */
export interface InProcEvent {
  op: "event";
  member: string;
  /** Monotonic per member: reports are deduped by `(member, run)`. */
  run: number;
  kind: "started" | "idle" | "gone" | "state";
  finalText?: string;
  error?: string;
  aborted?: boolean;
  reason?: string;
  state?: "busy" | "idle";
  queuePosition?: number;
}
