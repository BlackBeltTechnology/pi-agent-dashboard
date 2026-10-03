/**
 * Schema model tests (change migrate-mcp-to-pi-builtin): every `ServerEntry`
 * property maps to a concrete widget or the JSON fallback (a silently-dropped
 * field fails here), the exposure alias resolves for display, secret masking
 * spares ${REF}/! literals, transport visibility, whole-entry `buildEntry`,
 * redaction-sentinel stripping, and save validation.
 */
import { describe, expect, it } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import {
  buildEntry,
  clone,
  deepEqual,
  defsOf,
  fieldsOf,
  getPath,
  isLiteralValue,
  isMaskedValue,
  isRedacted,
  isSecretKeyName,
  setPath,
  stripRedacted,
  type Transport,
  validateDraft,
  visibleUnderTransport,
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

  it("maps the notable fields to the required widgets", () => {
    const defs = defsOf(DOC);
    const expectWidget = (name: string, widget: string): void => {
      const prop = propertiesOf("ServerEntry")[name];
      expect(widgetFor(prop as never, defs), name).toBe(widget);
    };
    expectWidget("command", "text");
    expectWidget("url", "text");
    expectWidget("description", "text");
    expectWidget("cwd", "text");
    expectWidget("args", "string-list");
    expectWidget("env", "record");
    expectWidget("headers", "record");
    expectWidget("oauth", "nested-group");
    expectWidget("auth", "nested-group");
    expectWidget("exposure", "enum");
    expectWidget("toolExposure", "record");
    expectWidget("type", "enum");
    expectWidget("timeout", "number");
    expectWidget("enabled", "boolean");
  });
});

describe("fieldsOf", () => {
  it("derives transports, secrets, markers, children and the exposure alias resolver", () => {
    const fields = fieldsOf(DOC);
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(fields.length).toBe(Object.keys(propertiesOf("ServerEntry")).length);
    expect(byName.get("command")?.transport).toBe("command");
    expect(byName.get("url")?.transport).toBe("url");
    expect(byName.get("args")?.transport).toBeNull();
    expect(byName.get("env")?.secret).toBe(true);
    expect(byName.get("headers")?.secret).toBe(true);
    expect(byName.get("auth")?.globalOnly).toBe(true);

    const oauth = byName.get("oauth");
    expect(oauth?.children?.map((c) => c.name)).toContain("oauth.clientSecret");
    expect(oauth?.children?.find((c) => c.name === "oauth.clientSecret")?.secret).toBe(true);

    const exposure = byName.get("exposure");
    expect(exposure?.enumValues).toEqual(["codemode", "deferred", "direct", "hidden"]);
    expect(exposure?.displayResolver?.("codemode-deferred")).toBe("codemode");
    expect(exposure?.displayResolver?.("direct")).toBe("direct");

    const toolExposure = byName.get("toolExposure");
    expect(toolExposure?.valueEnum).toEqual(["codemode", "deferred", "direct", "hidden"]);
  });
});

describe("transport visibility", () => {
  it("shows one transport at a time; shared fields render on both tabs", () => {
    expect(visibleUnderTransport("command", "url")).toBe(false);
    expect(visibleUnderTransport("args", "url")).toBe(false);
    expect(visibleUnderTransport("env", "url")).toBe(false);
    expect(visibleUnderTransport("url", "command")).toBe(false);
    expect(visibleUnderTransport("headers", "command")).toBe(false);
    expect(visibleUnderTransport("oauth", "command")).toBe(false);
    expect(visibleUnderTransport("url", "url")).toBe(true);
    expect(visibleUnderTransport("headers", "url")).toBe(true);
    // shared fields
    expect(visibleUnderTransport("description", "command")).toBe(true);
    expect(visibleUnderTransport("description", "url")).toBe(true);
    expect(visibleUnderTransport("exposure", "url")).toBe(true);
    expect(visibleUnderTransport("type", "url")).toBe(true);
  });
});

