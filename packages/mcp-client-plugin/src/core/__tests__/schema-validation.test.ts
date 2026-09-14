/**
 * Patch validation (change extract-mcp-client-plugin, task 3.2): the plugin's
 * own strict Ajv instance compiles the schema with the x- annotation keywords,
 * never injects defaults, and accepts partial/unknown fields.
 */

import { describe, expect, it } from "vitest";
import { validateTransportPresence } from "../config-writer.js";
import {
  errorFields,
  validateServerPatch,
  validateSettingsPatch,
} from "../schema-validation.js";

describe("schema validation", () => {
  it("compiles the schema with the x- keywords registered", () => {
    // Reaching here means `compile()` succeeded; a missing addKeyword throws.
    expect(validateServerPatch({}).ok).toBe(true);
  });

  it("accepts a partial override patch and injects no defaults", () => {
    const patch = { command: "/bin/x" };
    const r = validateServerPatch(patch);
    expect(r.ok).toBe(true);
    // No schema default may be injected into the patch object itself.
    expect(patch).toEqual({ command: "/bin/x" });
  });

  it("accepts { disabled: true } as a partial project patch", () => {
    expect(validateServerPatch({ disabled: true }).ok).toBe(true);
  });

  it("accepts an unknown extra field (preserved through write)", () => {
    expect(validateServerPatch({ command: "x", unknownField: { n: 1 } }).ok).toBe(true);
  });

  it("rejects a wrong-typed known field and names it", () => {
    const r = validateServerPatch({ command: 5 });
    expect(r.ok).toBe(false);
    expect(errorFields(r.errors)).toContain("command");
  });

  it("validates settings patches separately", () => {
    expect(validateSettingsPatch({ toolPrefix: "mcp" }).ok).toBe(true);
    expect(validateSettingsPatch({ toolPrefix: "bogus" }).ok).toBe(false);
    expect(validateSettingsPatch({ collapsedResultLines: 4 }).ok).toBe(false);
  });
});

describe("validateTransportPresence", () => {
  it("rejects a new server with no transport, naming the transport fields", () => {
    const r = validateTransportPresence({}, false);
    expect(r?.code).toBe("missing-transport");
    expect(r?.fields?.sort()).toEqual(["command", "socket", "url"]);
  });

  it("accepts when a lower source defines the server", () => {
    expect(validateTransportPresence({}, true)).toBeNull();
  });

  it("accepts when a transport is present", () => {
    expect(validateTransportPresence({ url: "u" }, false)).toBeNull();
  });
});
