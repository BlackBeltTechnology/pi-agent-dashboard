/**
 * Env bindings: an exposure name plus a default `key` account.
 *
 * The name rule (regex + case-insensitive deny list, `isDeliverableEnvName` in
 * the shared `vault-delivery.ts`) is checked at creation, at snapshot
 * building, and again by the bridge before it touches `process.env`, so a
 * hand-edited vault file or a misbehaving hub cannot deliver a reserved name.
 *
 * See change: add-credential-vault (D2).
 */

import { isDeliverableEnvName } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { type VaultDocument, VaultError, type VaultStore, wellFormedAccounts } from "./vault-store.js";

export { isDeliverableEnvName, isReservedEnvName } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";

export interface StoredBinding {
  name: string;
  target: string;
  defaultAccountId?: string;
}

export interface BindingView {
  name: string;
  target: string;
  defaultAccountId?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function wellFormedBindings(doc: VaultDocument): StoredBinding[] {
  const out: StoredBinding[] = [];
  for (const b of Array.isArray(doc.bindings) ? doc.bindings : []) {
    if (isRecord(b) && typeof b.name === "string" && typeof b.target === "string") out.push(b as unknown as StoredBinding);
  }
  return out;
}

export function listBindings(doc: VaultDocument): BindingView[] {
  return wellFormedBindings(doc).map((b) => ({ name: b.name, target: b.target, defaultAccountId: b.defaultAccountId }));
}

function assertKeyAccount(doc: VaultDocument, accountId: string): void {
  const a = wellFormedAccounts(doc).find((x) => x.id === accountId);
  if (a?.kind !== "key") throw new VaultError("invalid_request", "Default must be an existing key account");
}

/** A new default must share the provider of every override already granted on the binding. */
function assertDefaultMatchesOverrides(doc: VaultDocument, bindingName: string, accountId: string): void {
  const accounts = wellFormedAccounts(doc);
  const provider = accounts.find((a) => a.id === accountId)?.provider;
  for (const g of Array.isArray(doc.grants) ? doc.grants : []) {
    if (!isRecord(g) || g.bindingName !== bindingName || typeof g.accountId !== "string") continue;
    const overrideProvider = accounts.find((a) => a.id === g.accountId)?.provider;
    if (overrideProvider !== undefined && overrideProvider !== provider) {
      throw new VaultError("invalid_request", "Default must be an account of the same provider as the grants that override it");
    }
  }
}

export async function createBinding(store: VaultStore, input: { name: string; defaultAccountId?: string }): Promise<BindingView> {
  if (!isDeliverableEnvName(input.name)) {
    throw new VaultError("invalid_binding_name", "Invalid or reserved environment variable name");
  }
  const binding: StoredBinding = { name: input.name, target: "env" };
  if (input.defaultAccountId !== undefined) binding.defaultAccountId = input.defaultAccountId;
  await store.update((doc) => {
    if (wellFormedBindings(doc).some((b) => b.name === input.name && b.target === "env")) {
      throw new VaultError("invalid_request", "A binding with this name already exists");
    }
    if (input.defaultAccountId !== undefined) assertKeyAccount(doc, input.defaultAccountId);
    if (!Array.isArray(doc.bindings)) doc.bindings = [];
    doc.bindings.push(binding);
  });
  return { ...binding };
}

/** Set (or clear, with `undefined`) a binding's default account. */
export async function setBindingDefault(store: VaultStore, name: string, accountId: string | undefined): Promise<void> {
  await store.update((doc) => {
    const b = (Array.isArray(doc.bindings) ? doc.bindings : []).find((x): x is Record<string, unknown> => isRecord(x) && x.name === name && x.target === "env");
    if (!b) throw new VaultError("not_found", "Binding not found");
    if (accountId === undefined) delete b.defaultAccountId;
    else {
      assertKeyAccount(doc, accountId);
      assertDefaultMatchesOverrides(doc, name, accountId);
      b.defaultAccountId = accountId;
    }
  });
}

/** Delete a binding and every grant that names it. */
export async function deleteBinding(store: VaultStore, name: string): Promise<void> {
  await store.update((doc) => {
    const before = Array.isArray(doc.bindings) ? doc.bindings.length : 0;
    doc.bindings = (Array.isArray(doc.bindings) ? doc.bindings : []).filter((b) => !(isRecord(b) && b.name === name && b.target === "env"));
    if (doc.bindings.length === before) throw new VaultError("not_found", "Binding not found");
    doc.grants = (Array.isArray(doc.grants) ? doc.grants : []).filter((g) => !(isRecord(g) && g.bindingName === name));
    doc.pluginApprovals = (Array.isArray(doc.pluginApprovals) ? doc.pluginApprovals : []).filter((a) => !(isRecord(a) && a.bindingName === name));
  });
}
