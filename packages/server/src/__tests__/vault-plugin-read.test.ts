/**
 * Plugin read access through declared + user-approved bindings.
 * See change: add-credential-vault (test-plan E19).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBinding } from "../vault/vault-bindings.js";
import { approvePluginBinding, createPluginVaultReader, listPluginApprovals, revokePluginBinding } from "../vault/vault-plugin-read.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";

let dir: string;
let store: VaultStore;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-plug-"));
  store = createVaultStore(path.join(dir, "vault.json"));
  const poly = await store.addAccount({ provider: "polypizza", label: "p", value: "poly-key-0001" });
  const gem = await store.addAccount({ provider: "gemini", label: "g", value: "gemini-key-001" });
  await createBinding(store, { name: "POLY_PIZZA_KEY", defaultAccountId: poly.id });
  await createBinding(store, { name: "GEMINI_API_KEY", defaultAccountId: gem.id });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("plugin vault reads (E19)", () => {
  it("returns a value only for a declared AND approved binding; revocation and new declarations are honoured", async () => {
    // undeclared
    expect(await createPluginVaultReader(store, "deck3d", ["POLY_PIZZA_KEY"]).read("GEMINI_API_KEY")).toBeUndefined();
    // declared, unapproved
    const reader = createPluginVaultReader(store, "deck3d", ["POLY_PIZZA_KEY"]);
    expect(await reader.read("POLY_PIZZA_KEY")).toBeUndefined();
    // approved
    await approvePluginBinding(store, "deck3d", "POLY_PIZZA_KEY");
    expect(await reader.read("POLY_PIZZA_KEY")).toBe("poly-key-0001");
    // an update that adds GEMINI_API_KEY needs its own approval; the old one stays
    const updated = createPluginVaultReader(store, "deck3d", ["POLY_PIZZA_KEY", "GEMINI_API_KEY"]);
    expect(await updated.read("GEMINI_API_KEY")).toBeUndefined();
    expect(await updated.read("POLY_PIZZA_KEY")).toBe("poly-key-0001");
    // revoked
    await revokePluginBinding(store, "deck3d", "POLY_PIZZA_KEY");
    expect(await updated.read("POLY_PIZZA_KEY")).toBeUndefined();
  });

  it("approvals belong to one plugin", async () => {
    await approvePluginBinding(store, "deck3d", "POLY_PIZZA_KEY");
    expect(await createPluginVaultReader(store, "other", ["POLY_PIZZA_KEY"]).read("POLY_PIZZA_KEY")).toBeUndefined();
  });

  it("returns nothing when the binding has no default account", async () => {
    await approvePluginBinding(store, "deck3d", "POLY_PIZZA_KEY");
    const acc = (await store.listAccounts()).find((a) => a.provider === "polypizza");
    const { revokeAccount } = await import("../vault/vault-grants.js");
    await revokeAccount(store, acc!.id);
    expect(await createPluginVaultReader(store, "deck3d", ["POLY_PIZZA_KEY"]).read("POLY_PIZZA_KEY")).toBeUndefined();
  });

  it("lists approvals without values", async () => {
    await approvePluginBinding(store, "deck3d", "POLY_PIZZA_KEY");
    expect(listPluginApprovals(store.readDocument().doc)).toEqual([{ pluginId: "deck3d", bindingName: "POLY_PIZZA_KEY" }]);
  });
});
