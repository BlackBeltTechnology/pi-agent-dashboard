/**
 * Config writer over pi's built-in MCP layers
 * (migrate-mcp-to-pi-builtin test-plan E10, E11, E18, E19, E20, E24, E25).
 */

import { describe, expect, it } from "vitest";
import { CWD, GLOBAL, json, makeIO, makeService, PROJECT } from "./helpers.js";

const g = { kind: "global" } as const;
const p = { kind: "project", cwd: CWD } as const;

describe("E10 — writer keeps siblings, enforces names and pi's entry rules", () => {
  const base = {
    x: { keep: true },
    mcpServers: { a: { url: "https://a.example/mcp" }, b: { command: "b", args: ["--x"], custom: 1 } },
  };

  it("saving `a` leaves `b` and top-level `x` unchanged", () => {
    const io = makeIO({ [GLOBAL]: base });
    const svc = makeService(io);
    expect(svc.saveServer("a", { url: "https://a2.example/mcp", description: "A" }, g)).toEqual({ ok: true });
    const out = json(io, GLOBAL);
    expect(out.x).toEqual({ keep: true });
    expect(out.mcpServers.b).toEqual(base.mcpServers.b);
    expect(out.mcpServers.a).toEqual({ url: "https://a2.example/mcp", description: "A" });
  });

  it.each([
    ["my server", { url: "https://x.example/mcp" }, "invalid-name"],
    ["__proto__", { url: "https://x.example/mcp" }, "invalid-name"],
    ["constructor", { url: "https://x.example/mcp" }, "invalid-name"],
    ["dual", { command: "x", url: "https://x.example/mcp" }, "transport-conflict"],
    ["sse", { url: "https://x.example/mcp", type: "sse" }, "invalid-entry"],
    ["t0", { command: "x", timeout: 0 }, "invalid-entry"],
    ["args", { command: "x", args: "x" }, "invalid-entry"],
  ])("refuses %s with %s and leaves the file byte-identical", (name, entry, code) => {
    const io = makeIO({ [GLOBAL]: base });
    const before = io.files.get(GLOBAL);
    const r = makeService(io).saveServer(name, entry as never, g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe(code);
    expect(io.files.get(GLOBAL)).toBe(before);
    expect(io.writes).toEqual([]);
  });

  it("carries pi's own reason for an invalid entry", () => {
    const r = makeService(makeIO()).saveServer("sse", { url: "https://x.example/mcp", type: "sse" }, g);
    expect(!r.ok && r.refusal.message).toMatch(/legacy SSE transport is not supported/);
    const t = makeService(makeIO()).saveServer("t", { command: "x", timeout: 0 }, g);
    expect(!t.ok && t.refusal.message).toMatch(/timeout must be a positive number/);
  });

  it("rename removes the previous key", () => {
    const io = makeIO({ [GLOBAL]: base });
    expect(makeService(io).saveServer("a2", { url: "https://a.example/mcp" }, g, { previousName: "a" }).ok).toBe(true);
    expect(Object.keys(json(io, GLOBAL).mcpServers).sort()).toEqual(["a2", "b"]);
  });

  it("remove returns the removed entry verbatim", () => {
    const io = makeIO({ [GLOBAL]: base });
    const r = makeService(io).removeServer("b", g);
    expect(r).toEqual({ ok: true, removed: base.mcpServers.b });
    expect(json(io, GLOBAL).mcpServers.b).toBeUndefined();
  });
});

describe("E11 — enabled semantics and the folder copy", () => {
  const docs = {
    url: "https://docs.example/mcp",
    headers: { Authorization: "Bearer secret-value" },
    auth: { provider: "radius" },
    exposure: "direct",
  };

  it("folder disable of a global-only server writes a copy without secrets or auth; enable offers a choice", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { docs } } });
    const svc = makeService(io);
    const off = svc.setEnabled("docs", false, p);
    expect(off).toEqual({ ok: true, action: "written", omitted: ["headers", "auth"] });
    const copy = json(io, PROJECT).mcpServers.docs;
    expect(copy).toEqual({ url: "https://docs.example/mcp", exposure: "direct", enabled: false });
    expect(io.files.get(PROJECT)).not.toContain("secret-value");

    const writesBefore = io.writes.length;
    const on = svc.setEnabled("docs", true, p);
    expect(on).toEqual({ ok: true, action: "needs-choice", omitted: ["headers", "auth"] });
    expect(io.writes.length).toBe(writesBefore);
  });

  it("global disable writes enabled:false; global enable removes the key", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { docs } } });
    const svc = makeService(io);
    expect(svc.setEnabled("docs", false, g).ok).toBe(true);
    expect(json(io, GLOBAL).mcpServers.docs.enabled).toBe(false);
    expect(svc.setEnabled("docs", true, g)).toEqual({ ok: true, action: "written" });
    expect("enabled" in json(io, GLOBAL).mcpServers.docs).toBe(false);
  });

  it("oauth.clientSecret is omitted from the copy while the rest of oauth stays", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { o: { url: "https://o.example/mcp", oauth: { clientId: "id", clientSecret: "s3" } } } },
    });
    const r = makeService(io).setEnabled("o", false, p);
    expect(r).toEqual({ ok: true, action: "written", omitted: ["oauth.clientSecret"] });
    expect(json(io, PROJECT).mcpServers.o.oauth).toEqual({ clientId: "id" });
  });
});

