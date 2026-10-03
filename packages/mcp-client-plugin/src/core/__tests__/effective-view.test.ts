/**
 * Effective view over pi's two layers
 * (migrate-mcp-to-pi-builtin test-plan E8, E9, E24, E25, E26).
 */

import { describe, expect, it } from "vitest";
import { CWD, GLOBAL, makeIO, makeService, PROJECT } from "./helpers.js";

const p = { kind: "project", cwd: CWD } as const;
const g = { kind: "global" } as const;

describe("E8 — project entry replaces global as a whole", () => {
  it("docs equals the folder entry exactly and is marked overriding Pi global", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { docs: { url: "https://g.example/mcp", description: "global", timeout: 9 } } },
      [PROJECT]: { mcpServers: { docs: { command: "local-docs" } } },
    });
    const view = makeService(io).getEffectiveView(p);
    const rows = view.servers.filter((s) => s.name === "docs");
    expect(rows).toHaveLength(1);
    expect(rows[0].entry).toEqual({ command: "local-docs" });
    expect(rows[0].provenance).toBe("pi-folder");
    expect(rows[0].overridesGlobal).toBe(true);
    expect(rows[0].active).toBe(true);
  });

  it("the global view lists only the Pi-global layer", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { a: { command: "a" } } },
      [PROJECT]: { mcpServers: { b: { command: "b" } } },
    });
    const view = makeService(io).getEffectiveView(g);
    expect(view.servers.map((s) => s.name)).toEqual(["a"]);
    expect(view.servers[0].provenance).toBe("pi-global");
  });
});

describe("E9 — trust predicate", () => {
  const files = { [PROJECT]: { mcpServers: { f: { command: "f" } } } };

  it("true → active", () => {
    const v = makeService(makeIO(files), { isProjectTrusted: () => true }).getEffectiveView(p);
    expect(v.trusted).toBe(true);
    expect(v.servers[0]).toMatchObject({ name: "f", active: true });
  });

  it("false → inactive, project not trusted", () => {
    const v = makeService(makeIO(files), { isProjectTrusted: () => false }).getEffectiveView(p);
    expect(v.trusted).toBe(false);
    expect(v.servers[0]).toMatchObject({ name: "f", active: false, inactiveReason: "project-not-trusted" });
  });

  it("absent predicate → inactive", () => {
    const v = makeService(makeIO(files), { isProjectTrusted: undefined }).getEffectiveView(p);
    expect(v.servers[0]).toMatchObject({ active: false, inactiveReason: "project-not-trusted" });
  });

  it("untrusted folder override leaves the global entry in effect", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { f: { command: "global-f" } } },
      ...files,
    });
    const v = makeService(io, { isProjectTrusted: () => false }).getEffectiveView(p);
    const global = v.servers.find((s) => s.provenance === "pi-global");
    const folder = v.servers.find((s) => s.provenance === "pi-folder");
    expect(global).toMatchObject({ active: true });
    expect(folder).toMatchObject({ active: false, inactiveReason: "project-not-trusted" });
  });
});

describe("secrets of inherited global entries are redacted in a project view", () => {
  it("headers/env → key markers, oauth.clientSecret → marker, raw entry not mutated", () => {
    const raw = {
      url: "https://g.example/mcp",
      headers: { Authorization: "Bearer s1", "X-Trace": "t" },
      oauth: { clientId: "id", clientSecret: "s2" },
    };
    const io = makeIO({ [GLOBAL]: { mcpServers: { g: raw } } });
    const svc = makeService(io);
    const row = svc.getEffectiveView(p).servers[0];
    expect(JSON.stringify(row.entry)).not.toContain("s1");
    expect(JSON.stringify(row.entry)).not.toContain("s2");
    expect(row.entry.headers).toEqual({
      redacted: true,
      keys: [
        { name: "Authorization", secret: true },
        { name: "X-Trace", secret: false },
      ],
    });
    expect((row.entry.oauth as Record<string, unknown>).clientId).toBe("id");
    // The global view (own layer) is verbatim.
    expect(svc.getEffectiveView(g).servers[0].entry).toEqual(raw);
  });
});

