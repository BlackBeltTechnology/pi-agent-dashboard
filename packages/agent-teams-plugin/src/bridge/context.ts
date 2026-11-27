/**
 * The seam surface the bridge hands to its optional modules (`plan-mode.ts`, `command.ts`) so they
 * extend the core bridge WITHOUT editing `index.ts` again. Built once per `createBridge`; every
 * list is empty by default and inert, so a bridge with the stub modules behaves exactly as before.
 * See change: add-agent-teams-templates-hooks.
 */
import type { HelloPayload, HelloReply, TeamOp, TeamRole, WireMail } from "../shared/protocol.js";
import type { LaneClient } from "./lane.js";

/** Structural slice of pi's extension API the bridge and its modules use (all optional: old hosts, tests). */
export interface PiLike {
  // biome-ignore lint/suspicious/noExplicitAny: pi event payloads and contexts differ per event; each handler narrows its own
  on?: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  registerTool?: (tool: import("./tools.js").TeamToolDef) => void;
  /** Slash command (`/agent-team`); `handler(args, ctx)` gets pi's command context (`ctx.ui.notify`, …). */
  registerCommand?: (
    name: string,
    options: {
      description?: string;
      getArgumentCompletions?: (prefix: string) => unknown;
      // biome-ignore lint/suspicious/noExplicitAny: pi command contexts differ per host version
      handler: (args: string, ctx: any) => unknown;
    },
  ) => void;
  getActiveTools?: () => string[];
  setActiveTools?: (names: string[]) => void;
  /** Every registered tool (built-in and extension), active or not (plan-mode narrowing intersects it). */
  getAllTools?: () => Array<{ name: string }>;
  sendMessage?: (message: { customType: string; content: string; display: boolean; details?: Record<string, unknown> }, options?: { deliverAs?: string; triggerTurn?: boolean }) => void;
  events?: { on?: (name: string, handler: (payload: unknown) => void) => unknown };
}

export interface BridgeContext {
  pi: PiLike;
  /** The process env (or the test env): hints only, never authority. */
  env: Record<string, string | undefined>;
  lane: LaneClient;
  log(message: string): void;
  /** The role the bridge currently believes (the server is authoritative). */
  role(): TeamRole;
  /** Whether `session_start` has fired (pi action methods such as `setActiveTools` are only safe afterwards). */
  started(): boolean;
  hello: {
    /** Extra fields merged into EVERY hello payload (registration order, later wins; `HelloPayload` keys only). */
    addPayload(fn: () => Partial<HelloPayload>): void;
    /** Called with the data of every successful hello reply (after core applied the role). */
    onReply(fn: (reply: HelloReply) => void): void;
    /** Send a hello now (overlapping calls coalesce). */
    send(): Promise<void>;
  };
  /** Called once per mail after it was handed to pi (de-duplicated ids are not repeated). */
  onMail(fn: (mail: WireMail) => void): void;
  tools: {
    /** Team tool names registered so far (what `restoreTools` must include). */
    registered(): readonly TeamOp[];
    /** Register (once) and activate team tools exactly like the core bridge does. */
    activate(names: readonly TeamOp[]): void;
    deactivate(names: readonly string[]): void;
  };
  /** The session became a lead (a `team.start` reply on the command path): registers the lead tool set. */
  becomeLead(): void;
}

/** A bridge module: registers its handlers/hooks once, synchronously, during `createBridge`. */
export type BridgeRegistrar = (ctx: BridgeContext) => void;
