/**
 * Published schema for pi's MCP entry shape (migrate-mcp-to-pi-builtin).
 */

import { describe, expect, it } from "vitest";
import schema from "../../../schema/mcp-config.schema.json";
import { errorFields, validateServerEntry } from "../schema-validation.js";

const props = schema.$defs.ServerEntry.properties as Record<string, Record<string, unknown>>;

describe("mcp-config.schema.json", () => {
  it("describes pi 1.0.0's entry fields", () => {
    expect(Object.keys(props).sort()).toEqual(
      ["args", "auth", "command", "cwd", "description", "enabled", "env", "exposure", "headers", "oauth", "timeout", "toolExposure", "type", "url"].sort(),
    );
    const oauth = schema.$defs.OAuthConfig.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(oauth)).toEqual(
      expect.arrayContaining(["clientId", "clientSecret", "callbackPort", "callbackUrl", "scope", "clientName", "authServerMetadataUrl"]),
    );
  });

  it("marks secrets, transports and the global-only auth", () => {
    expect(props.headers["x-secret"]).toBe(true);
    expect(props.env["x-secret"]).toBe(true);
    expect((schema.$defs.OAuthConfig.properties as Record<string, Record<string, unknown>>).clientSecret["x-secret"]).toBe(true);
    expect(props.command["x-transport"]).toBe("command");
    expect(props.url["x-transport"]).toBe("url");
    expect(props.auth["x-global-only"]).toBe(true);
  });

  it("accepts the codemode-deferred alias and rejects sse", () => {
    expect(validateServerEntry({ command: "x", exposure: "codemode-deferred" }).ok).toBe(true);
    const r = validateServerEntry({ url: "https://x", type: "sse" });
    expect(r.ok).toBe(false);
    expect(errorFields(r.errors)).toContain("type");
  });

  it("injects no defaults and keeps unknown fields", () => {
    const e = { command: "x", custom: { n: 1 } };
    expect(validateServerEntry(e).ok).toBe(true);
    expect(e).toEqual({ command: "x", custom: { n: 1 } });
  });
});
