/**
 * L1 Gmail works without Google Connect (test-plan #B136; task 11.134): the manifest declares no hard `dependsOn` on
 * `google`, Gmail loads AFTER google (priority 210 vs 200) but its server entry is present and registers on its own
 * when google is absent/disabled. No import of google-plugin source — its manifest is read as a JSON file only.
 * See change: add-google-connect.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, memoryCredentials } from "../../__tests__/fakes.js";
import { CLIENT_KEY } from "../accounts.js";
import registerPlugin from "../index.js";

const pkgRoot = path.resolve(__dirname, "../../..");
const manifestOf = (root: string) => (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { "pi-dashboard-plugin": Record<string, unknown> })["pi-dashboard-plugin"];

describe("#B136 Gmail works without Google Connect", () => {
  it("the manifest has no hard dependency on google and loads after it (210 vs 200)", () => {
    const gmail = manifestOf(pkgRoot);
    const google = manifestOf(path.resolve(pkgRoot, "../google-plugin"));
    expect(gmail.id).toBe("gmail");
    expect(google.id).toBe("google");
    expect(gmail.dependsOn, "no dependsOn at all").toBeUndefined();
    expect(JSON.stringify(gmail.requires ?? [])).not.toMatch(/google/i);
    expect(gmail.priority as number).toBeGreaterThan(google.priority as number);
    expect([gmail.priority, google.priority]).toEqual([210, 200]);
  });

  it("the server entry the manifest names exists, and it registers + mounts its own lanes with NO google.connect service (google disabled)", async () => {
    const gmail = manifestOf(pkgRoot);
    expect(existsSync(path.join(pkgRoot, gmail.server as string))).toBe(true);
    const app = Fastify();
    const register = vi.fn();
    await registerPlugin({
      credentials: memoryCredentials({ [CLIENT_KEY]: { ...CLIENT } }),
      logger: capturingLogger(),
      fastify: app,
      networkGuard: async () => {},
      consume: () => undefined,
      consumeAll: () => [],
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      registerPiRequestHandler: register,
      oauth: undefined,
    } as never);
    await app.close();
    expect(register.mock.calls.map((c) => c[0] as string).sort()).toEqual(["gmail/accounts", "gmail/lease"]);
  });
});
