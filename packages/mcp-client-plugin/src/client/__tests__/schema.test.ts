/**
 * Schema model tests (change extract-mcp-client-plugin, tasks 7.4 + 7.5):
 * every `ServerEntry`/`McpSettings` property maps to a concrete widget or the
 * JSON fallback (a silently-dropped field fails here), atomic fields derive
 * from the schema markers, the credential pattern matches, redaction sentinels
 * are stripped from patches, and save validation flags the spec'd cases.
 */
import { describe, expect, it } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import {
  atomicCounts,
  atomicFieldsOf,
  clone,
  computePatch,
  deepEqual,
  defsOf,
  fieldsForDef,
  fieldsOf,
  getPath,
  isRedacted,
  isSecretKeyName,
  setPath,
  stripRedacted,
  type Transport,
  validateDraft,
  validateFields,
  widgetFor,
} from "../schema.js";

const DOC = schemaDoc as unknown as Record<string, unknown>;

function propertiesOf(defName: string): Record<string, Record<string, unknown>> {
  const defs = defsOf(DOC);
  return (defs[defName]?.properties ?? {}) as Record<string, Record<string, unknown>>;
}

describe("widgetFor covers every schema property (no field is ever dropped)", () => {
  it("maps every ServerEntry property to a concrete widget", () => {
    const defs = defsOf(DOC);
    for (const [name, prop] of Object.entries(propertiesOf("ServerEntry"))) {
      const widget = widgetFor(prop as never, defs);
      expect(widget, `widgetFor(${name})`).toBeTruthy();
    }
  });

  it("maps every McpSettings property to a concrete widget", () => {
    const defs = defsOf(DOC);
    for (const [name, prop] of Object.entries(propertiesOf("McpSettings"))) {
      const widget = widgetFor(prop as never, defs);
      expect(widget, `widgetFor(${name})`).toBeTruthy();
    }
  });

  it("maps the notable fields to the required widgets", () => {
    const defs = defsOf(DOC);
    const expectWidget = (name: string, widget: string): void => {
      const prop = propertiesOf("ServerEntry")[name];
      expect(widgetFor(prop as never, defs), name).toBe(widget);
    };
    expectWidget("command", "text");
    expectWidget("args", "string-list");
    expectWidget("includeTools", "string-list");
    expectWidget("env", "record");
    expectWidget("headers", "record");
    expectWidget("searchKeywords", "record");
    expectWidget("oauth", "nested-group");
    expectWidget("requestHeadersCommand", "nested-group");
    expectWidget("auth", "json");
    expectWidget("bearerTokenStore", "json");
    expectWidget("directTools", "toggle-list");
    expectWidget("approveTools", "toggle-list");
    expectWidget("lifecycle", "enum");
    expectWidget("toolPrefix", "enum");
    expectWidget("protocolVersion", "enum");
    expectWidget("disabled", "boolean");
    expectWidget("trace", "boolean");
    expectWidget("exposeResources", "boolean");
    expectWidget("idleTimeout", "number");
    expectWidget("requestTimeoutMs", "number");
    expectWidget("bearerToken", "text");
    expectWidget("bearerTokenEnv", "text");
    expectWidget("socket", "text");
    expectWidget("url", "text");
    expectWidget("cwd", "text");
    expectWidget("pluginDataDir", "text");
    expectWidget("httpTransport", "enum");
  });

  it("derives fieldsOf with transports and nested children", () => {
    const fields = fieldsOf(DOC);
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(fields.length).toBe(Object.keys(propertiesOf("ServerEntry")).length);
    expect(byName.get("command")?.transport).toBe("command");
    expect(byName.get("url")?.transport).toBe("url");
    expect(byName.get("socket")?.transport).toBe("socket");
    expect(byName.get("args")?.transport).toBeNull();
    const oauth = byName.get("oauth");
    expect(oauth?.children?.map((c) => c.name)).toContain("oauth.clientSecret");
    expect(oauth?.children?.find((c) => c.name === "oauth.clientSecret")?.secret).toBe(true);
    const rhc = byName.get("requestHeadersCommand");
    expect(rhc?.children?.map((c) => c.name)).toContain("requestHeadersCommand.env");
  });

  it("derives the atomic field list from the schema markers", () => {
    expect([...atomicFieldsOf(DOC)].sort()).toEqual(
      ["env", "headers", "oauth", "requestHeadersCommand", "searchKeywords"].sort(),
    );
  });
});

describe("fieldsForDef / validateFields", () => {
  it("delegates fieldsOf to the ServerEntry definition", () => {
    expect(fieldsForDef(DOC, "ServerEntry").map((f) => f.name)).toEqual(
      fieldsOf(DOC).map((f) => f.name),
    );
  });

  it("derives another definition's fields and validates them without a transport", () => {
    const settings = fieldsForDef(DOC, "McpSettings");
    expect(settings).toHaveLength(Object.keys(propertiesOf("McpSettings")).length);
    expect(settings.map((f) => f.name)).toContain("toolPrefix");
    expect(validateFields(settings, {}, {})).toEqual({});
    expect(validateFields(settings, {}, { idleTimeout: "abc" })).toEqual({
      idleTimeout: "Must be a number",
    });
  });
});

