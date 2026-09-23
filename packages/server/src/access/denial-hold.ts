/**
 * The one call a denial site makes (design D6; tasks 6.1-6.3).
 *
 * A site hands over the live request plus what it denied. This module reads the
 * request's prompt capability THERE (never later, D6), picks the requester key
 * the per-channel bounds use, asks the installed coordinator, and, for a held
 * denial, keeps the connection alive until the verdict, expiry, or client abort.
 *
 * With no coordinator installed (tests, embedders, the feature not wired) every
 * call resolves to a deny at once, so the site returns exactly today's denial.
 *
 * See change: add-access-grant-dialog.
 */
import type { AccessPlaneId } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { GrantCoordinator, Resolution } from "./grant-coordinator.js";
import { awaitHold } from "./hold-request.js";
import { GRANT_CHANNEL_HEADER, type HeaderCarrier, resolvePromptChannel } from "./prompt-channel.js";
import { sourceChannel } from "./source-channel.js";

let coordinator: GrantCoordinator | null = null;

/** Install (or clear, with `null`) the process's grant coordinator. */
export function installGrantCoordinator(c: GrantCoordinator | null): void {
  coordinator = c;
}

/** The installed coordinator, if any. */
export function grantCoordinator(): GrantCoordinator | null {
  return coordinator;
}

/** The live request, as far as a denial site needs it. */
export interface HoldTarget {
  request: Pick<FastifyRequest, "raw" | "headers" | "ip">;
  reply: Pick<FastifyReply, "raw">;
}

export interface DenialFacts {
  plane: AccessPlaneId;
  rawSubject: string;
  ancestors?: readonly string[];
  origin: string;
}

function capabilitySocketOf(request: HeaderCarrier): string | null {
  const raw = request.headers[GRANT_CHANNEL_HEADER];
  return resolvePromptChannel(typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined);
}

/**
 * Report a denial and, if this request may be suspended, wait for the verdict.
 *
 * `target` absent means the site cannot suspend: the denial is recorded
 * (answerable on the Access surface) and resolves to a deny immediately.
 */
export async function holdDenial(facts: DenialFacts, target?: HoldTarget): Promise<Resolution> {
  const c = coordinator;
  if (!c) return { kind: "deny", reason: "no-coordinator" };

  const socketId = target ? capabilitySocketOf(target.request as HeaderCarrier) : null;
  // A capability-holding request is keyed by its operator socket; anything else
  // by its source address, so one anonymous source cannot exhaust the budget.
  const channel = socketId ?? sourceChannel(target?.request.ip);
  const hold = c.onDenial(
    {
      plane: facts.plane,
      rawSubject: facts.rawSubject,
      ancestors: facts.ancestors,
      origin: facts.origin,
      channel,
      requestHoldsCapability: socketId !== null,
    },
    target !== undefined,
  );
  if (!target) return hold.result;
  return awaitHold(target.request, target.reply, hold);
}
