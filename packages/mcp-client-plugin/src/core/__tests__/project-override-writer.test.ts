/**
 * Writer paths for project overrides, legacy conversion and the unchanged
 * global-scope callers (mcp-client-project-overrides test-plan W1–W18).
 */

import { describe, expect, it } from "vitest";
import { folderCopyOf, isLegacyFolderCopy } from "../config-writer.js";
import { validateServerEntry } from "../schema-validation.js";
import { CWD, GLOBAL, json, makeIO, makeService, PROJECT } from "./helpers.js";

const g = { kind: "global" } as const;
const p = { kind: "project", cwd: CWD } as const;

const docs = {
  url: "https://docs.example/mcp",
  headers: { Authorization: "Bearer secret-value" },
  env: { TOKEN: "t" },
  oauth: { clientId: "id", clientSecret: "s3" },
  auth: { provider: "radius" },
};

function refusalCode(r: { ok: boolean; refusal?: { code: string } }): string | undefined {
  return r.ok ? undefined : r.refusal?.code;
}

describe("W1: enabled — smallest write (D4 decision table)", () => {
  const globals: Array<boolean | undefined> = [undefined, true, false];
  const overrides: Array<boolean | undefined> = [undefined, true, false];
  for (const ge of globals) {
    for (const oe of overrides) {
      for (const req of [true, false]) {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one generated row of the 18-row decision table
        it(`global enabled=${String(ge)} override enabled=${String(oe)} → set ${req ? "on" : "off"}`, () => {
          const globalEntry = { url: "https://d.example/mcp", ...(ge === undefined ? {} : { enabled: ge }) };
          const files: Record<string, unknown> = { [GLOBAL]: { mcpServers: { docs: globalEntry } } };
          if (oe !== undefined) files[PROJECT] = { mcpServers: { docs: { enabled: oe } } };
          const io = makeIO(files);
          const r = makeService(io).setEnabled("docs", req, p);
          expect(r).toEqual({ ok: true, action: "written" });
          const globalOn = ge !== false;
          const expected = req === globalOn ? undefined : req; // key set only when it differs from global
          if (expected === undefined) {
            if (oe === undefined) expect(io.files.has(PROJECT)).toBe(false);
            else expect(json(io, PROJECT).mcpServers.docs).toBeUndefined();
          } else {
            expect(json(io, PROJECT).mcpServers.docs).toEqual({ enabled: expected });
          }
        });
      }
    }
  }
});

describe("W2–W4: setEnabled at project scope", () => {
  it("W2: a no-op toggle creates no file and writes nothing", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { docs: { url: "https://d.example/mcp" } } } });
    expect(makeService(io).setEnabled("docs", true, p)).toEqual({ ok: true, action: "written" });
    expect(io.files.has(PROJECT)).toBe(false);
    expect(io.writes).toEqual([]);
  });

  it("W3: other override keys survive turning on", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { docs: { url: "https://d.example/mcp" } } },
      [PROJECT]: { mcpServers: { docs: { enabled: false, exposure: "direct", toolExposure: { a: "hidden" } } } },
    });
    makeService(io).setEnabled("docs", true, p);
    expect(json(io, PROJECT).mcpServers.docs).toEqual({ exposure: "direct", toolExposure: { a: "hidden" } });
  });

  it("W4: disabling a global-only server writes only the override, no omitted, no secret", () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: { docs } } });
    const r = makeService(io).setEnabled("docs", false, p);
    expect(r).toEqual({ ok: true, action: "written" });
    expect(r).not.toHaveProperty("omitted");
    expect(json(io, PROJECT).mcpServers).toEqual({ docs: { enabled: false } });
    expect(io.files.get(PROJECT)).not.toContain("secret-value");
  });
});

