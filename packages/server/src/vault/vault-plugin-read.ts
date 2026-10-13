/**
 * Plugin read access: a server plugin reads a binding's default-account value
 * only when its manifest declares that name AND the user approved the
 * declaration. Not project-scoped (a plugin is a server-wide component), so it
 * needs explicit per-plugin approval. This is a capability contract, not
 * isolation: plugins are trusted code.
 *
 * See change: add-credential-vault (D4).
 */

import { wellFormedBindings } from "./vault-bindings.js";
import { type VaultDocument, VaultError, type VaultStore, wellFormedAccounts } from "./vault-store.js";

export interface PluginApproval {
  pluginId: string;
  bindingName: string;
}

export interface PluginVault {
  read(bindingName: string): Promise<string | undefined>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function listPluginApprovals(doc: VaultDocument): PluginApproval[] {
  const out: PluginApproval[] = [];
  for (const a of Array.isArray(doc.pluginApprovals) ? doc.pluginApprovals : []) {
    if (isRecord(a) && typeof a.pluginId === "string" && typeof a.bindingName === "string") out.push({ pluginId: a.pluginId, bindingName: a.bindingName });
  }
  return out;
}

export async function approvePluginBinding(store: VaultStore, pluginId: string, bindingName: string): Promise<void> {
  if (!pluginId || !bindingName) throw new VaultError("invalid_request", "Invalid approval");
  await store.update((doc) => {
    if (listPluginApprovals(doc).some((a) => a.pluginId === pluginId && a.bindingName === bindingName)) return;
    if (!Array.isArray(doc.pluginApprovals)) doc.pluginApprovals = [];
    doc.pluginApprovals.push({ pluginId, bindingName });
  });
}

export async function revokePluginBinding(store: VaultStore, pluginId: string, bindingName: string): Promise<void> {
  await store.update((doc) => {
    const list = Array.isArray(doc.pluginApprovals) ? doc.pluginApprovals : [];
    doc.pluginApprovals = list.filter((a) => !(isRecord(a) && a.pluginId === pluginId && a.bindingName === bindingName));
  });
}

/** A reader bound to ONE plugin id and its manifest-declared binding names. */
export function createPluginVaultReader(store: VaultStore, pluginId: string, declared: readonly string[]): PluginVault {
  return {
    async read(bindingName) {
      if (!declared.includes(bindingName)) return undefined;
      const { status, doc } = store.readDocument();
      if (status.state !== "ok") return undefined;
      if (!listPluginApprovals(doc).some((a) => a.pluginId === pluginId && a.bindingName === bindingName)) return undefined;
      const binding = wellFormedBindings(doc).find((b) => b.name === bindingName && b.target === "env");
      const account = binding?.defaultAccountId
        ? wellFormedAccounts(doc).find((a) => a.id === binding.defaultAccountId && a.kind === "key")
        : undefined;
      return typeof account?.value === "string" ? account.value : undefined;
    },
  };
}
