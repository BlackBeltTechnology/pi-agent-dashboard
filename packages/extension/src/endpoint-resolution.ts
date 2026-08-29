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

/**
 * Loopback hosts, lexically: the reserved localhost names plus the loopback
 * literal addresses. Hostname-as-hint classification (design D3): a `*.local`
 * mDNS name is REMOTE even though some such names resolve to loopback — the
 * poisoned advertisement was exactly a `*.local` name, and treating it as
 * remote is the strict side of the rule: it can only decline a migration,
 * never adopt a wrong endpoint, and the health gate still guards any
 * legitimate move. DNS resolution is deliberately NOT performed here — the
 * ambiguous "`.local` that resolves loopback" shape is removed at the source
 * by the advertisement gate, and reachability is verified independently.
 */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * {@link isLoopbackHost} for a URL (any scheme). A URL that cannot be parsed
 * classifies REMOTE: the strict side never displaces an established loopback
 * connection on a guess.
 */
export function isLoopbackEndpoint(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
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

/**
 * The per-instance id file that belongs to a pinned gateway socket, or
 * `undefined` when the path is not one.
 *
 * WHY THE SOCKET AND NOT THE RECORD. A bridge pinned via `PI_DASHBOARD_SOCKET`
 * — which is every session the dashboard spawns (task 2.0f) — had no instance
 * id at all, so `/dashboard-where` answered `unverified` in the one case a
 * user would ever ask. The rendezvous record cannot fill that gap: it names
 * the HOME's OWNER, so a session pinned to an ATTACH instance's socket would
 * be told a confident wrong id, which is worse than admitting ignorance. The
 * socket path is the only artefact that names the instance on the other end —
 * `gateway-<piPort>.sock` and `instances/<piPort>.id` are siblings under the
 * same `0700` directory.
 *
 * No network verification is needed for this source: the socket is `0600`
 * inside a `0700` dir, so the kernel already decided the caller is the same OS
 * user (D5), and the id file is in that same directory. Verification stays on
 * the record-sourced path, where the endpoint is a network address some other
 * instance could be answering on.
 *
 * Pure by design, like the rest of this module: the caller does the reading.
 *
 * See change: add-pi-gateway-transport-identity (task 9.6).
 */
export function instanceIdFileForSocket(socketPathOrUrl: string): string | undefined {
  const raw = present(socketPathOrUrl);
  if (!raw) return undefined;
  // Accept both the bare path and the `ws+unix://<path>:/` form the bridge dials.
  const path = raw.startsWith("ws+unix://") ? raw.slice("ws+unix://".length).replace(/:\/$/, "") : raw;
  const slash = path.lastIndexOf("/");
  if (slash < 0) return undefined;
  const dir = path.slice(0, slash);
  const base = path.slice(slash + 1);
  const match = /^gateway-(\d+)\.sock$/.exec(base);
  if (!match) return undefined;
  return `${dir}/instances/${match[1]}.id`;
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
