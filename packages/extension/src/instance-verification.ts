/**
 * "Is this the dashboard I meant?" — the question no local credential answers.
 *
 * Socket ownership (D5) and the Windows local token (D6) both authorise a
 * *host*, not an *instance*: they are per-HOME, so every same-HOME dashboard
 * passes them equally. The rendezvous record names one specific instance, and
 * adopting whatever answers at that endpoint instead is the endpoint-ambiguity
 * bug in a smaller costume (D14, tasks 3.4/3.8).
 *
 * Two pieces, deliberately split: a pure decision that a test can enumerate,
 * and a thin probe that performs the I/O.
 *
 * See change: add-pi-gateway-transport-identity (D8, D14).
 */

export interface AdoptionInput {
  /** The id the record named. `undefined` means "we have no expectation". */
  expected?: string;
  /** The id the instance published. `null`/`undefined` means "none seen". */
  observed?: string | null;
}

export interface AdoptionDecision {
  adopt: boolean;
  /** Names BOTH ids — a silent swap is the failure being removed (task 10.2). */
  reason: string;
  /**
   * An endpoint ANSWERED and was not the instance we meant.
   *
   * Distinct from `!adopt`, which also covers "nobody answered". The bridge
   * disconnects TERMINALLY on a conflict (`disconnect()` sets
   * `intentionalClose`, so nothing rearms the backoff loop) — correct for a
   * hijack, catastrophic for an outage. `POST /api/restart` takes `/api/health`
   * down for seconds on every rebuild while the gateway socket stays healthy;
   * collapsing that into "refused" would kill every bridge on the host.
   */
  conflict: boolean;
}

/**
 * Decide whether the instance answering at an endpoint is the one we meant.
 *
 * Fail-closed whenever an expectation exists and is not met, including when
 * nothing answered: silence is not verification. When no id was expected
 * (a record written by a dashboard predating `instanceId`) there is nothing to
 * contradict, so adoption proceeds — refusing would lock out every
 * pre-upgrade dashboard.
 */
export function decideAdoption({ expected, observed }: AdoptionInput): AdoptionDecision {
  if (!expected) {
    return {
      adopt: true,
      conflict: false,
      reason: "no expected instance id — nothing to verify against",
    };
  }
  if (!observed) {
    // It answered; it just could not name itself. An instance we cannot
    // identify is not one we may keep talking to.
    return {
      adopt: false,
      conflict: true,
      reason: `refused: expected instance ${expected}, but the endpoint published none`,
    };
  }
  if (observed !== expected) {
    return {
      adopt: false,
      conflict: true,
      reason: `refused: expected instance ${expected}, endpoint answered as ${observed}`,
    };
  }
  return { adopt: true, conflict: false, reason: `verified: instance ${expected}` };
}

/** `/api/health` on loopback — the instance id's single publish site. */
export function healthUrlForInstance(httpPort: number): string {
  return `http://127.0.0.1:${httpPort}/api/health`;
}

export interface VerifyInput {
  healthUrl: string;
  expectedInstanceId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface VerifyResult extends AdoptionDecision {
  observed: string | null;
}

/**
 * Probe `healthUrl` and apply {@link decideAdoption} to what it publishes.
 *
 * Every failure mode — unreachable, non-OK, unparseable — collapses to
 * "unverified", never to a pass.
 */
export async function verifyInstanceIdentity(input: VerifyInput): Promise<VerifyResult> {
  const doFetch = input.fetchImpl ?? fetch;
  let observed: string | null = null;
  try {
    const res = await doFetch(input.healthUrl, {
      signal: AbortSignal.timeout(input.timeoutMs ?? 1500),
    });
    if (!res.ok) {
      return {
        adopt: !input.expectedInstanceId,
        // Nobody usable answered — an outage, not an impostor.
        conflict: false,
        observed: null,
        reason: `unverified: ${input.healthUrl} answered ${res.status}`,
      };
    }
    const body = (await res.json()) as { instanceId?: string };
    observed = typeof body.instanceId === "string" ? body.instanceId : null;
  } catch {
    return {
      adopt: !input.expectedInstanceId,
      conflict: false,
      observed: null,
      reason: `unverified: ${input.healthUrl} is unreachable — it did not answer`,
    };
  }
  return { ...decideAdoption({ expected: input.expectedInstanceId, observed }), observed };
}
