/**
 * Grants, checkout confirmation, account revocation and the delivery snapshot.
 *
 * Default deny: a binding reaches a session only through a grant whose subject
 * matches the session's project. A repository-key grant additionally needs a
 * confirmation bound to (device, directory, repository key). A grant whose
 * override account is gone is `no-account` and NEVER falls back to the
 * binding's default (that would widen access). Only `key` accounts are
 * delivered; reserved env names are re-checked here, so a hand-edited vault
 * file cannot deliver them.
 *
 * Subjects are opaque strings: `repo:<repoKey>` and `dir:<deviceId>:<path>`.
 * Other subject types (e.g. `service:<id>`) are preserved and never deliver
 * to sessions here.
 *
 * See change: add-credential-vault (D1, D3).
 */

import type { SessionProject } from "@blackbelt-technology/pi-dashboard-shared/vault-project-key.js";
import { isDeliverableEnvName, wellFormedBindings } from "./vault-bindings.js";
import { type VaultDocument, VaultError, type VaultStore, wellFormedAccounts } from "./vault-store.js";

export const repoSubject = (repoKey: string): string => `repo:${repoKey}`;
export const dirSubject = (deviceId: string, dir: string): string => `dir:${deviceId}:${dir}`;

interface StoredGrant {
  subject: string;
  bindingName: string;
  accountId?: string;
}

export interface Confirmation {
  deviceId: string;
  dir: string;
  repoKey: string;
}

export type BindingState = "granted" | "pending-confirmation" | "no-account" | "blocked-name";

