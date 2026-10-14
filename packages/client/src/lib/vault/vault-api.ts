/**
 * Client transport for the credential vault (`/api/vault/*`).
 *
 * The server never sends a stored value: every response here carries ids,
 * labels, names and states only. The only value that travels is the one the
 * user types (add / rotate) or uploads (import), and it goes UP once.
 *
 * See change: add-credential-vault (D6).
 */
import { getApiBase } from "../api/api-context.js";
import { ApiHttpError, fetchJsonResponse } from "../api/fetch-json.js";
import { t as i18nT } from "../i18n/i18n.js";

export interface VaultAccountView {
  id: string;
  provider: string;
  kind: string;
  namespace: string;
  label: string;
}
export interface VaultBindingView {
  name: string;
  target: string;
  defaultAccountId?: string;
}
export interface VaultGrantView {
  subject: string;
  bindingName: string;
  accountId?: string;
  state: "ok" | "no-account";
}
export interface VaultConfirmationView {
  deviceId: string;
  dir: string;
  repoKey: string;
}
export interface VaultPluginDeclaration {
  pluginId: string;
  displayName: string;
  declared: string[];
}
export interface VaultOverview {
  status: { state: "absent" | "ok" | "corrupt"; backup?: string };
  accounts: VaultAccountView[];
  bindings: VaultBindingView[];
  grants: VaultGrantView[];
  confirmations: VaultConfirmationView[];
  pluginApprovals: Array<{ pluginId: string; bindingName: string }>;
  plugins: VaultPluginDeclaration[];
}
export interface ImportCandidate {
  id: string;
  label: string;
  exists: boolean;
}
export interface ImportProposal {
  id: string;
  items: Array<{ name: string }>;
  skipped: Array<{ name: string; reason: string }>;
}
interface SessionBindingRow {
  name: string;
  state: string;
}
export interface SessionBindingState {
  bindings: SessionBindingRow[];
  lastContactAt?: number;
  outcome?: string;
  project?: { deviceId: string; dir: string; repoKey?: string };
  /** Env-binding names with no grant for this session's project. Only sent to callers that may manage the vault. */
  ungranted?: string[];
}
/** One entry of `GET /api/vault/projects` (a connected or remembered project). */
export interface VaultProjectView {
  kind: "repo" | "dir";
  deviceId?: string;
  dir: string;
  repoKey?: string;
  sessions?: number;
  lastSeenAt?: number;
  /** A session the hub does not deliver to: listed, never grantable. */
  blocked?: "untrusted" | "transport-insecure";
}
export interface VaultProjects {
  open: VaultProjectView[];
  recent: VaultProjectView[];
}

export interface VaultResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /**
   * Machine code of a failure: the envelope's `error` (`operate_required`, `not_found`, …) or one of
   * the client-side codes `server_outdated` (a 2xx non-JSON reply), `transport`, `network`.
   */
  code?: string;
  /** `operate_required` only: what the caller can do about it, server order. Unvalidated. */
  remedies?: unknown[];
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  remedies?: unknown[];
}

/** A failure that never reached a JSON envelope. */
const failure = <T>(status: number, code: string, error: string): VaultResult<T> => ({ ok: false, status, code, error });

