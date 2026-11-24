/**
 * Plain-language text for the refusals a connect / consent / client-upload request can answer with
 * (`routes.ts` `{ error }` codes). Flow codes (a sign-in that ended) map through `errorKey` in `wizard.ts`.
 * Pure data; English at the call sites, catalogs carry zh-CN / hu. See change: add-google-connect.
 */
import { ERROR_EN, errorKey } from "./wizard.js";

/** i18n key → English sentence for request-level refusals. */
const REQUEST_ERROR_EN: Record<string, string> = {
  reqNoProducts: "Tick at least one Google product.",
  reqInvalidEmail: "Enter a full work email address, for example you@example.com.",
  reqOwnClientRequired: "Reading all Drive files needs your organisation's own sign-in.",
  reqRestrictedRemote: "Gmail is not available from another computer: open the dashboard on its own computer, or use organisation sign-in.",
  reqDisclosureRequired: "Accept the data-use notice on the dashboard's own computer first.",
  reqDashboardAddress: "The dashboard's public address is unknown, so Google cannot return here. Set the dashboard's public URL, or use the dashboard's own computer.",
  reqRemoteOrigin: "This dashboard's address cannot be used by the pi-dashboard.dev return page (it needs https). Use organisation sign-in instead.",
  reqConsentInProgress: "A Google sign-in for this account is already open. Finish or cancel it first.",
  reqOauthUnavailable: "Google sign-in is not available on this dashboard.",
  reqClientUnavailable: "That sign-in option is not available here. Choose another one.",
  reqClientNotFound: "That organisation sign-in no longer exists. Choose another one.",
  reqNoClient: "The organisation sign-in this account used was removed. Add it again under Advanced: organisation sign-in.",
  reqOriginDenied: "This needs the dashboard's own computer.",
  reqLocalBrowser: "Open the dashboard on its own computer to change Google access.",
  reqNotFound: "That account no longer exists.",
  errTooManyKeys: "The dashboard credential store is full: remove unused accounts or clients, then try again.",
};

const CODE_KEY: Record<string, string> = {
  no_products: "reqNoProducts",
  bad_request: "reqNoProducts",
  invalid_email: "reqInvalidEmail",
  own_client_required: "reqOwnClientRequired",
  restricted_scope_remote: "reqRestrictedRemote",
  disclosure_required: "reqDisclosureRequired",
  dashboard_address_unknown: "reqDashboardAddress",
  remote_origin_unsupported: "reqRemoteOrigin",
  consent_in_progress: "reqConsentInProgress",
  oauth_unavailable: "reqOauthUnavailable",
  default_client_unavailable: "reqClientUnavailable",
  client_not_found: "reqClientNotFound",
  no_client: "reqNoClient",
  origin_denied: "reqOriginDenied",
  local_browser_required: "reqLocalBrowser",
  not_found: "reqNotFound",
  too_many_keys: "errTooManyKeys",
};

type Translate = (key: string, params?: Record<string, string | number>, fallback?: string) => string;

/** The sentence for any error code: request refusals first, then the sign-in error table (generic for unknown). */
export function errorText(t: Translate, code: string | undefined | null, params: Record<string, string> = {}): string {
  const rk = code ? CODE_KEY[code] : undefined;
  if (rk) return t(rk, params, REQUEST_ERROR_EN[rk]);
  const key = errorKey(code);
  return t(key, params, (ERROR_EN[key] ?? "").replace("{clientId}", params.clientId ?? ""));
}
