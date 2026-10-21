/**
 * Automatic-setup client data (pure, no React): hand-off reason → i18n key +
 * English sentence, checkpoint copy keys, start-error mapping, the publishing-links
 * check and the unverified-app notice rule. `AUTO_SETUP_ERROR_EN` is spread into
 * `ERROR_EN` (wizard.ts) so every dynamic key carries an English `t()` fallback.
 * See change: add-gmail-auto-setup.
 */
import type { Audience, CheckpointKind, HandoffReason, PublishLinks, SetupRunState } from "../shared/auto-setup.js";

/** i18n key per hand-off reason (design D3/D8/D9). */
export const HANDOFF_KEY: Record<HandoffReason, string> = {
  unexpected_page: "handoffUnexpectedPage",
  locale: "handoffLocale",
  domain_blocked: "handoffDomainBlocked",
  publish_cancelled: "handoffPublishCancelled",
  timeout: "handoffTimeout",
  secret_capture_failed: "handoffSecretCaptureFailed",
  client_in_use: "handoffClientInUse",
  browser_closed: "handoffBrowserClosed",
  disabled: "handoffDisabled",
  unloaded: "handoffUnloaded",
  "no-chrome": "handoffNoChrome",
  "no-display": "handoffNoDisplay",
  "owned-by-other-server": "handoffOwnedByOtherServer",
  "profile-in-use": "handoffProfileInUse",
  "launch-failed": "handoffLaunchFailed",
};

/** Key for a hand-off reason; a reason a newer server adds falls back to the generic sentence. */
export function handoffKey(reason: string): string {
  return (HANDOFF_KEY as Record<string, string>)[reason] ?? "handoffGeneric";
}

/** i18n key per human checkpoint (design D5). */
export const CHECKPOINT_KEY: Record<CheckpointKind, string> = {
  sign_in: "autoCpSignIn",
  console_terms: "autoCpTerms",
  policy: "autoCpPolicy",
  publish: "autoCpPublish",
};

/** Run states in which the run is still going (polled every second). */
const LIVE_STATES: readonly SetupRunState[] = ["starting", "running", "waiting_user", "waiting_decision", "busy"];
export const isLive = (state: SetupRunState): boolean => LIVE_STATES.includes(state);

/**
 * The unverified-app sentence applies unless the audience is known to be Internal
 * (design D11): External and "unknown" (no run observed on this page) both show it.
 */
export function showUnverifiedNotice(audience: Audience | null | undefined): boolean {
  return audience !== "internal";
}

export type LinkError = "invalid_url" | "not_https" | "outside_domain" | "invalid_domain";

/** Mirror of the server rule (design D7): `https:` and host under the authorized domain. */
export function validateLinks(links: PublishLinks): Partial<Record<keyof PublishLinks, LinkError>> {
  const errors: Partial<Record<keyof PublishLinks, LinkError>> = {};
  const domain = links.authorizedDomain.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) errors.authorizedDomain = "invalid_domain";
  for (const key of ["homePage", "privacyPolicy"] as const) {
    let url: URL;
    try {
      url = new URL(links[key].trim());
    } catch {
      errors[key] = "invalid_url";
      continue;
    }
    if (url.protocol !== "https:") errors[key] = "not_https";
    else if (!errors.authorizedDomain && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) errors[key] = "outside_domain";
  }
  return errors;
}

export const LINK_ERROR_KEY: Record<LinkError, string> = {
  invalid_url: "errLinkInvalid",
  not_https: "errLinkHttps",
  outside_domain: "errLinkDomain",
  invalid_domain: "errLinkAuthorizedDomain",
};

/** i18n key for a rejected `POST setup/run` / action; unknown codes render the raw server message. */
export function startErrorKey(code: string | undefined): string | null {
  switch (code) {
    case "run_active":
      return "autoErrRunActive";
    case "remote_dashboard":
      return "autoErrRemote";
    default:
      return null;
  }
}

/** English sentences (the `t()` fallbacks for every dynamic key above). */
export const AUTO_SETUP_ERROR_EN: Record<string, string> = {
  handoffGeneric: "Automatic setup stopped. Continue with the manual steps below.",
  handoffUnexpectedPage:
    "Google's console showed a page the automatic setup did not expect, so it stopped instead of guessing. Continue by hand from the highlighted step.",
  handoffLocale:
    "The console is not in English, so the automatic setup could not read it reliably. Switch the Google account's language to English, or continue by hand from the highlighted step.",
  handoffDomainBlocked:
    "The dedicated browser refused to open the Google Cloud console or Google sign-in. Add the domains listed below to the Browser plugin's allowed domains, or continue by hand.",
  handoffPublishCancelled: "The publish confirmation was cancelled in the browser window. Continue by hand from the highlighted step.",
  handoffTimeout: "The automatic setup waited 15 minutes for a step on your side and gave up. Continue by hand, or start it again.",
  handoffSecretCaptureFailed:
    "The OAuth client was created, but its secret could not be read. The secret cannot be shown again, so add a new one to that client.",
  handoffClientInUse:
    "An OAuth client with connected accounts is already configured, and the automatic setup never replaces a working client. Revoke the accounts first, or keep the current client.",
  handoffBrowserClosed: "The dedicated browser window was closed. Continue by hand, or start the automatic setup again.",
  handoffDisabled: "The dedicated browser is turned off in the Browser plugin settings. Turn it on, or continue by hand.",
  handoffUnloaded: "The Browser plugin is not loaded, so the dedicated browser is not available. Continue by hand.",
  handoffNoChrome: "No Chrome installation was found for the dedicated browser. Install Chrome, or continue by hand.",
  handoffNoDisplay: "This computer has no display for the dedicated browser window. Continue by hand.",
  handoffOwnedByOtherServer: "Another dashboard server on this computer owns the dedicated browser. Continue by hand.",
  handoffProfileInUse: "The dedicated browser profile is open in another Chrome window. Close it, or continue by hand.",
  handoffLaunchFailed: "The dedicated browser could not be started. Continue by hand.",
  autoErrRunActive: "An automatic setup is already running on this dashboard.",
  autoErrRemote: "Automatic setup only starts from the computer that runs the dashboard.",
  autoErrGeneric: "The automatic setup request failed.",
  errLinkInvalid: "Enter a full web address, for example https://example.com/privacy.",
  errLinkHttps: "The address must start with https://.",
  errLinkDomain: "The address must be on the authorized domain.",
  errLinkAuthorizedDomain: "Enter a domain name, for example github.com.",
};
