/**
 * Setup-wizard data (design D7): console deep links, copyable gcloud commands
 * and the sign-in-error → wizard-step map. Pure — the server never executes
 * the commands. See change: add-gmail-plugin.
 */

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

/** Map a sign-in / upload error code to the wizard step that fixes it. */
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
