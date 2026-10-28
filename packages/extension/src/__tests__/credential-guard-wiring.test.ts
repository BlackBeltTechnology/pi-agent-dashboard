/**
 * Credential guard wiring (encrypt-credentials-at-rest D12): rows E48, E53, E54.
 *
 * E54 deviation: the plan asks for the real `bridge.ts` booted with a fake pi. Booting
 * `initBridge` starts the connection manager and may auto-start a server, so the
 * registration ORDER is pinned structurally on `bridge.ts` source, and the behaviour
 * (no-op when inactive, error → block, not `safe()`-wrapped) on the exact handler
 * factory the bridge registers.
 * See change: encrypt-credentials-at-rest.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCredentialGuard, createCredentialGuardToolCallHandler } from "../credential-guard.js";
import { createPathGateHandler, type PathGateDeps } from "../path-gate/handler.js";
import { Suppression } from "../path-gate/suppression.js";

const home = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "cgw-home-")));
const vaultPath = nodePath.join(home, ".pi", "dashboard", "vault.json");
const readVault = { toolName: "read", toolCallId: "tc", input: { path: vaultPath } };

/** pi's runner: the first handler that answers a result wins; later ones never run. */
async function emit(handlers: Array<(e: never, c: never) => unknown>, event: unknown, ctx: unknown) {
  for (const h of handlers) {
    const r = await h(event as never, ctx as never);
    if (r !== undefined) return r as { block?: boolean; reason?: string };
  }
  return undefined;
}

describe("E48: guard default-on", () => {
  it("blocks with only env + homedir; the factory takes no setting, and the module reads no config", () => {
    const guard = createCredentialGuard({ env: {}, homedir: home, log: () => {} });
    const r = guard.handler({ toolName: "read", toolCallId: "t", input: { path: "~/.pi/agent/plugin-credentials.json" } }, { cwd: home });
    expect(r).toMatchObject({ block: true });
    expect(r?.reason.startsWith("credential_guard")).toBe(true);
    // an unknown `credentialGuard:false` key cannot reach it: no config import at all
    const src = fs.readFileSync(new URL("../credential-guard.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/loadConfig|config\.js|credentialGuard/);
  });
});

describe("E53: independent of the path gate", () => {
  function gateDeps(over: Partial<PathGateDeps>, selects: unknown[]): PathGateDeps {
    return {
      getConfig: () => ({ enabled: true, timeoutSeconds: 120 }),
      getRoots: async (grants) => ({ workspace: [nodePath.join(home, "repo")], readOnly: [], readWrite: [], grants }),
      getGrants: () => [],
      getSensitiveDirs: () => [],
      isUngrantable: () => false,
      prompter: {
        select: async (a) => (selects.push(a), "Allow once"),
        confirm: async () => true,
        cancel: () => {},
      },
      grantStoreMatch: () => true,
      requestGrant: async () => ({ ok: true }),
      log: () => {},
      sessionId: () => "S1",
      suppression: new Suppression(),
      ...over,
    } as PathGateDeps;
  }
  const ctx = { hasUI: true, cwd: nodePath.join(home, "repo") };

  it.each([
    ["gate disabled", { getConfig: () => ({ enabled: false, timeoutSeconds: 120 }) }],
    [
      "~/.pi/dashboard granted",
      { getRoots: async (grants: never) => ({ workspace: [nodePath.join(home, "repo")], readOnly: [], readWrite: [nodePath.dirname(vaultPath)], grants }) },
    ],
    [
      "YOLO auto-allow",
      { yoloSupported: () => true, grantStoreMatch: () => true, yoloDecide: async () => "auto-allow" as const },
    ],
  ])("%s: the guard blocks and the gate prompt stub is never called", async (_name, over) => {
    const selects: unknown[] = [];
    const gate = createPathGateHandler(gateDeps(over as Partial<PathGateDeps>, selects));
    const guard = createCredentialGuard({ env: {}, homedir: home, log: () => {} });
    const r = await emit(
      [createCredentialGuardToolCallHandler(guard, () => true) as never, ((e: never, c: never) => gate(e, c)) as never],
      readVault,
      ctx,
    );
    expect(r).toMatchObject({ block: true });
    expect(r?.reason?.startsWith("credential_guard")).toBe(true);
    expect(selects).toHaveLength(0);
  });
});

describe("E54: registration order and handler contract", () => {
  const bridge = fs.readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");

  /**
   * @structural-pin registration order on bridge.ts: the guard `tool_call` registration must precede the path gate's
   */
  it("registers the credential guard before the path gate, not wrapped in safe()", () => {
    const guardIdx = bridge.indexOf("createCredentialGuardToolCallHandler(");
    const registerIdx = bridge.indexOf('pi.on("tool_call", credentialGuardHandler');
    const gateIdx = bridge.indexOf("pathGate.handler(event, ctx)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeLessThan(gateIdx);
    expect(bridge).not.toMatch(/safe\(\s*credentialGuardHandler/);
    expect(bridge).toMatch(/createCredentialGuardToolCallHandler\([\s\S]*?\),\s*isActive,?\s*\)/);
  });

  it("is a no-op when the bridge instance is no longer active", () => {
    const guard = createCredentialGuard({ env: {}, homedir: home, log: () => {} });
    expect(createCredentialGuardToolCallHandler(guard, () => false)(readVault, { cwd: home })).toBeUndefined();
    expect(createCredentialGuardToolCallHandler(guard, () => true)(readVault, { cwd: home })).toMatchObject({ block: true });
  });

  it("an internal guard error is a block (never a fail-open pass-through)", () => {
    const log = vi.fn();
    const guard = createCredentialGuard({
      env: {},
      homedir: home,
      log,
      canonicalize: () => {
        throw new Error("boom");
      },
    });
    const r = createCredentialGuardToolCallHandler(guard, () => true)(readVault, { cwd: home });
    expect(r).toMatchObject({ block: true });
    expect(log).toHaveBeenCalledWith("[credential-guard] error tool=read");
  });
});
