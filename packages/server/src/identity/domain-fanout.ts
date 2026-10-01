/**
 * Permissioned domain-event fan-out (openspec §10 / design D9). The host owns
 * the send; the policy owns the decision.
 *
 * - No policy registered ⇒ the event is delivered to every candidate socket,
 *   exactly as the pre-change global broadcast (§10.1). Fully backward
 *   compatible: a deployment with principals but no policy plugin fans out as
 *   before.
 * - Policy registered ⇒ the host calls the policy PER candidate socket with
 *   that socket's principal + the event's `{ action, resource }`, and delivers
 *   only on a `true` result. A principal-less socket receives nothing (the
 *   policy authenticates a person, and there is none). Fail-closed: a false /
 *   throw / timeout / non-boolean denies that socket (handled inside
 *   `PolicyRegistry.authorize`, which also emits the audit event).
 *
 * Session-scoped frames do NOT use this road — they ride the owner-gated
 * subscription/broadcast path (§8, §10.2). This governs only the previously
 * global, resource-tagged domain-event road.
 */

import type { HostAction, HostResource, Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** A candidate delivery target: an open socket and its bound principal (if any). */
export interface FanoutTarget<S> {
  socket: S;
  principal: Principal | null | undefined;
}

export interface DomainFanoutPolicy {
  hasPolicy(): boolean;
  authorize(input: { principal: Principal; action: HostAction; resource: HostResource }): Promise<boolean>;
}

/**
 * Deliver a domain event to the authorized subset of `targets`. Returns the
 * sockets it delivered to (for observability/tests). Never throws — every
 * policy fault is contained by `authorize`.
 */
export async function deliverDomainEvent<S>(
  targets: Iterable<FanoutTarget<S>>,
  action: HostAction,
  resource: HostResource,
  policy: DomainFanoutPolicy,
  send: (socket: S) => void,
): Promise<S[]> {
  const delivered: S[] = [];
  // No policy ⇒ unchanged global broadcast (§10.1).
  if (!policy.hasPolicy()) {
    for (const t of targets) {
      send(t.socket);
      delivered.push(t.socket);
    }
    return delivered;
  }
  // Policy ⇒ per-socket decision; principal-less sockets get nothing.
  for (const t of targets) {
    if (!t.principal) continue;
    if (await policy.authorize({ principal: t.principal, action, resource })) {
      send(t.socket);
      delivered.push(t.socket);
    }
  }
  return delivered;
}
