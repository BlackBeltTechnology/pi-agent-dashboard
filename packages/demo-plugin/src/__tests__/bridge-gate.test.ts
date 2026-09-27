/**
 * The demo fixture bridge registers `demo_echo` only under the opt-in
 * PI_DASHBOARD_FIXTURE_PLUGINS=1 gate — a stale settings.json registration
 * must not surface a fixture tool. See change: expose-plugin-credential-and-oauth-seams (D8).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import activate from "../bridge/index.js";

afterEach(() => { vi.unstubAllEnvs(); });

describe("demo bridge fixture gate", () => {
  it("registers nothing without the gate", () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "");
    const registerTool = vi.fn();
    activate({ registerTool });
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("registers demo_echo under the gate", () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "1");
    const registerTool = vi.fn();
    activate({ registerTool });
    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "demo_echo" }));
  });
});
