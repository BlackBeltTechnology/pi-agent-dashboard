/**
 * The discard rule for a device credential and its key (design D9, test-plan X4/X19).
 *
 * A client discards ONLY when the credential itself is refused (`401` incl. `bearer_expired`, or a
 * refused device-cookie exchange) at a route that PROVED the expected server in a fresh challenge —
 * then the credential and the per-fingerprint device key go together. A refusal at an unproven route
 * discards nothing, and no device-status answer (`unknown`, `expired`, `revoked`) ever discards.
 *
 * See change: device-key-mutual-check (tasks 5.2, D9).
 */
import { type ProveRoute, proveRoute } from "./device-check.js";
import { discardKey } from "./device-key.js";
import { type BindCredential, type BindOutcome, bindDeviceKeyOnce } from "./device-key-bind.js";

export interface DiscardRefusedOptions {
  route: string;
  /** Pinned fingerprint of the server this credential belongs to; absent → any proven identity. */
  fingerprint?: string;
  /** Remove the credential (bearer slot / cookie marker). Called only at a proven route. */
  clearCredential: () => void | Promise<void>;
  prove?: ProveRoute;
  discardKeyFn?: (fingerprint: string) => Promise<void>;
}

/** A credential was refused at `route`: discard credential + key together iff `route` proves the server. */
export async function discardRefusedCredential(opts: DiscardRefusedOptions): Promise<"discarded" | "kept"> {
  const proof = await proveRoute(opts.route, opts.fingerprint, { prove: opts.prove });
  if (!proof) return "kept";
  await opts.clearCredential();
  await (opts.discardKeyFn ?? discardKey)(proof.fingerprint).catch(() => {});
  return "discarded";
}

export type UnknownResolution =
  | { kind: "discarded" }
  | { kind: "kept" }
  | { kind: "key-pending"; bind: BindOutcome }
  | { kind: "inconclusive" };

export interface ResolveUnknownOptions extends Omit<DiscardRefusedOptions, "route"> {
  route: string;
  credential: BindCredential;
  /** The next authenticated call: did the credential work? `error` = transport / server trouble. */
  authenticatedCall: () => Promise<"accepted" | "refused" | "error">;
  bind?: typeof bindDeviceKeyOnce;
  bindFetch?: typeof fetch;
}

/**
 * Device check said `unknown` while a credential is held. Verify it with the next authenticated call:
 * refused → {@link discardRefusedCredential}; accepted → "Paired · key pending" and exactly one bind;
 * transport error → nothing changes.
 */
export async function resolveUnknownWithCredential(opts: ResolveUnknownOptions): Promise<UnknownResolution> {
  const outcome = await opts.authenticatedCall();
  if (outcome === "error") return { kind: "inconclusive" };
  if (outcome === "refused") return { kind: await discardRefusedCredential(opts) };
  const bind = await (opts.bind ?? bindDeviceKeyOnce)({
    route: opts.route,
    credential: opts.credential,
    fingerprint: opts.fingerprint,
    prove: opts.prove,
    fetchImpl: opts.bindFetch,
  });
  return { kind: "key-pending", bind };
}
