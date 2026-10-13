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
interface VaultGrantView {
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
interface VaultPluginDeclaration {
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
}

export interface VaultResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** Machine code of a refusal (`operate_required`, …) — the envelope's `error`. */
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

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<VaultResult<T>> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const env = (await res.json().catch(() => ({}))) as Envelope<T>;
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

/** Human label for a grant subject. */
export function describeSubject(subject: string): { kind: "repo" | "dir" | "other"; text: string } {
  if (subject.startsWith("repo:")) return { kind: "repo", text: subject.slice(5) };
  if (subject.startsWith("dir:")) {
    const rest = subject.slice(4);
    const i = rest.indexOf(":");
    return { kind: "dir", text: i === -1 ? rest : `${rest.slice(i + 1)} @ ${rest.slice(0, i)}` };
  }
  return { kind: "other", text: subject };
}