describe("E18 — `-`/`_` namespace collision", () => {
  it("(a) project write dev_radius vs global dev-radius is refused naming both", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { "dev-radius": { url: "https://r.example/mcp" } } } });
    const r = makeService(io).saveServer("dev_radius", { command: "x" }, p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe("name-collision");
      expect(r.refusal.message).toContain("dev_radius");
      expect(r.refusal.message).toContain("dev-radius");
    }
  });

  it("(b) re-saving dev_radius itself is accepted", () => {
    const io = makeIO({ [PROJECT]: { mcpServers: { dev_radius: { command: "x" } } } });
    expect(makeService(io).saveServer("dev_radius", { command: "y" }, p)).toEqual({ ok: true });
  });

  it("(c) global write dev_radius vs a known trusted folder's dev-radius is refused naming the folder entry", () => {
    const io = makeIO({ [PROJECT]: { mcpServers: { "dev-radius": { command: "x" } } } });
    const r = makeService(io).saveServer("dev_radius", { command: "y" }, g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe("name-collision");
      expect(r.refusal.conflict).toEqual({ name: "dev-radius", path: PROJECT });
    }
  });

  it("an untrusted folder's entry does not block a global write", () => {
    const io = makeIO({ [PROJECT]: { mcpServers: { "dev-radius": { command: "x" } } } });
    expect(makeService(io, { isProjectTrusted: () => false }).saveServer("dev_radius", { command: "y" }, g).ok).toBe(true);
  });
});

describe("E19 — provider auth is global-only", () => {
  const entry = { url: "https://r.example/mcp", auth: { provider: "radius" } };

  it("project scope refused, file byte-identical", () => {
    const io = makeIO({ [PROJECT]: { mcpServers: {} } });
    const before = io.files.get(PROJECT);
    const r = makeService(io).saveServer("r", entry, p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe("invalid-entry");
      expect(r.refusal.message).toMatch(/global-only/);
    }
    expect(io.files.get(PROJECT)).toBe(before);
  });

  it("global https accepted; non-loopback http refused", () => {
    expect(makeService(makeIO()).saveServer("r", entry, g)).toEqual({ ok: true });
    const r = makeService(makeIO()).saveServer("r", { url: "http://example.com/mcp", auth: { provider: "radius" } }, g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.message).toMatch(/auth requires an https URL/);
    expect(makeService(makeIO()).saveServer("l", { url: "http://127.0.0.1:9/mcp", auth: { provider: "radius" } }, g).ok).toBe(true);
  });
});