describe("masking pattern", () => {
  it("matches credential key names only", () => {
    expect(isSecretKeyName("Authorization")).toBe(true);
    expect(isSecretKeyName("API_TOKEN")).toBe(true);
    expect(isSecretKeyName("CLIENT_KEY")).toBe(true);
    expect(isSecretKeyName("CLIENT_SECRET")).toBe(true);
    expect(isSecretKeyName("PATH")).toBe(false);
    expect(isSecretKeyName("HOME")).toBe(false);
  });
});

describe("deepEqual / clone / setPath", () => {
  it("deepEqual compares structure", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual("x", "x")).toBe(true);
  });

  it("setPath writes and deletes immutably on nested paths", () => {
    const base = { oauth: { clientId: "a" }, url: "https://u" };
    const next = setPath(base, ["oauth", "clientSecret"], "s");
    expect(next).toEqual({ oauth: { clientId: "a", clientSecret: "s" }, url: "https://u" });
    expect(base.oauth.clientId).toBe("a");
    expect(getPath(next, ["oauth", "clientId"])).toBe("a");
    expect(setPath(next, ["url"], undefined).url).toBeUndefined();
  });
});

describe("redaction sentinels", () => {
  it("recognizes scalar and record sentinels", () => {
    expect(isRedacted({ redacted: true })).toBe(true);
    expect(isRedacted({ redacted: true, keys: [{ name: "A", secret: true }] })).toBe(true);
    expect(isRedacted({ command: "/bin/x" })).toBe(false);
    expect(isRedacted(undefined)).toBe(false);
  });

  it("counts inherited keys and secrets for the override note", () => {
    const redacted = {
      redacted: true,
      keys: [
        { name: "A", secret: false },
        { name: "API_TOKEN", secret: true },
        { name: "CLIENT_SECRET", secret: true },
      ],
    };
    expect(atomicCounts(redacted)).toEqual({ count: 3, secrets: 2 });
    expect(atomicCounts({ PATH: "/bin", API_KEY: "x" })).toEqual({ count: 2, secrets: 1 });
    expect(atomicCounts(undefined)).toEqual({ count: 0, secrets: 0 });
  });

  it("strips sentinels recursively, including inside nested objects", () => {
    const draft = {
      oauth: { clientId: "a", clientSecret: { redacted: true } },
      env: { redacted: true, keys: [] },
      url: "https://u",
    };
    expect(stripRedacted(draft)).toEqual({ oauth: { clientId: "a" }, url: "https://u" });
  });
});

describe("computePatch", () => {
  it("sends only changed keys and unsets only removed keys", () => {
    const baseline = { command: "/bin/a", args: ["--x"], futureThing: { x: 1 } };
    const draft = { ...clone(baseline), command: "/bin/b" };
    expect(computePatch(draft, baseline)).toEqual({ set: { command: "/bin/b" }, unset: [] });

    const removed: Record<string, unknown> = { ...clone(baseline) };
    delete removed.args;
    expect(computePatch(removed, baseline)).toEqual({ set: {}, unset: ["args"] });
  });

  it("never includes a redaction sentinel in set", () => {
    const baseline = {
      command: "/bin/a",
      bearerToken: { redacted: true },
      env: { redacted: true, keys: [{ name: "A", secret: true }] },
    };
    const untouched = computePatch(clone(baseline), baseline);
    expect(untouched).toEqual({ set: {}, unset: [] });

    const typed = { ...clone(baseline), bearerToken: "new-tok" };
    expect(computePatch(typed, baseline)).toEqual({ set: { bearerToken: "new-tok" }, unset: [] });

    const overridden = { ...clone(baseline), env: {} };
    expect(computePatch(overridden, baseline)).toEqual({ set: { env: {} }, unset: [] });
  });

  it("strips nested sentinels from a partially-edited atomic object", () => {
    const baseline = { oauth: { clientId: "a", clientSecret: { redacted: true } } };
    const draft = { oauth: { clientId: "b", clientSecret: { redacted: true } } };
    expect(computePatch(draft, baseline)).toEqual({ set: { oauth: { clientId: "b" } }, unset: [] });
  });
});

describe("validateDraft", () => {
  const fields = fieldsOf(DOC);

  it("requires the active transport's primary field", () => {
    const errors = validateDraft(fields, { url: "https://u" }, "command", {});
    expect(errors.command).toBe("Required");
    expect(validateDraft(fields, { command: "/bin/a" }, "command", {}).command).toBeUndefined();
  });

  it("flags empty string-list rows and invalid JSON", () => {
    const errors = validateDraft(fields, { command: "/bin/a", args: [""] }, "command", {});
    expect(errors.args).toBeTruthy();

    const jsonErrors = validateDraft(fields, { command: "/bin/a", auth: "bearer" }, "command", {
      auth: "{not json",
    });
    expect(jsonErrors.auth).toBe("Invalid JSON");
  });

  it("accepts a valid draft", () => {
    const draft = { command: "/bin/a", args: ["--x"], lifecycle: "eager", idleTimeout: 30 };
    const transport: Transport = "command";
    expect(validateDraft(fields, draft, transport, {})).toEqual({});
  });
});
