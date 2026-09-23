/**
 * The access-plane registration seam (design D5, D2a, D3; tasks 5.1, 5.5, 2b.2,
 * 8b.1).
 *
 * A plane is one kind of guarded resource: a filesystem path, an unknown
 * working directory, a network source, a CORS origin. It owns three things the
 * registry must not: normalising its own subjects, rendering its prompt copy,
 * and writing its own grant store. This change adds no store: `grant` delegates
 * to the stores `add-access-grants-and-review` made grantable.
 *
 * `mode` is a CEILING, not a guarantee. Declaring `"held"` never bypasses
 * eligibility or Host admission: `promptPrecondition` is the only way a denial
 * becomes promptable, and it applies the ladder to every plane alike.
 *
 * See change: add-access-grant-dialog.
 */
import type {
  AccessPlaneId,
  GrantPromptCopy,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { Precondition } from "./pending-grant-registry.js";
import type { HostGateMode } from "./prompt-channel.js";

/** What a verdict asks a plane to persist. */
export interface PlaneGrantRequest {
  /** The subject the operator chose: the denied one, or an offered rung. */
  subject: string;
  /** The subject the denial named. */
  deniedSubject: string;
  /** Offered rungs recorded with the denial (filesystem only). */
  ancestors: readonly string[];
  /** Which session's denial produced the grant. */
  origin: string;
}

export type PlaneGrantResult =
  | { ok: true; store: string; widenedFrom?: string }
  | { ok: false; reason: "unnamed" | "forbidden" | "invalid-subject" | "write-failed"; error?: string };

interface PlaneBase {
  readonly id: AccessPlaneId;
  /** Human label of the store an allow-always answer writes. */
  readonly store: string;
  /** Normalise a raw denied subject; `null` means "not promptable on this plane". */
  subjectOf(raw: string): string | null;
  /** Stable registry key for a normalised subject. */
  keyOf(subject: string): string;
  /** Prompt copy; `ancestors` are the rungs the denial offered. */
  describe(subject: string, ancestors: readonly string[]): GrantPromptCopy;
  /** Persist an allow-always verdict in THIS plane's store only. */
  grant(request: PlaneGrantRequest): Promise<PlaneGrantResult>;
}

/** A plane whose denied request may be suspended while the operator decides. */
export interface HeldAccessPlane extends PlaneBase {
  readonly mode: "held";
  /** Whether a YOLO session may auto-answer this plane (design D13). */
  readonly yoloEligible: boolean;
}

/**
 * A plane whose request is always answered immediately; the verdict applies to
 * a later attempt. YOLO eligibility is UNREPRESENTABLE here (task 8b.1): the
 * only value the type admits is `false`.
 */
export interface DeferredAccessPlane extends PlaneBase {
  readonly mode: "deferred";
  readonly yoloEligible?: false;
}

export type AccessPlane = HeldAccessPlane | DeferredAccessPlane;

/** Every registered plane, by id. */
export class AccessPlaneRegistry {
  private readonly planes = new Map<AccessPlaneId, AccessPlane>();

  /**
   * Register a plane. A duplicate id is refused, and so is a deferred plane
   * claiming YOLO eligibility. The type forbids that; this is the runtime
   * backstop for an untyped or cast caller, so the claim is REJECTED rather
   * than silently honoured (test-plan #X9).
   */
  register(plane: AccessPlane): void {
    const id = plane.id;
    if (this.planes.has(id)) throw new Error(`access plane already registered: ${id}`);
    if (plane.mode === "deferred" && (plane as { yoloEligible?: unknown }).yoloEligible === true) {
      throw new Error(`deferred access plane may not be yolo-eligible: ${id}`);
    }
    if (plane.mode !== "held" && plane.mode !== "deferred") {
      throw new Error(`access plane has an unknown mode: ${id}`);
    }
    this.planes.set(id, plane);
  }

  get(id: string): AccessPlane | undefined {
    return this.planes.get(id as AccessPlaneId);
  }

  list(): AccessPlane[] {
    return [...this.planes.values()];
  }
}

/** Everything the ladder reads, evaluated live at the denial site (design D6). */
export interface PreconditionInput {
  plane: AccessPlane;
  /** The live, resolved Host-admission mode. */
  hostGateMode: HostGateMode;
  /** `accessGrants.promptEnabled`, read live. */
  promptEnabled: boolean;
  /** `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` (task 9.1). */
  killSwitch: boolean;
  /** HELD planes: the REQUEST carries a valid capability (`isPromptEligible`). */
  requestHoldsCapability: boolean;
  /** DEFERRED planes: how many capability-holding operator sockets are live. */
  operatorChannels: number;
}

/**
 * Whether a denial may raise a prompt at all (design D2, D2a, D3).
 *
 * The proof differs by settlement mode because the question differs (D2a):
 *   - a HELD plane asks "may this request be suspended?", which only the
 *     request can answer, so the REQUEST must carry a capability;
 *   - a DEFERRED plane asks "may the operator be told?"; its requester is
 *     untrusted and never holds a capability, so the authority comes from a
 *     live OPERATOR channel and nothing is required of the request.
 *
 * Neither mode may substitute the other's proof: a held denial is not rescued
 * by an operator being online, and a deferred one is not blocked for lacking a
 * capability it can never have. Every failing rung returns a reason; none
 * returns an allow.
 */
export function promptPrecondition(input: PreconditionInput): Precondition {
  if (input.killSwitch || !input.promptEnabled) return { promptable: false, reason: "disabled" };
  // Evaluated first, for every plane: a rebound page can obtain a capability
  // by the same means as a legitimate client (D2).
  if (input.hostGateMode !== "enforce") return { promptable: false, reason: "report-mode" };
  if (input.plane.mode === "held") {
    return input.requestHoldsCapability ? { promptable: true } : { promptable: false, reason: "ineligible" };
  }
  return input.operatorChannels > 0 ? { promptable: true } : { promptable: false, reason: "no-audience" };
}

/**
 * Whether a denied request is SUSPENDED while the operator decides: only on a
 * held plane whose precondition passed. A deferred plane never holds its
 * request, whatever the precondition says (design D2a, task 2b.2).
 */
export function holdsRequest(plane: AccessPlane, precondition: Precondition): boolean {
  return plane.mode === "held" && precondition.promptable;
}

/** A settled verdict, as the registry reports it. */
export interface SettledVerdict {
  verdict: "allow-once" | "allow-always" | "deny";
  /** The subject the verdict applies to: the denied one or an offered rung. */
  subject: string;
  deniedSubject: string;
  ancestors: readonly string[];
  origin: string;
}

export type PersistOutcome = { persisted: false } | ({ persisted: true } & PlaneGrantResult);

/**
 * Persist a verdict. ONLY `allow-always` writes a store, and only this plane's.
 * `allow-once` releases the one raising request and persists nothing; `deny`
 * persists nothing (spec: access-grant-registry).
 */
export async function persistVerdict(plane: AccessPlane, v: SettledVerdict): Promise<PersistOutcome> {
  if (v.verdict !== "allow-always") return { persisted: false };
  const result = await plane.grant({
    subject: v.subject,
    deniedSubject: v.deniedSubject,
    ancestors: v.ancestors,
    origin: v.origin,
  });
  return { persisted: true, ...result };
}
