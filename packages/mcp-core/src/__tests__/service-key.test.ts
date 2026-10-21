import { describe, expect, it } from "vitest";
import * as core from "../index.js";

describe("mcp-core service contract (task 2.2)", () => {
  it("exports the service key next to the service type", () => {
    expect(core.MCP_CLIENT_CONFIG_SERVICE_KEY).toBe("mcp-client.config");
  });

  it("exports the factories every consumer needs", () => {
    expect(typeof core.createMcpClientConfigService).toBe("function");
    expect(typeof core.createRealConfigIO).toBe("function");
  });
});
