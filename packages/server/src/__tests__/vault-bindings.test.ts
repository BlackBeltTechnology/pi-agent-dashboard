/**
 * Env bindings: name validation (regex + case-insensitive deny list) at creation
 * AND at delivery.
 * See change: add-credential-vault (test-plan E6, E7).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBinding, isDeliverableEnvName, isReservedEnvName } from "../vault/vault-bindings.js";
import { buildDeliverySnapshot } from "../vault/vault-grants.js";
import { createVaultStore } from "../vault/vault-store.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-bind-"));
  file = path.join(dir, "vault.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("env binding names", () => {
  it("E6: only GEMINI_API_KEY is accepted; every other candidate is a validation error", async () => {
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    const names = [
      "GEMINI_API_KEY", "gemini_key", "PATH", "Path", "LD_PRELOAD", "GIT_SSH_COMMAND",
      "PI_CODING_AGENT_DIR", "HTTPS_PROXY", "XDG_CONFIG_HOME", "JAVA_TOOL_OPTIONS",
    ];
    const accepted: string[] = [];
    for (const name of names) {
      try {
        await createBinding(store, { name });
        accepted.push(name);
      } catch (err) {
        expect(err).toMatchObject({ name: "VaultError", code: "invalid_binding_name" });
      }
    }
    expect(accepted).toEqual(["GEMINI_API_KEY"]);
  });

  it("matches reserved names regardless of letter case, and by prefix", () => {
    expect(isReservedEnvName("Path")).toBe(true);
    expect(isReservedEnvName("https_proxy")).toBe(true);
    expect(isReservedEnvName("PYTHONPATH")).toBe(true);
    expect(isReservedEnvName("CONTEXT_MODE_X")).toBe(true);
    expect(isReservedEnvName("GEMINI_API_KEY")).toBe(false);
    expect(isDeliverableEnvName("gemini_key")).toBe(false);
    expect(isDeliverableEnvName("SONIOX_API_KEY")).toBe(true);
  });

  it("rejects a duplicate binding name", async () => {
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    await createBinding(store, { name: "GEMINI_API_KEY" });
    await expect(createBinding(store, { name: "GEMINI_API_KEY" })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("E7: a hand-edited reserved binding is not in the delivery snapshot", async () => {
    fs.writeFileSync(file, JSON.stringify({
      accounts: [{ id: "a1", provider: "x", kind: "key", namespace: "user", label: "l", value: "abcdefgh12" }],
      bindings: [{ name: "PATH", target: "env", defaultAccountId: "a1" }],
      grants: [{ subject: "dir:hub:/work/p", bindingName: "PATH" }],
    }));
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    const snap = buildDeliverySnapshot(store.readDocument().doc, { deviceId: "hub", dir: "/work/p" });
    expect(snap.entries.find((e) => e.name.toUpperCase() === "PATH")).toBeUndefined();
    expect(snap.entries).toEqual([]);
  });
});