describe("adapter-era secret leftovers are redacted in a project view too", () => {
  it("bearerToken and requestHeadersCommand.env never reach the folder view", () => {
    const raw = {
      url: "https://g.example/mcp",
      bearerToken: "plain-s3",
      requestHeadersCommand: { command: "node", args: ["x.mjs"], env: { TOKEN: "plain-s4" } },
    };
    const io = makeIO({ [GLOBAL]: { mcpServers: { g: raw } } });
    const row = makeService(io).getEffectiveView(p).servers[0];
    const wire = JSON.stringify(row.entry);
    expect(wire).not.toContain("plain-s3");
    expect(wire).not.toContain("plain-s4");
    expect((row.entry.requestHeadersCommand as Record<string, unknown>).command).toBe("node");
    // the raw file content is untouched
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.g).toEqual(raw);
  });
});

describe("E24 — adapter leftover keys are flagged", () => {
  it("disabled:true reads as enabled under pi with the keys flagged", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { s: { url: "https://s.example/mcp", disabled: true, directTools: ["a"], lifecycle: "lazy" } } },
    });
    const row = makeService(io).getEffectiveView(g).servers[0];
    expect(row.enabled).toBe(true);
    expect(row.active).toBe(true);
    expect(row.adapterLeftovers.sort()).toEqual(["directTools", "disabled", "lifecycle"]);
  });
});

describe("E25 — strict JSON layers", () => {
  it("a trailing-comma global file is reported skipped; project servers still listed", () => {
    const io = makeIO({
      [GLOBAL]: '{ "mcpServers": { "a": { "command": "x" }, } }',
      [PROJECT]: { mcpServers: { f: { command: "f" } } },
    });
    const v = makeService(io).getEffectiveView(p);
    const gl = v.layers.find((l) => l.layer === "pi-global");
    expect(gl?.ok).toBe(false);
    expect(gl?.message).toContain(GLOBAL);
    expect(v.servers.map((s) => s.name)).toEqual(["f"]);
  });
});

describe("E26 — dual-transport read follows pi", () => {
  it("{command,url} is HTTP with command ignored; with type stdio it is stdio with url ignored", () => {
    const io = makeIO({
      [GLOBAL]: {
        mcpServers: {
          a: { command: "x", url: "https://a.example/mcp" },
          b: { command: "x", url: "https://b.example/mcp", type: "stdio" },
        },
      },
    });
    const [a, b] = makeService(io).getEffectiveView(g).servers;
    expect(a).toMatchObject({ transport: "http", ignoredKeys: ["command"] });
    expect(b).toMatchObject({ transport: "stdio", ignoredKeys: ["url"] });
  });
});

describe("auth mode and pi validation on rows", () => {
  it("provider / header / OAuth / stdio", () => {
    const io = makeIO({
      [GLOBAL]: {
        mcpServers: {
          a: { url: "https://a.example/mcp", auth: { provider: "radius" } },
          b: { url: "https://b.example/mcp", headers: { authorization: "Bearer ${T}" } },
          c: { url: "https://c.example/mcp", headers: { "X-Api-Key": "k" } },
          d: { command: "d" },
          e: { url: "ftp://e" },
        },
      },
    });
    const rows = makeService(io).getEffectiveView(g).servers;
    expect(rows.map((r) => r.authMode)).toEqual([
      { kind: "provider", provider: "radius" },
      { kind: "header" },
      { kind: "oauth" },
      undefined,
      { kind: "oauth" },
    ]);
    expect(rows[4]).toMatchObject({ active: false, inactiveReason: "invalid-entry" });
    expect(rows[4].piError).toMatch(/url must be an http or https URL/);
  });
});