describe("W5–W8, W12: setProjectOverride", () => {
  const files = { [GLOBAL]: { mcpServers: { docs: { url: "https://d.example/mcp" } } } };

  it("W5: null deletes a key, absent keeps it, an emptied override is deleted", () => {
    const io = makeIO({ ...files, [PROJECT]: { mcpServers: { docs: { enabled: false, exposure: "direct" } } } });
    const svc = makeService(io);
    svc.setProjectOverride("docs", { exposure: null }, p);
    expect(json(io, PROJECT).mcpServers.docs).toEqual({ enabled: false });
    const writes = io.writes.length;
    expect(svc.setProjectOverride("docs", {}, p)).toEqual({ ok: true, override: { enabled: false } });
    expect(io.writes.length).toBe(writes);
    expect(svc.setProjectOverride("docs", { enabled: null }, p)).toEqual({ ok: true, override: undefined });
    expect(json(io, PROJECT).mcpServers.docs).toBeUndefined();
  });

  it("W6: no kept base → no-global-server, file byte-identical", () => {
    const io = makeIO({ ...files, [PROJECT]: { mcpServers: {} } });
    const before = io.files.get(PROJECT);
    expect(refusalCode(makeService(io).setProjectOverride("ghost", { enabled: false }, p))).toBe("no-global-server");
    const invalid = makeIO({
      [GLOBAL]: { mcpServers: { docs: { command: "x", exposure: "bogus" } } },
      [PROJECT]: { mcpServers: {} },
    });
    expect(refusalCode(makeService(invalid).setProjectOverride("docs", { enabled: false }, p))).toBe("no-global-server");
    expect(io.files.get(PROJECT)).toBe(before);
    expect(io.writes).toEqual([]);
    expect(invalid.writes).toEqual([]);
  });

  it("W7: an unparseable global file wins over no-global-server", () => {
    const io = makeIO({ [GLOBAL]: '{ "mcpServers": { "docs": { "url": "https://x.example/mcp", } } }' });
    expect(refusalCode(makeService(io).setProjectOverride("docs", { enabled: false }, p))).toBe("unparseable");
  });

  it("W8: a patch carrying a secret key is refused before any IO", () => {
    const io = makeIO(files);
    const reads: string[] = [];
    const spy = { ...io, readFile: (path: string) => (reads.push(path), io.readFile(path)) };
    const svc = makeService(spy as never);
    const r = svc.setProjectOverride("docs", { headers: { Authorization: "x" } } as never, p);
    expect(refusalCode(r)).toBe("invalid-entry");
    expect(reads).toEqual([]);
    expect(io.writes).toEqual([]);
    expect(validateServerEntry({ headers: {} }, { kind: "override" }).ok).toBe(false);
    expect(validateServerEntry({ enabled: false, exposure: "codemode-deferred" }, { kind: "override" }).ok).toBe(true);
  });

  it("W12: global scope is refused and no file is touched", () => {
    const io = makeIO(files);
    expect(refusalCode(makeService(io).setProjectOverride("docs", { enabled: false }, g))).toBe("invalid-entry");
    expect(io.writes).toEqual([]);
  });

  it("an exposure alias is written as given", () => {
    const io = makeIO(files);
    makeService(io).setProjectOverride("docs", { exposure: "codemode-deferred" }, p);
    expect(json(io, PROJECT).mcpServers.docs).toEqual({ exposure: "codemode-deferred" });
  });

  it("a whole-entry folder entry is not patched as an override", () => {
    const io = makeIO({ ...files, [PROJECT]: { mcpServers: { docs: { url: "https://o.example/mcp" } } } });
    expect(refusalCode(makeService(io).setProjectOverride("docs", { enabled: false }, p))).toBe("invalid-entry");
  });
});

describe("W9–W11: saveServer and collisions", () => {
  const files = { [GLOBAL]: { mcpServers: { docs: { url: "https://d.example/mcp" } } } };

  it("W9: an override-shaped body (or rename of one) is refused at project scope", () => {
    const io = makeIO({ ...files, [PROJECT]: { mcpServers: { old: { enabled: false } } } });
    const svc = makeService(io);
    const r = svc.saveServer("docs", { enabled: false }, p);
    expect(refusalCode(r)).toBe("invalid-entry");
    expect(!r.ok && r.refusal.message).toContain("project-override");
    expect(refusalCode(svc.saveServer("docs", { url: "https://x.example/mcp" }, p, { previousName: "old" }))).toBe("invalid-entry");
    expect(io.writes).toEqual([]);
  });

  it("W10: {url:null} is not an override: pi's validation message", () => {
    const io = makeIO(files);
    const r = makeService(io).saveServer("docs", { url: null } as never, p);
    expect(refusalCode(r)).toBe("invalid-entry");
    expect(!r.ok && r.refusal.message).toContain('needs either "command"');
    expect(!r.ok && r.refusal.message).not.toContain("project-override");
  });

  it("W11: a global write ignores folder overrides but still collides with whole entries", () => {
    const withOverride = makeIO({ [PROJECT]: { mcpServers: { "dev-radius": { enabled: false } } } });
    expect(makeService(withOverride).ensureServerEntry("dev_radius", { command: "x" }, g)).toEqual({ ok: true });
    const withEntry = makeIO({ [PROJECT]: { mcpServers: { "dev-radius": { url: "https://r.example/mcp" } } } });
    const r = makeService(withEntry).ensureServerEntry("dev_radius", { command: "x" }, g);
    expect(refusalCode(r)).toBe("name-collision");
    expect(!r.ok && r.refusal.conflict?.path).toBe(PROJECT);
  });
});