/** Maps a throw from `fetchJsonResponse` to its client-side failure code. */
function transportFailure<T>(err: unknown): VaultResult<T> {
  if (err instanceof ApiHttpError) {
    // A 2xx that is not JSON is the SPA shell answering an /api route this server does not have.
    if (err.status >= 200 && err.status < 300) {
      return failure(err.status, "server_outdated", i18nT("vault.serverOutdated", undefined, "This dashboard server doesn't have the vault yet."));
    }
    return failure(err.status, "transport", `HTTP ${err.status}${err.statusText ? ` ${err.statusText}` : ""}`);
  }
  if (err instanceof SyntaxError) return failure(0, "transport", i18nT("vault.unreadableReply", undefined, "The server sent an unreadable reply"));
  return failure(0, "network", i18nT("vault.networkError", undefined, "Can't reach the dashboard server"));
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<VaultResult<T>> {
  let res: Response;
  let env: Envelope<T>;
  try {
    ({ res, json: env } = await fetchJsonResponse<Envelope<T>>(`${getApiBase()}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  } catch (err) {
    return transportFailure(err);
  }
  return {
    ok: res.ok && env.success === true,
    status: res.status,
    data: env.data,
    error: env.message ?? env.error,
    code: env.error,
    remedies: Array.isArray(env.remedies) ? env.remedies : undefined,
  };
}

export const fetchVault = () => call<VaultOverview>("GET", "/api/vault");
export const fetchVaultProjects = () => call<VaultProjects>("GET", "/api/vault/projects");
export const addAccount = (input: { provider: string; label: string; value: string }) => call<VaultAccountView>("POST", "/api/vault/accounts", input);
export const rotateAccount = (id: string, value: string) => call<{ rotated: true }>("PUT", `/api/vault/accounts/${encodeURIComponent(id)}/value`, { value });
export const revokeAccount = (id: string) => call<{ affectedBindings: string[] }>("DELETE", `/api/vault/accounts/${encodeURIComponent(id)}`);
export const createBinding = (input: { name: string; defaultAccountId?: string }) => call<VaultBindingView>("POST", "/api/vault/bindings", input);
export const setBindingDefault = (name: string, accountId: string | null) => call<{ updated: true }>("PUT", `/api/vault/bindings/${encodeURIComponent(name)}/default`, { accountId });
export const deleteBinding = (name: string) => call<{ deleted: true }>("DELETE", `/api/vault/bindings/${encodeURIComponent(name)}`);
export const createGrant = (input: { subject: string; bindingName: string; accountId?: string }) => call<{ granted: true }>("POST", "/api/vault/grants", input);
export const deleteGrant = (input: { subject: string; bindingName: string }) => call<{ deleted: true }>("DELETE", "/api/vault/grants", input);
export const confirmCheckout = (c: VaultConfirmationView) => call<{ confirmed: true }>("POST", "/api/vault/confirmations", c);
export const revokeConfirmation = (c: VaultConfirmationView) => call<{ revoked: true }>("DELETE", "/api/vault/confirmations", c);
export const setPluginApproval = (pluginId: string, bindingName: string, approved: boolean) =>
  call<unknown>(approved ? "PUT" : "DELETE", `/api/vault/plugin-approvals/${encodeURIComponent(pluginId)}/${encodeURIComponent(bindingName)}`);
export const listImportCandidates = () => call<ImportCandidate[]>("GET", "/api/vault/import/candidates");
export const proposeImport = (source: { candidateId: string } | { content: string }) => call<ImportProposal>("POST", "/api/vault/import/propose", source);
export const confirmImport = (proposalId: string, names: string[]) => call<{ created: VaultAccountView[] }>("POST", "/api/vault/import/confirm", { proposalId, names });
export const fetchSessionBindings = (sessionId: string) => call<SessionBindingState>("GET", `/api/session/${encodeURIComponent(sessionId)}/vault-bindings`);

/** Grant subjects are opaque strings: `repo:<repoKey>` and `dir:<deviceId>:<path>`. */
export const repoSubject = (repoKey: string): string => `repo:${repoKey}`;
export const dirSubject = (deviceId: string, dir: string): string => `dir:${deviceId}:${dir}`;

export const lastSegment = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** Human label for a grant subject: `text` is the full label, `key` the repository key / path, `name` the short project name. */
export function describeSubject(subject: string): { kind: "repo" | "dir" | "other"; text: string; key: string; name: string; deviceId?: string } {
  if (subject.startsWith("repo:")) {
    const key = subject.slice(5);
    return { kind: "repo", text: key, key, name: lastSegment(key) };
  }
  if (subject.startsWith("dir:")) {
    const rest = subject.slice(4);
    const i = rest.indexOf(":");
    const dir = i === -1 ? rest : rest.slice(i + 1);
    return { kind: "dir", text: i === -1 ? rest : `${dir} @ ${rest.slice(0, i)}`, key: dir, name: lastSegment(dir), deviceId: i === -1 ? undefined : rest.slice(0, i) };
  }
  return { kind: "other", text: subject, key: subject, name: subject };
}
