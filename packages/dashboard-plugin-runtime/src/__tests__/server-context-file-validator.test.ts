/**
 * `ctx.registerFileValidator` (change: add-editor-pane-file-handlers D4,
 * test-plan E20): own-claim check and package-confined module path.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFileValidatorRegistry, getFileValidatorRegistry } from "../server/file-validator-registry.js";
import { createServerPluginContext, type ServerContextDeps } from "../server/server-context.js";

function baseDeps(): ServerContextDeps {
  return {
    fastify: {} as ServerContextDeps["fastify"],
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    registerBrowserHandler: () => {},
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    onSessionResolved: () => () => {},
    sendToSession: () => true,
    emitEventToSession: () => true,
    sendExtensionMessage: () => false,
    spawnSession: async () => ({ success: true }),
    abortSession: () => true,
    abortSpawnedRun: async () => false,
    registerCwdPolicy: () => {},
    unregisterCwdPolicy: () => {},
    provide: () => {},
    consume: () => undefined,
    consumeAll: () => [],
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok-test",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: async () => {},
    onShutdown: () => () => {},
  };
}

let root: string;
let pkgA: string;
let pkgB: string;

beforeEach(() => {
  clearFileValidatorRegistry();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fv-")));
  pkgA = path.join(root, "plugin-a");
  pkgB = path.join(root, "plugin-b");
  for (const p of [pkgA, pkgB]) {
    fs.mkdirSync(path.join(p, "dist"), { recursive: true });
    fs.writeFileSync(path.join(p, "dist", "validate.mjs"), "export function validate(){return {ok:true};}");
  }
  fs.writeFileSync(path.join(root, "outside.mjs"), "export function validate(){return {ok:true};}");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  clearFileValidatorRegistry();
});

function ctxFor(id: string, packageDir: string, owned: string[]) {
  return createServerPluginContext(baseDeps(), id, [], { packageDir, ownedEditClaimIds: owned });
}

describe("ctx.registerFileValidator (E20)", () => {
  it("registers a validator for an own edit claim with a confined module", () => {
    const enabled = () => true;
    ctxFor("plugin-a", pkgA, ["word"]).registerFileValidator({ claimId: "word", module: "./dist/validate.mjs", enabled });
    const reg = getFileValidatorRegistry().get("plugin-a", "word");
    expect(reg?.modulePath).toBe(path.join(pkgA, "dist", "validate.mjs"));
    expect(reg?.enabled).toBe(enabled);
  });

  it("throws when plugin A registers a validator for plugin B's claim (or any non-own claim)", () => {
    const a = ctxFor("plugin-a", pkgA, ["word"]);
    expect(() => a.registerFileValidator({ claimId: "sheet", module: "./dist/validate.mjs" })).toThrow(/own/);
    // plugin-b owns `sheet`; plugin A naming it must still fail (claims are per plugin).
    ctxFor("plugin-b", pkgB, ["sheet"]);
    expect(() => a.registerFileValidator({ claimId: "sheet", module: "./dist/validate.mjs" })).toThrow(/own/);
    expect(getFileValidatorRegistry().get("plugin-a", "sheet")).toBeUndefined();
    expect(getFileValidatorRegistry().get("plugin-b", "sheet")).toBeUndefined();
  });

  it("throws without any file-handler info (older host / no edit claims)", () => {
    const bare = createServerPluginContext(baseDeps(), "plugin-a");
    expect(() => bare.registerFileValidator({ claimId: "word", module: "./dist/validate.mjs" })).toThrow(/own/);
  });

  it.each([
    ["parent traversal", "../x.js"],
    ["nested traversal", "./dist/../../outside.mjs"],
    ["absolute path", "/etc/passwd"],
    ["no ./ prefix", "dist/validate.mjs"],
    ["missing file", "./dist/nope.mjs"],
  ])("throws for a module path that is not a package-confined existing file (%s)", (_name, module) => {
    expect(() => ctxFor("plugin-a", pkgA, ["word"]).registerFileValidator({ claimId: "word", module })).toThrow();
    expect(getFileValidatorRegistry().get("plugin-a", "word")).toBeUndefined();
  });

  it("throws when a symlink inside the package points outside it", () => {
    fs.symlinkSync(path.join(root, "outside.mjs"), path.join(pkgA, "dist", "link.mjs"));
    expect(() =>
      ctxFor("plugin-a", pkgA, ["word"]).registerFileValidator({ claimId: "word", module: "./dist/link.mjs" }),
    ).toThrow(/outside/);
  });

  it("throws when `enabled` is not a function", () => {
    expect(() =>
      ctxFor("plugin-a", pkgA, ["word"]).registerFileValidator({
        claimId: "word",
        module: "./dist/validate.mjs",
        enabled: true as unknown as () => boolean,
      }),
    ).toThrow(/enabled/);
  });
});
