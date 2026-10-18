/**
 * Wire shape of the `operate_required` refusal (403) that `operate`-gated routes
 * (`/api/vault*`, `/api/services*` mutations) send. Pure types + constants: the
 * server builds the body, the client reads `remedies`.
 *
 * Disclosure rule: the body has exactly these five keys and nothing about hosts,
 * networks, devices or vault posture. `sign-in` is the only configuration fact it
 * reveals (a usable login method exists). `request-access` reveals only what the
 * public knock route already tells the same caller (Host admitted? on-link?).
 * See change: surface-operate-required-remedy, add-request-access-remedy.
 */

/** What the refused caller can do about it. A later change MAY add values. */
export type OperateRemedy = "use-host" | "re-pair" | "request-access" | "sign-in";

/** Canonical relative order of the remedies defined here. */
export const OPERATE_REMEDY_ORDER: readonly OperateRemedy[] = ["use-host", "re-pair", "request-access", "sign-in"];

/** Why the caller was refused. */
export type OperateRequiredReason = "no-credential" | "tier-too-low";

/** Body of an `operate_required` 403. Exactly these keys. */
export interface OperateRequiredBody {
  success: false;
  error: "operate_required";
  message: string;
  reason: OperateRequiredReason;
  remedies: OperateRemedy[];
}
