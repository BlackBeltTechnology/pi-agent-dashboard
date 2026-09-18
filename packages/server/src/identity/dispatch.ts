/**
 * Resolver dispatch walk (openspec §4.3–§4.4 / design D2, D5).
 *
 * Given the ordered resolvers and a curated `AuthContext`, walk them
 * first-claim-wins:
 *   - a valid claim (after validate/copy/freeze) → `{ kind: "claim", ... }`;
 *   - an explicit owned-invalid reject → `{ kind: "reject" }` (caller → 401);
 *   - every resolver returns `null` → `{ kind: "none" }` (caller continues).
 *
 * Bounded, fail-closed isolation (D5): each resolver is raced against the
 * configured timeout and wrapped in try/catch. A THROW or TIMEOUT is core's
 * outermost safety net — coerced to `null` and logged, NEVER a 500 and never a
 * `reject`. A resolver that owns a credential is expected to return `reject`
 * itself for an owned-invalid token; the throw→null path is only for an
 * unexpected fault. A claim whose output fails `sanitizePrincipalResolution`
 * is discarded as if the resolver returned `null` (logged).
 */

import type {
  AuthContext,
  PrincipalResolution,
} from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { sanitizePrincipalResolution } from "./principal-guard.js";
import type { ResolverRegistration } from "./resolver-registry.js";

export type DispatchResult =
  | { kind: "claim"; resolution: PrincipalResolution; pluginId: string }
  | { kind: "reject"; pluginId: string }
  | { kind: "none" };

export interface DispatchDeps {
  /** Ordered resolvers (registry.ordered()). */
  resolvers: ResolverRegistration[];
  /** Per-resolver time budget (ms). */
  timeoutMs: number;
  /** Structured log sink for discarded/faulted outcomes (audit only). */
  log?: (msg: string) => void;
  /** Injectable clock for tests. */
  now?: () => number;
}

/** Race a resolver against its timeout; a timeout resolves to the throw path. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("resolver-timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read an explicit reject without executing inherited/plugin-owned getters. */
function isExplicitReject(outcome: unknown): boolean {
  try {
    if (outcome == null || typeof outcome !== "object") return false;
    const descriptor = Object.getOwnPropertyDescriptor(outcome, "reject");
    return descriptor != null && "value" in descriptor && descriptor.value === true;
  } catch {
    return false;
  }
}

/**
 * Evaluate one resolver: run it (bounded + fault-contained), then classify its
 * outcome. Returns a decisive `DispatchResult` (`claim`/`reject`) or `null`
 * meaning "no claim — continue the walk".
 */
async function evaluateOne(
  reg: ResolverRegistration,
  ctx: AuthContext,
  deps: DispatchDeps,
  now: () => number,
): Promise<DispatchResult | null> {
  let outcome: Awaited<ReturnType<typeof reg.resolve>>;
  try {
    outcome = await withTimeout(reg.resolve(ctx), deps.timeoutMs);
  } catch (err) {
    // Core safety net: throw/timeout ⇒ null (continue), logged, never 500.
    deps.log?.(
      `[identity] resolver '${reg.pluginId}' faulted (${err instanceof Error ? err.message : "unknown"}); treating as null`,
    );
    return null;
  }

  if (outcome == null) return null; // not my credential → next resolver
  if (isExplicitReject(outcome)) return { kind: "reject", pluginId: reg.pluginId };

  const clean = sanitizePrincipalResolution(outcome, reg.clockSkewSeconds ?? 0, now());
  if (!clean) {
    deps.log?.(`[identity] resolver '${reg.pluginId}' returned a malformed principal; discarded as null`);
    return null; // malformed/unknown claim → treat as null, keep walking
  }
  return { kind: "claim", resolution: clean, pluginId: reg.pluginId };
}

/**
 * Walk the ordered resolvers and return the first decisive outcome. Never
 * throws — every fault is contained.
 */
export async function dispatchResolvers(
  ctx: AuthContext,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const now = deps.now ?? Date.now;
  for (const reg of deps.resolvers) {
    const result = await evaluateOne(reg, ctx, deps, now);
    if (result) return result;
  }
  return { kind: "none" };
}