describe("W13–W17: legacy copies", () => {
  const globalEntry = {
    url: "https://docs.example/mcp",
    exposure: "direct",
    headers: { Authorization: "Bearer secret-value" },
    auth: { provider: "radius" },
  };
  const copy = folderCopyOf(globalEntry).copy;

  it("W13: an exact copy (+ enabled, exposure) is legacy", () => {
    expect(isLegacyFolderCopy({ ...copy, enabled: false }, globalEntry)).toBe(true);
  });

  it("W14: a re-entered secret on the folder side vetoes", () => {
    expect(isLegacyFolderCopy({ ...copy, enabled: false, headers: { Authorization: "x" } }, globalEntry)).toBe(false);
    expect(isLegacyFolderCopy({ ...copy, env: { A: "b" } }, globalEntry)).toBe(false);
  });

  it("W15: any other difference, or a non-full entry, is not legacy", () => {
    expect(isLegacyFolderCopy({ ...copy, url: "https://other.example/mcp" }, globalEntry)).toBe(false);
    expect(isLegacyFolderCopy({ type: "http", enabled: false }, globalEntry)).toBe(false);
  });

  it("W16: convert keeps only the override keys that differ from global", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { docs: globalEntry } },
      [PROJECT]: { mcpServers: { docs: { ...copy, enabled: false } } },
    });
    const r = makeService(io).convertLegacyCopy("docs", p);
    expect(r).toEqual({ ok: true, previous: { ...copy, enabled: false } });
    expect(json(io, PROJECT).mcpServers.docs).toEqual({ enabled: false });
  });

  it("W17: nothing differs → the entry is removed and previous returned", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { docs: globalEntry } },
      [PROJECT]: { mcpServers: { docs: { ...copy } } },
    });
    const r = makeService(io).convertLegacyCopy("docs", p);
    expect(r).toEqual({ ok: true, previous: copy });
    expect(json(io, PROJECT).mcpServers.docs).toBeUndefined();
  });

  it("B2: convert refuses a copy whose override keys are invalid, file unchanged", () => {
    for (const bad of [{ exposure: "bogus" }, { enabled: "no" }]) {
      const io = makeIO({
        [GLOBAL]: { mcpServers: { docs: globalEntry } },
        [PROJECT]: { mcpServers: { docs: { ...copy, ...bad } } },
      });
      const before = io.files.get(PROJECT);
      const r = makeService(io).convertLegacyCopy("docs", p);
      expect(refusalCode(r)).toBe("invalid-entry");
      expect(io.files.get(PROJECT)).toBe(before);
      expect(io.writes).toEqual([]);
    }
  });

  it("convert refuses a non-legacy entry and leaves the file unchanged", () => {
    const io = makeIO({
      [GLOBAL]: { mcpServers: { docs: globalEntry } },
      [PROJECT]: { mcpServers: { docs: { url: "https://other.example/mcp" } } },
    });
    const r = makeService(io).convertLegacyCopy("docs", p);
    expect(refusalCode(r)).toBe("invalid-entry");
    expect(io.writes).toEqual([]);
  });
});

describe("W18: apple-tools (global ensureServerEntry) is unaffected", () => {
  it("merges command into the iMCP entry exactly as before", () => {
    const io = makeIO({
      [GLOBAL]: { keep: 1, mcpServers: { iMCP: { command: "/old", enabled: false, exposure: "direct" }, other: { command: "o" } } },
    });
    expect(makeService(io, { isProjectTrusted: undefined }).ensureServerEntry("iMCP", { command: "/new/imcp-server" }, g)).toEqual({ ok: true });
    expect(json(io, GLOBAL)).toEqual({
      keep: 1,
      mcpServers: { iMCP: { command: "/new/imcp-server", enabled: false, exposure: "direct" }, other: { command: "o" } },
    });
  });
});
