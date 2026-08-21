/**
 * The ONLY place the bridge chooses an endpoint.
 *
 * The hijack class (`fix-bridge-mdns-migration-hijack`,
 * `fix-bridge-autostart-port-resolution`) exists because the bridge *asks the
 * network* where its dashboard is, and the answer can be wrong — stale, or
 * simply another machine's. Two rules kill it:
 *
 *   D3 precedence — explicit configuration is PINNED and outranks anything
 *                   discovered. Discovery MAY suggest; it MAY NEVER override.
 *   D4 stickiness — once registered with instance X, a bridge re-targets only
 *                   when the current endpoint is unpinned AND has failed AND
 *                   the candidate's identity verifies.
 *
 * Absence of a local dashboard resolves to *unavailable*, never to a
 * discovered substitute: silently swapping in whatever answered is exactly the
 * failure being removed. A discovered candidate is still reported as a
 * `suggestion` so an operator can act on it deliberately.
 *
 * See change: add-pi-gateway-transport-identity (D3, D4).
 */

/** An endpoint plus the instance identity expected to answer at it. */
interface EndpointCandidate {
  endpoint: string;
  instanceId?: string;
}

export interface EndpointInputs {
  /** `PI_DASHBOARD_SOCKET` — an explicit local socket path. */
  socketEnv?: string;
  /** `PI_DASHBOARD_URL` — an explicit endpoint (local or remote). */
  urlEnv?: string;
  /** Operator-configured pinned instance. */
  pinnedInstance?: EndpointCandidate;
  /** The HOME-derived rendezvous record written by the lock holder. */
  record?: EndpointCandidate;
  /** A paired remote dashboard (remote-join). */
  pairedRemote?: EndpointCandidate;
  /** An mDNS/discovery candidate. Suggestion only — never selected. */
  discovered?: EndpointCandidate;
}

export type EndpointSource =
  | "PI_DASHBOARD_SOCKET"
  | "PI_DASHBOARD_URL"
  | "pinned-instance"
  | "rendezvous-record"
  | "paired-remote";

export type EndpointResolution =
  | {
      available: true;
      url: string;
      source: EndpointSource;
      /** Pinned endpoints refuse every re-target (D3/D4). */
      pinned: boolean;
      instanceId?: string;
      /** A discovered candidate that lost. Informational only. */
      suggestion?: EndpointCandidate;
    }
  | {
      available: false;
      reason: string;
      suggestion?: EndpointCandidate;
    };

/** Trim, treating whitespace-only as unset. */
function present(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/** `ws+unix://<path>:/` — the `ws` package's unix-socket URL form. */
function socketUrl(socketPath: string): string {
  return `ws+unix://${socketPath}:/`;
}

/**
 * Resolve the endpoint to dial, highest precedence first.
 *
 * Deliberately pure: every input is passed in, so the ladder is a decision
 * table a test can enumerate rather than an emergent property of I/O order.
 */
export function resolveEndpoint(inputs: EndpointInputs): EndpointResolution {
  const suggestion = inputs.discovered;

  const socketEnv = present(inputs.socketEnv);
  if (socketEnv) {
    return {
      available: true,
      url: socketUrl(socketEnv),
      source: "PI_DASHBOARD_SOCKET",
      pinned: true,
      suggestion,
    };
  }

  const urlEnv = present(inputs.urlEnv);
  if (urlEnv) {
    return { available: true, url: urlEnv, source: "PI_DASHBOARD_URL", pinned: true, suggestion };
  }

  const ladder: Array<[EndpointCandidate | undefined, EndpointSource, boolean]> = [
    [inputs.pinnedInstance, "pinned-instance", true],
    [inputs.record, "rendezvous-record", false],
    [inputs.pairedRemote, "paired-remote", false],
  ];
  for (const [candidate, source, pinned] of ladder) {
    const endpoint = present(candidate?.endpoint);
    if (endpoint) {
      return {
        available: true,
        url: endpoint,
        source,
        pinned,
        instanceId: candidate?.instanceId,
        suggestion,
      };
    }
  }

  return {
    available: false,
    reason:
      "no local dashboard available: no PI_DASHBOARD_SOCKET, no PI_DASHBOARD_URL, " +
      "no pinned instance, no rendezvous record under this HOME, and no paired remote",
    suggestion,
  };
}

export interface RetargetInputs {
  current: EndpointCandidate;
  candidate: EndpointCandidate;
  /** The current endpoint came from an explicit source (D3). */
  pinned: boolean;
  /** The current endpoint is unreachable. */
  failed: boolean;
  /** The candidate proved it is the instance it claims to be. */
  identityVerified: boolean;
}

export interface RetargetDecision {
  retarget: boolean;
  /** Always names both endpoints — a silent migration is the bug (task 10.2). */
  reason: string;
}

/**
 * Decide whether a bridge registered with `current` may move to `candidate`.
 *
 * Conjunctive by construction: any single missing precondition keeps the
 * bridge where it is and surfaces a retrying failure, which is the visible
 * behaviour a silent migration denied us.
 */
export function decideRetarget(input: RetargetInputs): RetargetDecision {
  const { current, candidate, pinned, failed, identityVerified } = input;
  const pair = `current=${current.endpoint} candidate=${candidate.endpoint}`;

  if (pinned) {
    return { retarget: false, reason: `refused: current endpoint is pinned (${pair})` };
  }
  if (!failed) {
    return { retarget: false, reason: `refused: current endpoint has not failed (${pair})` };
  }
  if (!identityVerified) {
    return { retarget: false, reason: `refused: candidate identity did not verify (${pair})` };
  }
  if (
    current.instanceId !== undefined &&
    candidate.instanceId !== undefined &&
    current.instanceId === candidate.instanceId
  ) {
    return {
      retarget: true,
      reason: `re-address: same instance ${current.instanceId} at a new endpoint (${pair})`,
    };
  }
  return {
    retarget: true,
    reason: `re-target: unpinned, failed, and candidate identity verified (${pair})`,
  };
}
