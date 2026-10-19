/** `browser/connect` handler (#E20 server half). See change: add-dedicated-agent-browser. */
import { describe, expect, it, vi } from "vitest";
import { createConnectHandler } from "../connect-handler.js";

const mk = () => {
  const connectDedicated = vi.fn(async (_o: { holder: string }) => ({ ok: true as const, cdpUrl: "ws://d", instanceId: "i1" }));
  const connectProfile = vi.fn(async (_p: string) => ({ ok: true as const, cdpUrl: "ws://p", instanceId: "i2" }));
  const handler = createConnectHandler({
    config: () => ({}),
    installedProfiles: () => [{ profileDirectory: "P", installed: true }],
    dedicatedStatus: () => ({ available: true }),
    connectDedicated,
    connectProfile,
    disconnect: vi.fn(),
  });
  return { handler, connectDedicated, connectProfile };
};

describe("browser/connect", () => {
  it("#E20 holder is the lane's session S, never payload.sessionId T", async () => {
    const { handler, connectDedicated } = mk();
    await handler({ sessionId: "T", target: "@dedicated" }, { sessionId: "S" });
    expect(connectDedicated).toHaveBeenCalledWith({ holder: "S" });
  });

  it("passes target through; a non-object payload means defaults", async () => {
    const { handler, connectProfile, connectDedicated } = mk();
    expect(await handler({ target: "P" }, { sessionId: "S" })).toMatchObject({ browser: "profile", profileDirectory: "P" });
    expect(connectProfile).toHaveBeenCalledWith("P");
    expect(await handler(null, { sessionId: "S" })).toMatchObject({ browser: "dedicated" });
    expect(connectDedicated).toHaveBeenCalledTimes(1);
  });
});
