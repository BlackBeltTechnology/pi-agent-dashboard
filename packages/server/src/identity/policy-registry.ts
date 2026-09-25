/**
 * Host access policy registry + bounded, fail-closed evaluator (openspec §7 /
 * design D9). The OPTIONAL policy governs only NON-session host roads; session
 * roads are owner-gated (D11) and never routed here.
 *
 * Trust + arity (D9):
 *   - At most one policy, registered ONLY by the plugin named in
 *     `identity.trustedPolicyPlugin`. Any other registrant is refused.
 *   - A second registration (even from the named plugin) fails, so startup
 *     never chooses nondeterministically between two policies.
 *   - When no plugin is named, no policy registers and non-session roads stay
 *     ungated — today's behavior.
 *
 * Evaluation (D9): each call is bounded by a timeout (default 500ms, 50–2000ms).
 * A registered policy that returns `false`, throws, times out, or resolves a
 * NON-boolean value denies the road and emits a structured audit event naming
 * principal, action, resource, and reason. No token/secret material is logged.
 */

import type {
  HostAccessPolicyFn,
  HostAction,
  HostResource,
  Principal,
} from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export const DEFAULT_POLICY_TIMEOUT_MS = 500;
export const MIN_POLICY_TIMEOUT_MS = 50;
export const MAX_POLICY_TIMEOUT_MS = 2000;

export class PolicyTrustError extends Error {
  constructor(public readonly pluginId: string) {
    super(`plugin '${pluginId}' is not permitted to register a host access policy`);
    this.name = "PolicyTrustError";
  }
}

export class PolicyDuplicateError extends Error {
  constructor() {
    super("a host access policy is already registered");
    this.name = "PolicyDuplicateError";
  }
}

/** Reason a policy evaluation denied — surfaced in the audit event. */
export type PolicyDenyReason = "false" | "throw" | "timeout" | "non-boolean" | "unclassified";

export interface PolicyAuditEvent {
  principal: Pick<Principal, "iss" | "sub">;
  action: HostAction;
  resource: HostResource;
  reason: PolicyDenyReason;
}

export interface PolicyRegistryOptions {
  /** Configured `identity.trustedPolicyPlugin` (undefined ⇒ no policy road). */
  trustedPolicyPlugin?: string;
  /** Configured timeout; clamped to [MIN, MAX]. Defaults to 500ms. */
  timeoutMs?: number;
  /** Structured audit sink for every deny (no secrets). */
  audit?: (event: PolicyAuditEvent) => void;
  now?: () => number;
}

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_POLICY_TIMEOUT_MS;
  return Math.min(MAX_POLICY_TIMEOUT_MS, Math.max(MIN_POLICY_TIMEOUT_MS, Math.trunc(ms)));
}

export class PolicyRegistry {
  private policy: HostAccessPolicyFn | undefined;
  private readonly trustedPolicyPlugin?: string;
  private readonly timeoutMs: number;
  private readonly audit: (event: PolicyAuditEvent) => void;

  constructor(opts: PolicyRegistryOptions = {}) {
    this.trustedPolicyPlugin = opts.trustedPolicyPlugin;
    this.timeoutMs = clampTimeout(opts.timeoutMs);
    this.audit = opts.audit ?? (() => {});
  }

  /** Is a plugin permitted to register the policy? (only the named plugin) */
  isTrusted(pluginId: string): boolean {
    return this.trustedPolicyPlugin !== undefined && pluginId === this.trustedPolicyPlugin;
  }

  /**
   * Register the single policy. Throws `PolicyTrustError` when the plugin is
   * not the configured `trustedPolicyPlugin`, `PolicyDuplicateError` on a
   * second registration. Returns an unregister handle.
   */
  register(pluginId: string, policy: HostAccessPolicyFn): () => void {
    if (!this.isTrusted(pluginId)) throw new PolicyTrustError(pluginId);
    if (this.policy !== undefined) throw new PolicyDuplicateError();
    this.policy = policy;
    return () => {
      if (this.policy === policy) this.policy = undefined;
    };
  }

  /** True when a policy is registered (⇒ non-session roads are gated). */
  hasPolicy(): boolean {
    return this.policy !== undefined;
  }

  /** Registered policy count (0 or 1) — for readiness validation (§2). */
  get size(): number {
    return this.policy ? 1 : 0;
  }

  /**
   * Decide a non-session road, bounded + fail-closed.
   *
   * - No policy registered ⇒ `true` (ungated, today's behavior). The caller
   *   MUST only route here for NON-session roads.
   * - A missing/blank classification with a policy registered ⇒ deny
   *   (`unclassified`), never allow.
   * - `false`/throw/timeout/non-boolean ⇒ deny + audit.
   */
  async authorize(input: {
    principal: Principal;
    action: HostAction;
    resource: HostResource;
  }): Promise<boolean> {
    if (!this.policy) return true; // ungated
    const { principal, action, resource } = input;
    if (typeof action !== "string" || action.length === 0 || !resource || typeof resource.kind !== "string") {
      this.deny(principal, action, resource, "unclassified");
      return false;
    }
    let result: unknown;
    try {
      result = await withTimeout(this.policy(input), this.timeoutMs);
    } catch (err) {
      this.deny(principal, action, resource, err === TIMEOUT ? "timeout" : "throw");
      return false;
    }
    if (typeof result !== "boolean") {
      this.deny(principal, action, resource, "non-boolean");
      return false;
    }
    if (!result) this.deny(principal, action, resource, "false");
    return result;
  }

  private deny(
    principal: Principal,
    action: HostAction,
    resource: HostResource,
    reason: PolicyDenyReason,
  ): void {
    this.audit({
      principal: { iss: principal.iss, sub: principal.sub },
      action,
      resource,
      reason,
    });
  }
}

const TIMEOUT = Symbol("policy-timeout");

/** Reject with the shared `TIMEOUT` sentinel when `p` outlasts `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(TIMEOUT), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
