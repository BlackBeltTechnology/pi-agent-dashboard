/**
 * The two lane handlers return a live OAuth access token (`gmail/lease`) and the mailbox inventory
 * (`gmail/accounts`): both register hub-local-only, so the host refuses a remote-origin or
 * deprecated-admission session with `origin_denied`. See change: harden-bridge-session-claim (D3).
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, memoryCredentials } from "../../__tests__/fakes.js";
import { CLIENT_KEY } from "../accounts.js";
import registerPlugin from "../index.js";

describe("gmail lane handlers are registered hub-local-only", () => {
  it("passes { hubLocalOnly: true } for gmail/lease and gmail/accounts", async () => {
    const app = Fastify();
    const register = vi.fn();
    await registerPlugin({
      credentials: memoryCredentials({ [CLIENT_KEY]: { ...CLIENT } }),
      logger: capturingLogger(),
      fastify: app,
      networkGuard: async () => {},
      consume: () => undefined,
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      registerPiRequestHandler: register,
      oauth: undefined,
    } as never);
    await app.close();
    const byType = new Map(register.mock.calls.map((c) => [c[0] as string, c[2]]));
    expect([...byType.keys()].sort()).toEqual(["gmail/accounts", "gmail/lease"]);
    expect(byType.get("gmail/lease")).toEqual({ hubLocalOnly: true });
    expect(byType.get("gmail/accounts")).toEqual({ hubLocalOnly: true });
  });
});