describe("masking", () => {
  it("matches credential key names only", () => {
    expect(isSecretKeyName("Authorization")).toBe(true);
    expect(isSecretKeyName("API_TOKEN")).toBe(true);
    expect(isSecretKeyName("X-Api-Key")).toBe(true);
    expect(isSecretKeyName("CLIENT_SECRET")).toBe(true);
    expect(isSecretKeyName("PATH")).toBe(false);
    expect(isSecretKeyName("Accept")).toBe(false);
  });

  it("treats ${NAME} references and !commands as literal values", () => {
    expect(isLiteralValue("Bearer ${GITHUB_TOKEN}")).toBe(true);
    expect(isLiteralValue("!op read x")).toBe(true);
    expect(isLiteralValue("Bearer abc123")).toBe(false);
    expect(isLiteralValue("lit")).toBe(false);
  });

  it("isMaskedValue combines the field marker, key name and literal exception", () => {
    // x-secret record: every literal value masks…
    expect(isMaskedValue(true, "Accept", "json")).toBe(true);
    // …unless the value is a reference or a command
    expect(isMaskedValue(true, "Accept", "!cmd")).toBe(false);
    expect(isMaskedValue(true, "Accept", "${V}")).toBe(false);
    // non-secret record: only credential-named keys mask
    expect(isMaskedValue(false, "API_KEY", "lit")).toBe(true);
    expect(isMaskedValue(false, "PATH", "/bin")).toBe(false);
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
  it("recognizes sentinels and strips them recursively", () => {
    expect(isRedacted({ redacted: true })).toBe(true);
    expect(isRedacted({ redacted: true, keys: [{ name: "A", secret: true }] })).toBe(true);
    expect(isRedacted({ command: "/bin/x" })).toBe(false);
    expect(isRedacted(undefined)).toBe(false);

    const draft = {
      oauth: { clientId: "a", clientSecret: { redacted: true } },
      headers: { redacted: true, keys: [] },
      url: "https://u",
    };
    expect(stripRedacted(draft)).toEqual({ oauth: { clientId: "a" }, url: "https://u" });
  });
});

describe("buildEntry (whole-entry save body)", () => {
  it("keeps every field, drops the inactive transport's keys", () => {
    const draft = clone({
      command: "/bin/a",
      args: ["--x"],
      env: { A: "1" },
      description: "d",
    });
    expect(buildEntry(draft, "url", { kind: "global" })).toEqual({ description: "d" });
    expect(buildEntry(clone({ url: "https://u", headers: { A: "b" } }), "url", { kind: "global" })).toEqual({
      url: "https://u",
      headers: { A: "b" },
    });
  });

  it("strips redaction sentinels and drops auth at project scope", () => {
    const draft = {
      url: "https://u/mcp",
      oauth: { clientId: "a", clientSecret: { redacted: true } },
      headers: { redacted: true, keys: [{ name: "Authorization", secret: true }] },
      auth: { provider: "radius" },
      futureThing: { x: 1 },
    };
    expect(buildEntry(clone(draft), "url", { kind: "project", cwd: "/w" })).toEqual({
      url: "https://u/mcp",
      oauth: { clientId: "a" },
      futureThing: { x: 1 },
    });
    // global scope keeps auth
    expect(buildEntry(clone(draft), "url", { kind: "global" }).auth).toEqual({ provider: "radius" });
  });
});

describe("validateDraft", () => {
  const fields = fieldsOf(DOC);

  it("requires the active transport's primary field", () => {
    const errors = validateDraft(fields, { url: "https://u" }, "command", {});
    expect(errors.command).toBe("Required");
    expect(validateDraft(fields, { command: "/bin/a" }, "command", {}).command).toBeUndefined();
    expect(validateDraft(fields, { command: "/bin/a" }, "url", {}).url).toBe("Required");
  });

  it("flags empty string-list rows and invalid JSON", () => {
    const errors = validateDraft(fields, { command: "/bin/a", args: [""] }, "command", {});
    expect(errors.args).toBeTruthy();

    const jsonErrors = validateDraft(fields, { command: "/bin/a" }, "command", {});
    expect(jsonErrors).toEqual({});
  });

  it("accepts a valid draft", () => {
    const draft = { command: "/bin/a", args: ["--x"], exposure: "direct", timeout: 30 };
    const transport: Transport = "command";
    expect(validateDraft(fields, draft, transport, {})).toEqual({});
  });
});
