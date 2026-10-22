/**
 * Setup-wizard data (design D7): console deep links, copyable gcloud commands
 * and the sign-in-error → wizard-step map. Pure — the server never executes
 * the commands. See change: add-gmail-plugin.
 * Plus the sign-in error table (`errorKey`, `ERROR_EN`).
 * See change: improve-gmail-settings-ux.
 * `ERROR_EN` also carries the hand-off reason sentences. See change: add-gmail-auto-setup.
 */
import { type FlowCode, knownFlowCode } from "../shared/flow-codes.js";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../shared/setup.js";
import { AUTO_SETUP_ERROR_EN } from "./auto-setup.js";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

const CONSOLE = "https://console.cloud.google.com";

export interface ConsoleLinks {
  /** Never project-scoped: carries only `authuser`. */
  projectCreate: string;
  /** Console project picker (find the project id); never project-scoped. */
  projectList: string;
  /** Project-scoped links: `null` until the project id is valid. */
  gmailApi: string | null;
  branding: string | null;
  audience: string | null;
  clientCreate: string | null;
}

/** The owner account when it is a valid email (normalized), else `undefined`. */
function validOwner(owner: string | undefined): string | undefined {
  if (!owner) return undefined;
  const email = normalizeEmail(owner);
  return isEmail(email) ? email : undefined;
}

/**
 * Console deep links (design D3). Project-scoped links exist only for a valid
 * project id and carry `project`; every non-null link carries `authuser` when
 * the owner account is a valid email. Query values are URL-encoded.
 */
export function consoleLinks(projectId: string, owner?: string): ConsoleLinks {
  const email = validOwner(owner);
  const id = classifyProjectId(projectId) === "ok" ? normalizeProjectId(projectId) : undefined;
  const url = (path: string, withProject: boolean): string => {
    const q = new URLSearchParams();
    if (withProject && id) q.set("project", id);
    if (email) q.set("authuser", email);
    const qs = q.toString();
    return `${CONSOLE}${path}${qs ? `?${qs}` : ""}`;
  };
  return {
    projectCreate: url("/projectcreate", false),
    projectList: url("/cloud-resource-manager", false),
    gmailApi: id ? url("/apis/library/gmail.googleapis.com", true) : null,
    branding: id ? url("/auth/branding", true) : null,
    audience: id ? url("/auth/audience", true) : null,
    clientCreate: id ? url("/auth/clients/create", true) : null,
  };
}

export interface GcloudCommands {
  /** `gcloud auth login <email>` — only with a valid owner; run it once first. */
  authLogin: string | null;
  projectsList: string;
  /** `null` until the project id is valid (never a placeholder). */
  create: string | null;
  enable: string | null;
}

/**
 * POSIX-shell quote for a value the user will paste into a terminal. `isEmail` admits shell
 * metacharacters in the local part (`a;b@x.co`, `$(id)@x.co`), so anything outside the plain
 * address alphabet is single-quoted (embedded `'` as `'\''`); ordinary addresses stay bare.
 */
function shellQuote(v: string): string {
  return /^[A-Za-z0-9@._+-]+$/.test(v) ? v : `'${v.replaceAll("'", "'\\''")}'`;
}

/** Copyable gcloud commands (design D3); `--account <email>` on every command but `auth login`. */
export function gcloudCommands(projectId: string, owner?: string): GcloudCommands {
  const valid = validOwner(owner);
  const email = valid === undefined ? undefined : shellQuote(valid);
  const id = classifyProjectId(projectId) === "ok" ? normalizeProjectId(projectId) : undefined;
  const acct = (cmd: string): string => (email ? `${cmd} --account ${email}` : cmd);
  return {
    authLogin: email ? `gcloud auth login ${email}` : null,
    projectsList: acct("gcloud projects list"),
    create: id ? acct(`gcloud projects create ${id}`) : null,
    enable: id ? acct(`gcloud services enable gmail.googleapis.com --project ${id}`) : null,
  };
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
    "Google did not grant the Gmail permission. Google asks for it either as a checkbox you must tick, or on a second screen (\"wants additional access\") you must accept — finishing after the first screen only signs you in. Remove this app's access at myaccount.google.com/connections, then add the account again.",
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
  // Automatic setup: hand-off reasons + start/link errors (change: add-gmail-auto-setup).
  ...AUTO_SETUP_ERROR_EN,
};

/** i18n key for a terminal flow error; unknown input → `errGeneric` (exact match only). */
export function errorKey(code: string | undefined | null): string {
  if (typeof code !== "string") return "errGeneric";
  if (code.toLowerCase() === "cancelled") return "errCancelled";
  const known = knownFlowCode(code);
  return known ? CODE_KEY[known] : "errGeneric";
}

/** English fallbacks for copy that mirrors a catalog key (the E30 test pins their content). */
export const CONSENT_HINT_EN =
  "Google asks for the Gmail permission either as a checkbox (tick it) or on a second screen saying the app \"wants additional access\" (accept it). Stopping after the first screen only signs you in.";

export const AUDIENCE_HELP_EN =
  "Internal admits only accounts of the project's own Workspace organization: choose it only when every account you will connect belongs to that organization. Otherwise choose External and add every address you will connect as a test user. In Testing, tokens expire after 7 days. Publishing the app removes the 7-day token expiry. An unverified app shows Google's warning and admits at most 100 users. Accounts added while in Testing need one re-auth after publishing.";

/** Sign-in notice for an External or unknown audience (design D11). See change: add-gmail-auto-setup. */
export const UNVERIFIED_HINT_EN =
  "Google may show “Google hasn’t verified this app”. Choose Advanced, then continue to the app.";