describe("E20 — exposure alias preserved by the writer", () => {
  it("editing only description keeps codemode-deferred; changing exposure writes direct", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { s: { command: "x", exposure: "codemode-deferred" } } } });
    const svc = makeService(io);
    expect(svc.getEffectiveView(g).servers[0].exposure).toBe("codemode");
    svc.saveServer("s", { command: "x", exposure: "codemode-deferred", description: "d" }, g);
    expect(json(io, GLOBAL).mcpServers.s.exposure).toBe("codemode-deferred");
    svc.saveServer("s", { command: "x", exposure: "direct", description: "d" }, g);
    expect(json(io, GLOBAL).mcpServers.s.exposure).toBe("direct");
  });
});

describe("E24 — adapter leftovers convert", () => {
  it("disabled:true → enabled:false; adapter keys removed; rest unchanged", () => {
    const io = makeIO({
      [GLOBAL]: {
        mcpServers: { s: { url: "https://s.example/mcp", disabled: true, directTools: ["a"], lifecycle: "lazy", description: "d" } },
      },
    });
    expect(makeService(io).convertAdapterLeftovers("s", g)).toEqual({ ok: true });
    expect(json(io, GLOBAL).mcpServers.s).toEqual({ url: "https://s.example/mcp", description: "d", enabled: false });
  });
});

describe("E25 — strict JSON: a file pi skips is never written", () => {
  it("global write over a trailing-comma file is refused unparseable, byte-identical", () => {
    const raw = '{ "mcpServers": { "a": { "command": "x" }, } }\n';
    const io = makeIO({ [GLOBAL]: raw });
    const r = makeService(io).saveServer("b", { command: "y" }, g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe("unparseable");
      expect(r.refusal.message).toMatch(/pi skips this file/);
    }
    expect(io.files.get(GLOBAL)).toBe(raw);
  });
});

describe("ensureServerEntry merges over the existing entry", () => {
  it("refreshes command and keeps operator fields", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { iMCP: { command: "/old", enabled: false, exposure: "direct" } } } });
    expect(makeService(io).ensureServerEntry("iMCP", { command: "/new" }, g)).toEqual({ ok: true });
    expect(json(io, GLOBAL).mcpServers.iMCP).toEqual({ command: "/new", enabled: false, exposure: "direct" });
  });

  it("an existing url makes the ensure a transport conflict, and check mode predicts it", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { iMCP: { url: "https://x.example/mcp" } } } });
    const svc = makeService(io);
    const check = svc.checkConfigFiles({ serverName: "iMCP", fields: { command: "/new" } });
    expect(check.mcpJson.ok).toBe(false);
    expect(check.mcpJson.message).toMatch(/command and url/);
    const r = svc.ensureServerEntry("iMCP", { command: "/new" }, g);
    expect(!r.ok && r.refusal.code).toBe("transport-conflict");
  });

  it("a write failure is write-failed with the IO code", () => {
    const io = makeIO();
    io.writeFileAtomic = () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const r = makeService(io).ensureServerEntry("s", { command: "x" }, g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toMatchObject({ code: "write-failed", ioCode: "EACCES" });
  });
});

// review r1 B3: a rename excludes only the entry it replaces in the TARGET
// layer — not a same-named entry in another layer.
describe("rename keeps cross-layer namespace protection", () => {
  it("renaming global dev-radius → dev_radius is refused while a trusted folder defines dev-radius", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { "dev-radius": { url: "https://r.example/mcp" } } },
      [PROJECT]: { mcpServers: { "dev-radius": { command: "x" } } },
    });
    const r = makeService(io).saveServer("dev_radius", { url: "https://r.example/mcp" }, g, { previousName: "dev-radius" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.conflict).toEqual({ name: "dev-radius", path: PROJECT });
  });

  it("the same rename succeeds when no other layer holds the old name", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { "dev-radius": { url: "https://r.example/mcp" } } } });
    expect(
      makeService(io).saveServer("dev_radius", { url: "https://r.example/mcp" }, g, { previousName: "dev-radius" }),
    ).toEqual({ ok: true });
  });
});