export interface BindingResolution {
  name: string;
  state: BindingState;
  /** Set only when `state === "granted"`. */
  accountId?: string;
  subject: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function wellFormedGrants(doc: VaultDocument): StoredGrant[] {
  const out: StoredGrant[] = [];
  for (const g of Array.isArray(doc.grants) ? doc.grants : []) {
    if (isRecord(g) && typeof g.subject === "string" && typeof g.bindingName === "string") out.push(g as unknown as StoredGrant);
  }
  return out;
}

export function wellFormedConfirmations(doc: VaultDocument): Confirmation[] {
  const out: Confirmation[] = [];
  for (const c of Array.isArray(doc.confirmations) ? doc.confirmations : []) {
    if (isRecord(c) && typeof c.deviceId === "string" && typeof c.dir === "string" && typeof c.repoKey === "string") out.push(c as unknown as Confirmation);
  }
  return out;
}

const keyAccountById = (doc: VaultDocument, id: string | undefined) =>
  id === undefined ? undefined : wellFormedAccounts(doc).find((a) => a.id === id && a.kind === "key" && typeof a.value === "string");

/** Which account a grant resolves to: its override, else the binding default. Never a fallback chain. */
function accountFor(doc: VaultDocument, grant: StoredGrant): string | undefined {
  const binding = wellFormedBindings(doc).find((b) => b.name === grant.bindingName && b.target === "env");
  if (!binding) return undefined;
  const id = grant.accountId ?? binding.defaultAccountId;
  return keyAccountById(doc, id) ? id : undefined;
}

const isConfirmed = (doc: VaultDocument, p: SessionProject): boolean =>
  p.repoKey !== undefined &&
  wellFormedConfirmations(doc).some((c) => c.deviceId === p.deviceId && c.dir === p.dir && c.repoKey === p.repoKey);

/** The grants that apply to a session's project key (repo key if it has one, else directory key). */
function applicableGrants(doc: VaultDocument, p: SessionProject): StoredGrant[] {
  const subject = p.repoKey !== undefined ? repoSubject(p.repoKey) : dirSubject(p.deviceId, p.dir);
  return wellFormedGrants(doc).filter((g) => g.subject === subject);
}

export function resolveBindings(doc: VaultDocument, project: SessionProject): BindingResolution[] {
  const out: BindingResolution[] = [];
  const seen = new Set<string>();
  for (const g of applicableGrants(doc, project)) {
    if (seen.has(g.bindingName)) continue;
    seen.add(g.bindingName);
    if (!wellFormedBindings(doc).some((b) => b.name === g.bindingName && b.target === "env")) continue;
    if (!isDeliverableEnvName(g.bindingName)) {
      out.push({ name: g.bindingName, state: "blocked-name", subject: g.subject });
      continue;
    }
    if (project.repoKey !== undefined && !isConfirmed(doc, project)) {
      out.push({ name: g.bindingName, state: "pending-confirmation", subject: g.subject });
      continue;
    }
    const accountId = accountFor(doc, g);
    out.push(accountId ? { name: g.bindingName, state: "granted", accountId, subject: g.subject } : { name: g.bindingName, state: "no-account", subject: g.subject });
  }
  return out;
}

export interface DeliverySnapshot {
  /** Values to deliver. Hub-internal: never leaves through a management surface. */
  entries: Array<{ name: string; value: string }>;
  /** Names and states only, for the session view. */
  states: Array<{ name: string; state: BindingState }>;
}

export function buildDeliverySnapshot(
  doc: VaultDocument,
  project: SessionProject,
  getValue: (accountId: string) => string | undefined = (id) => keyAccountById(doc, id)?.value,
): DeliverySnapshot {
  const entries: DeliverySnapshot["entries"] = [];
  const states: DeliverySnapshot["states"] = [];
  for (const r of resolveBindings(doc, project)) {
    if (r.state === "granted" && r.accountId) {
      const value = getValue(r.accountId);
      if (value !== undefined) {
        entries.push({ name: r.name, value });
        states.push({ name: r.name, state: "granted" });
        continue;
      }
      states.push({ name: r.name, state: "no-account" });
      continue;
    }
    states.push({ name: r.name, state: r.state });
  }
  return { entries, states };
}

export interface GrantState {
  subject: string;
  bindingName: string;
  accountId?: string;
  state: "ok" | "no-account";
}

/** Every grant with its repair state, for the settings listing. */
export function listGrantStates(doc: VaultDocument): GrantState[] {
  return wellFormedGrants(doc).map((g) => ({
    subject: g.subject,
    bindingName: g.bindingName,
    accountId: g.accountId,
    state: accountFor(doc, g) ? "ok" : "no-account",
  }));
}

function assertGrantable(doc: VaultDocument, input: { bindingName: string; accountId?: string }): void {
  const binding = wellFormedBindings(doc).find((b) => b.name === input.bindingName && b.target === "env");
  if (!binding) throw new VaultError("invalid_grant", "Binding not found");
  if (input.accountId === undefined) return;
  const acc = keyAccountById(doc, input.accountId);
  if (!acc) throw new VaultError("invalid_grant", "Override must be an existing key account");
  // The provider every account behind this binding must share: the default's, or,
  // without a default, the provider of an override already granted.
  const reference =
    keyAccountById(doc, binding.defaultAccountId) ??
    wellFormedGrants(doc)
      .filter((g) => g.bindingName === input.bindingName && g.accountId !== undefined)
      .map((g) => keyAccountById(doc, g.accountId))
      .find((a) => a !== undefined);
  if (reference && reference.provider !== acc.provider) throw new VaultError("invalid_grant", "Override must be an account of the same provider");
}

export async function createGrant(
  store: VaultStore,
  input: { subject: string; bindingName: string; accountId?: string },
): Promise<void> {
  if (!/^(repo|dir):.+/.test(input.subject)) throw new VaultError("invalid_grant", "Grant subject must be a repository or directory key");
  await store.update((doc) => {
    assertGrantable(doc, input);
    const grants = Array.isArray(doc.grants) ? doc.grants : (doc.grants = []);
    const idx = grants.findIndex((g) => isRecord(g) && g.subject === input.subject && g.bindingName === input.bindingName);
    // Merge over the existing record so unknown fields survive; an absent override clears it.
    const merged: Record<string, unknown> = { ...(idx === -1 ? {} : (grants[idx] as object)), subject: input.subject, bindingName: input.bindingName };
    if (input.accountId === undefined) delete merged.accountId;
    else merged.accountId = input.accountId;
    if (idx === -1) grants.push(merged);
    else grants[idx] = merged;
  });
}

export async function deleteGrant(store: VaultStore, input: { subject: string; bindingName: string }): Promise<void> {
  await store.update((doc) => {
    const grants = Array.isArray(doc.grants) ? doc.grants : [];
    const next = grants.filter((g) => !(isRecord(g) && g.subject === input.subject && g.bindingName === input.bindingName));
    if (next.length === grants.length) throw new VaultError("not_found", "Grant not found");
    doc.grants = next;
  });
}

export async function confirmCheckout(store: VaultStore, c: Confirmation): Promise<void> {
  for (const v of [c.deviceId, c.dir, c.repoKey]) {
    if (typeof v !== "string" || v.length === 0 || v.length > 4096) throw new VaultError("invalid_request", "Invalid confirmation");
  }
  await store.update((doc) => {
    if (wellFormedConfirmations(doc).some((x) => x.deviceId === c.deviceId && x.dir === c.dir && x.repoKey === c.repoKey)) return;
    if (!Array.isArray(doc.confirmations)) doc.confirmations = [];
    doc.confirmations.push({ deviceId: c.deviceId, dir: c.dir, repoKey: c.repoKey });
  });
}

export async function revokeConfirmation(store: VaultStore, c: Confirmation): Promise<void> {
  await store.update((doc) => {
    const list = Array.isArray(doc.confirmations) ? doc.confirmations : [];
    doc.confirmations = list.filter((x) => !(isRecord(x) && x.deviceId === c.deviceId && x.dir === c.dir && x.repoKey === c.repoKey));
  });
}

/** Clear `accountId` as a default / override; returns the binding names whose delivery changed. */
function detachAccount(doc: VaultDocument, accountId: string): string[] {
  const affected = new Set<string>();
  for (const b of Array.isArray(doc.bindings) ? doc.bindings : []) {
    if (!isRecord(b) || b.defaultAccountId !== accountId) continue;
    delete b.defaultAccountId;
    if (typeof b.name === "string") affected.add(b.name);
  }
  for (const g of Array.isArray(doc.grants) ? doc.grants : []) {
    if (isRecord(g) && g.accountId === accountId && typeof g.bindingName === "string") affected.add(g.bindingName);
  }
  return [...affected];
}

/**
 * Revoke an account. Bindings using it as default are left with no default;
 * grants naming it as an override are KEPT (they list as `no-account`) so the
 * user can repair them. Returns the binding names whose delivery changed.
 */
export async function revokeAccount(store: VaultStore, accountId: string): Promise<{ affectedBindings: string[] }> {
  return store.update((doc) => {
    const accounts = Array.isArray(doc.accounts) ? doc.accounts : [];
    const next = accounts.filter((a) => !(isRecord(a) && a.id === accountId));
    if (next.length === accounts.length) throw new VaultError("not_found", "Account not found");
    doc.accounts = next;
    return { affectedBindings: detachAccount(doc, accountId) };
  });
}
