/**
 * Plugin-load-failure isolation (L1). A broken plugin server entry — e.g. a
 * quota-plugin whose `@latentminds/pi-quotas` dependency is unavailable — must
 * be caught by the loader, recorded in the status store (surfaced via
 * `/api/health.plugins[]`), and MUST NOT crash the rest of the shell.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiscoveredPlugin, ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  clearDiscoveryCache,
  clearStatusStore,
  getPluginStatusStore,
  loadServerEntries,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;

function makeFakeContext(_p: DiscoveredPlugin): ServerPluginContext {
  return {
    fastify: {} as never,
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    registerBrowserHandler: () => {},
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    sendToSession: () => true,
    emitEventToSession: () => true,
    spawnSession: async () => ({ success: false }),
    abortSession: () => false,
    abortSpawnedRun: async () => false,
    provide: () => {},
    consume: () => undefined,
    consumeAll: () => [],
    getPluginConfig: () => ({}) as never,
    updatePluginConfig: async () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

function writePlugin(name: string, manifest: Record<string, unknown>, serverCode?: string) {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  const pkg: Record<string, unknown> = { name, "pi-dashboard-plugin": manifest };
  if (serverCode) {
    fs.writeFileSync(path.join(pkgDir, "server.mjs"), serverCode);
    (manifest as { server?: string }).server = "./server.mjs";
  }
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-loader-"));
  clearDiscoveryCache();
  clearStatusStore();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
  clearStatusStore();
});

describe("plugin load failure isolation", () => {
  it("records a broken plugin's error and still loads healthy siblings", async () => {
    writePlugin(
      "broken-quota",
      { id: "quota", displayName: "Provider Quota", claims: [] },
      "throw new Error('Cannot find package @latentminds/pi-quotas');",
    );
    writePlugin("healthy", { id: "healthy", displayName: "Healthy", claims: [] });

    await expect(
      loadServerEntries({ createContext: makeFakeContext, isEnabled: () => true, repoRoot: tmpDir }),
    ).resolves.toBeUndefined();

    const store = getPluginStatusStore();
    const broken = store.getStatus("quota");
    expect(broken?.loaded).toBe(false);
    // A broken/unavailable dependency surfaces as a recorded load error
    // (surfaced via /api/health.plugins[]) rather than crashing the shell.
    expect(broken?.error).toBeTruthy();

    // Shell unaffected: the healthy plugin is still marked loaded.
    expect(store.getStatus("healthy")?.loaded).toBe(true);
  });
});
