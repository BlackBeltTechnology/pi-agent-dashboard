/**
 * Bidirectional compile-time key-set check: every `ServerEntry` / `McpSettings`
 * key must appear in the hand-authored schema and vice versa. Uses the
 * fail-closed `AssertNever<Exclude<...>>` pattern (NOT the vacuous
 * `const _x: T[] = []` spelling): a drifted key makes the type non-`never` and
 * `tsc` fails on the alias declaration.
 * See change: extract-mcp-client-plugin (task 3.1), and the
 * verify-compile-time-assertions-fail-closed discipline.
 */

import type { McpSettings, ServerEntry } from "pi-mcp-adapter/types";
import { describe, expect, it } from "vitest";
import schema from "../../../schema/mcp-config.schema.json";

type SchemaServerKeys = keyof (typeof schema)["$defs"]["ServerEntry"]["properties"];
type SchemaSettingsKeys = keyof (typeof schema)["$defs"]["McpSettings"]["properties"];
type ServerEntryKeys = keyof ServerEntry;
type SettingsKeys = keyof McpSettings;

type AssertNever<T extends never> = T;

// A key present in the type but missing from the schema fails here.
type _ServerMissingFromSchema = AssertNever<Exclude<ServerEntryKeys, SchemaServerKeys>>;
// A schema key absent from the type fails here.
type _ServerExtraInSchema = AssertNever<Exclude<SchemaServerKeys, ServerEntryKeys>>;
type _SettingsMissingFromSchema = AssertNever<Exclude<SettingsKeys, SchemaSettingsKeys>>;
type _SettingsExtraInSchema = AssertNever<Exclude<SchemaSettingsKeys, SettingsKeys>>;

// Negative proof the comparison is not vacuous: a misspelled key is rejected.
// @ts-expect-error a typo is not a schema key
const _typo: SchemaServerKeys = "bearrToken";

describe("mcp-config.schema.json", () => {
  it("covers every ServerEntry and McpSettings key (compile-time, bidirectionally)", () => {
    // The real assertion is the `_*` type aliases above; reaching here means they hold.
    expect(Object.keys(schema.$defs.ServerEntry.properties).length).toBeGreaterThan(20);
    expect(Object.keys(schema.$defs.McpSettings.properties).length).toBeGreaterThan(20);
  });

  it("marks the secret-bearing and atomic fields", () => {
    const server = schema.$defs.ServerEntry.properties as Record<string, Record<string, unknown>>;
    expect(server.bearerToken["x-secret"]).toBe(true);
    expect(server.headers["x-secret"]).toBe(true);
    expect(server.env["x-secret"]).toBe(true);
    expect((schema.$defs.HttpRequestHeadersCommand.properties as Record<string, Record<string, unknown>>).env["x-secret"]).toBe(true);
    expect((schema.$defs.OAuthConfig.properties as Record<string, Record<string, unknown>>).clientSecret["x-secret"]).toBe(true);
    for (const k of ["env", "headers", "searchKeywords", "oauth", "requestHeadersCommand"]) {
      expect(server[k]["x-atomic"], k).toBe(true);
    }
  });

  it("annotates the three transports and uses no oneOf at the entry root", () => {
    const server = schema.$defs.ServerEntry.properties as Record<string, Record<string, unknown>>;
    expect(server.command["x-transport"]).toBe("command");
    expect(server.url["x-transport"]).toBe("url");
    expect(server.socket["x-transport"]).toBe("socket");
    expect((schema.$defs.ServerEntry as Record<string, unknown>).oneOf).toBeUndefined();
  });
});
