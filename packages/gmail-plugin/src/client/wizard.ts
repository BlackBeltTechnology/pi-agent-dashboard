/**
 * Setup-wizard data (design D7): console deep links, copyable gcloud commands
 * and the sign-in-error → wizard-step map. Pure — the server never executes
 * the commands. See change: add-gmail-plugin.
 * Plus the sign-in error table (`errorKey`, `ERROR_EN`).
 * See change: improve-gmail-settings-ux.
 */
import { type FlowCode, knownFlowCode } from "../shared/flow-codes.js";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

const CONSOLE = "https://console.cloud.google.com";

export interface ConsoleLinks {
  projectCreate: string;
  gmailApi: string;
  branding: string;
  audience: string;
  clientCreate: string;
}

/** Deep links carrying `?project=<id>` (encoded). */
export function consoleLinks(projectId: string): ConsoleLinks {
  const q = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  return {
    projectCreate: `${CONSOLE}/projectcreate`,
    gmailApi: `${CONSOLE}/apis/library/gmail.googleapis.com${q}`,
    branding: `${CONSOLE}/auth/branding${q}`,
    audience: `${CONSOLE}/auth/audience${q}`,
    clientCreate: `${CONSOLE}/auth/clients/create${q}`,
  };
}

const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function isValidProjectId(id: string): boolean {
  return PROJECT_ID_RE.test(id);
}

/** Copyable gcloud commands (only for a syntactically valid project id). */
export function gcloudCommands(projectId: string): string[] {
  const id = isValidProjectId(projectId) ? projectId : "<project-id>";
  return [`gcloud projects create ${id}`, `gcloud services enable gmail.googleapis.com --project ${id}`];
}

/**
 * Map a sign-in / upload error code to the wizard step that fixes it.
 * `admin_policy_enforced` → null: the fix is in the account's Workspace Admin
 * console, not in a wizard step (improve-gmail-settings-ux D2).
 */
export function errorStep(code: string | undefined | null): WizardStep | null {
  switch (code) {
    case "access_denied":
    case "org_internal":
      return 3;
    case "redirect_uri_mismatch":
    case "web_client":
    case "not_installed":
    case "bad_client_id":
      return 4;
    case "invalid_client":
    case "missing_secret":
    case "not_json":
    case "no_client":
    case "client_in_use":
      return 5;
    default:
      return null;
  }
}

export { KNOWN_FLOW_CODES } from "../shared/flow-codes.js";

/** i18n key per flow code (design D2). `cancelled` also matches the host's "Cancelled". */
const CODE_KEY: Record<FlowCode, string> = {
  org_internal: "errOrgInternal",
  access_denied: "errAccessDenied",
  admin_policy_enforced: "errAdminPolicy",
  redirect_uri_mismatch: "errRedirectMismatch",
  invalid_client: "errInvalidClient",
  scope_missing: "errScopeMissing",
  account_mismatch: "errAccountMismatch",
  missing_refresh: "errMissingRefresh",
  email_unverified: "errEmailUnverified",
  invalid_redirect: "errInvalidRedirect",
  state_mismatch: "errStateMismatch",
  callback_failed: "errCallbackFailed",
  token_exchange_failed: "errTokenExchange",
  id_token_invalid: "errIdToken",
  authorization_failed: "errAuthorization",
  timeout: "errTimeout",
  start_timeout: "errStartTimeout",
  login_failed: "errLoginFailed",
  cancelled: "errCancelled",
  aborted: "errAborted",
};

/**
 * English sentence per error key (the catalogs carry only zh-CN / hu; a dynamic
 * key MUST pass this as its `t()` fallback). `{clientId}` is interpolated.
 */
export const ERROR_EN: Record<string, string> = {
  errOrgInternal:
    "Google blocked this account: the OAuth app's audience is Internal, which admits only accounts of the project's own Workspace organization. Switch the audience to External and add this account as a test user (step 3).",
  errAccessDenied:
    "Google denied access: the account is not an allowed test user, or the consent was declined. Add the account as a test user (step 3) and try again.",
  errAdminPolicy:
    "This account's Google Workspace admin blocks the app. Ask that admin to trust OAuth client {clientId} (Admin console → Security → API controls → App access control).",
  errRedirectMismatch: "Google rejected the redirect address. Create a Desktop app client, not a Web client (step 4).",
  errInvalidClient: "Google does not recognise the OAuth client. Download its JSON again and upload it (step 5).",
  errScopeMissing:
    "Google did not grant the Gmail permission. Add the account again and tick every permission on Google's consent screen.",
  errAccountMismatch: "You signed in with a different Google account. Re-authenticate with the account shown in the row.",
  errMissingRefresh: "Google returned no long-lived token. Revoke the app at myaccount.google.com/permissions, then add the account again.",
  errEmailUnverified: "Google reports this account's email as unverified. Verify it with Google, then try again.",
  errInvalidRedirect: "The pasted address is not the redirect Google sent. Paste the full URL from the browser's address bar.",
  errStateMismatch: "The pasted redirect belongs to another sign-in. Start again and paste the URL from this sign-in.",
  errCallbackFailed: "The sign-in callback failed. Try again.",
  errTokenExchange: "Google refused to exchange the sign-in code. Check the uploaded client (step 5) and try again.",
  errIdToken: "Google's sign-in answer could not be verified. Try again.",
  errAuthorization: "Google reported a sign-in error. Try again; if it repeats, check the setup steps above.",
  errTimeout: "Sign-in timed out waiting for Google. If Google showed an error page, report it with the option below the sign-in link.",
  errStartTimeout: "The sign-in did not start in time. Try again.",
  errLoginFailed: "The sign-in could not start. Try again.",
  errCancelled: "Sign-in was cancelled.",
  errAborted: "Sign-in was aborted.",
  errGeneric: "Sign-in failed. Try again; if it keeps failing, check the setup steps above.",
};

/** i18n key for a terminal flow error; unknown input → `errGeneric` (exact match only). */
export function errorKey(code: string | undefined | null): string {
  if (typeof code !== "string") return "errGeneric";
  if (code.toLowerCase() === "cancelled") return "errCancelled";
  const known = knownFlowCode(code);
  return known ? CODE_KEY[known] : "errGeneric";
}
