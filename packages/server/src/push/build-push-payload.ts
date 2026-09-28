/**
 * Pure builder for the push payload (Decision 5). Classifies the trigger from
 * `(eventType, after, payload)` — not from `eventType` alone, because the
 * `prompt_request` caller passes no payload and signals "waiting for input"
 * only through `after.currentTool === "ask_user"` (Decision 10).
 * No event content beyond the title/body below is ever included.
 * See change: add-server-push-notifications.
 */
import path from "node:path";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { UnreadTriggerSnapshot } from "../session/event-status-extraction.js";
import type { PushPayload, PushTrigger } from "./push-transports/types.js";

const CRASH_BODY_MAX = 200;

export interface PushTriggerContext {
  eventType: string;
  after: UnreadTriggerSnapshot;
  payload?: unknown;
}

function crashError(eventType: string, payload: unknown): unknown {
  if (eventType !== "agent_end") return undefined;
  return (payload as { error?: unknown } | undefined)?.error || undefined;
}

function classify(ctx: PushTriggerContext): PushTrigger {
  if (crashError(ctx.eventType, ctx.payload)) return "crash";
  if (ctx.after.currentTool === "ask_user") return "input";
  return "turn_end";
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === "string" ? msg : "";
}

function truncate(s: string): string {
  return s.length > CRASH_BODY_MAX ? `${s.slice(0, CRASH_BODY_MAX)}…` : s;
}

const TITLE_SUFFIX: Record<Exclude<PushTrigger, "test">, string> = {
  turn_end: "turn finished",
  input: "waiting for input",
  crash: "crashed",
};

export function buildPushPayload(
  session: Pick<DashboardSession, "id" | "cwd" | "name" | "model">,
  ctx: PushTriggerContext,
): PushPayload {
  const trigger = classify(ctx) as Exclude<PushTrigger, "test">;
  const name = session.name || path.basename(session.cwd || "") || session.id;
  const body = trigger === "crash" ? truncate(errorText(crashError(ctx.eventType, ctx.payload))) : (session.model ?? "");
  return {
    type: "session_attention",
    trigger,
    sessionId: session.id,
    title: `${name}: ${TITLE_SUFFIX[trigger]}`,
    body,
    url: `/session/${session.id}`,
  };
}
