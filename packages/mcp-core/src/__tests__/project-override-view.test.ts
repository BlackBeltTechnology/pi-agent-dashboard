/**
 * Effective view over pi 1.1.0's project overrides
 * (mcp-client-project-overrides test-plan E1–E12).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyProjectEntry, OVERRIDE_KEYS } from "../pi-rules.js";
import { CWD, GLOBAL, makeIO, makeService, PROJECT } from "./helpers.js";

const p = { kind: "project", cwd: CWD } as const;

const docsGlobal = { url: "https://docs.example/mcp", headers: { Authorization: "Bearer secret-value" } };

function view(files: Record<string, unknown>, trusted = true) {
  return makeService(makeIO(files), { isProjectTrusted: () => trusted }).getEffectiveView(p);
}

describe("project override merges onto the kept global entry", () => {
  it("E1: one docs row, Pi global, merged, header redacted, override marker", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: { enabled: false } } },
    });
    const rows = v.servers.filter((s) => s.name === "docs");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.provenance).toBe("pi-global");
    expect(row.enabled).toBe(false);
    expect(row.entry.url).toBe("https://docs.example/mcp");
    expect(JSON.stringify(row.entry)).not.toContain("secret-value");
    expect(row.projectOverride).toMatchObject({ path: PROJECT, keys: ["enabled"], raw: { enabled: false } });
    expect(row.projectOverride?.inherited).toEqual({ enabled: true, exposure: "codemode" });
  });

  it("E2: orphan override → folder row with pi's message", () => {
    const v = view({ [PROJECT]: { mcpServers: { ghost: { enabled: false } } } });
    const row = v.servers.find((s) => s.name === "ghost");
    expect(row).toMatchObject({
      provenance: "pi-folder",
      active: false,
      piError: 'server "ghost" needs "command" or "url", or a global server to override',
      overrideIssue: "orphan",
    });
  });

  it("E3: override of an invalid global → orphan message, no active docs row", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: { command: "x", exposure: "bogus" } } },
      [PROJECT]: { mcpServers: { docs: { exposure: "direct" } } },
    });
    const folder = v.servers.find((s) => s.name === "docs" && s.provenance === "pi-folder");
    expect(folder?.piError).toBe('server "docs" needs "command" or "url", or a global server to override');
    expect(v.servers.some((s) => s.name === "docs" && s.active)).toBe(false);
  });

  it("E4: override of a collision loser → orphan; the winner is unaffected", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { "dev-radius": { command: "a" }, dev_radius: { command: "b" } } },
      [PROJECT]: { mcpServers: { dev_radius: { enabled: false } } },
    });
    const folder = v.servers.find((s) => s.name === "dev_radius" && s.provenance === "pi-folder");
    expect(folder?.piError).toBe('server "dev_radius" needs "command" or "url", or a global server to override');
    expect(v.servers.find((s) => s.name === "dev-radius")).toMatchObject({ active: true, enabled: true });
  });

  it("E5: bad keys → folder row; the global row is unchanged", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: { enabled: false, timeout: 5 } } },
    });
    const folder = v.servers.find((s) => s.provenance === "pi-folder");
    expect(folder?.piError).toContain("an override can only set enabled, exposure, toolExposure");
    expect(folder?.overrideIssue).toBe("bad-keys");
    expect(v.servers.find((s) => s.provenance === "pi-global")).toMatchObject({ active: true, enabled: true });
    expect(v.servers.find((s) => s.provenance === "pi-global")?.projectOverride).toBeUndefined();
  });

  it.each([
    ["url:null", { url: null, enabled: false }],
    ["type only", { type: "http" }],
    ["url empty", { url: "" }],
  ])("E6: %s is a whole-entry replace, never merged", (_label, entry) => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: entry } },
    });
    const folder = v.servers.find((s) => s.provenance === "pi-folder");
    expect(folder?.piError).toMatch(/needs either|url must be/);
    expect(folder?.overrideIssue).toBeUndefined();
    expect(v.servers.find((s) => s.provenance === "pi-global")?.projectOverride).toBeUndefined();
  });

  it("E7: merged validation failure → pi's message, global unchanged", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: { exposure: "nope" } } },
    });
    const folder = v.servers.find((s) => s.provenance === "pi-folder");
    expect(folder?.piError).toContain("exposure must be one of");
    expect(folder?.overrideIssue).toBe("invalid");
    expect(v.servers.find((s) => s.provenance === "pi-global")).toMatchObject({ active: true });
  });

  it("E8: untrusted override → global enabled, folder row inactive project-not-trusted", () => {
    const v = view(
      {
        [GLOBAL]: { mcpServers: { docs: docsGlobal } },
        [PROJECT]: { mcpServers: { docs: { enabled: false } } },
      },
      false,
    );
    expect(v.servers.find((s) => s.provenance === "pi-global")).toMatchObject({ enabled: true, active: true });
    const folder = v.servers.find((s) => s.provenance === "pi-folder");
    expect(folder).toMatchObject({ active: false, inactiveReason: "project-not-trusted" });
    expect(folder?.piError).toBeUndefined();
  });

  it("E9: an override is exempt from the project-auth and namespace-collision checks", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { "dev-radius": { url: "https://r.example/mcp", auth: { provider: "radius" } } } },
      [PROJECT]: { mcpServers: { "dev-radius": { exposure: "direct" } } },
    });
    const rows = v.servers.filter((s) => s.name === "dev-radius");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ active: true, exposure: "direct" });
    expect(rows[0].inactiveReason).toBeUndefined();
  });

  it("E10: aliases display resolved; the raw override keeps the literal", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: { exposure: "codemode-deferred", toolExposure: { search: "codemode-deferred" } } } },
    });
    const row = v.servers.find((s) => s.name === "docs");
    expect(row?.exposure).toBe("codemode");
    expect(row?.projectOverride?.raw).toEqual({ exposure: "codemode-deferred", toolExposure: { search: "codemode-deferred" } });
  });

  it("E11: a whole-entry replace stays Pi folder and overridesGlobal", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: { url: "https://other.example/mcp" } } },
    });
    expect(v.servers.find((s) => s.name === "docs")).toMatchObject({ provenance: "pi-folder", overridesGlobal: true });
  });

  it("flags a legacy whole-entry copy so the page can offer Convert", () => {
    const v = view({
      [GLOBAL]: { mcpServers: { docs: docsGlobal } },
      [PROJECT]: { mcpServers: { docs: { url: "https://docs.example/mcp", enabled: false } } },
    });
    expect(v.servers.find((s) => s.name === "docs")?.legacyCopy).toBe(true);
  });
});

describe("E12: pi-message golden", () => {
  // pi's exports map hides dist/, so walk up to the hoisted install instead of resolving it.
  let source: string | null = null;
  for (let dir = process.cwd(); source === null; dir = dirname(dir)) {
    const file = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "extensions", "mcp", "config.js");
    if (existsSync(file)) source = readFileSync(file, "utf8");
    if (dirname(dir) === dir) break;
  }
  const supported = source?.includes("OVERRIDE_KEYS") === true;

  it.skipIf(!supported)("classifyProjectEntry messages equal the strings in pi's config.js", () => {
    const text = source as string;
    const orphan = /errors\.push\(`\$\{path\}: (server "\$\{name\}" needs "command" or "url", or a global server to override)`\)/.exec(text);
    const badKeys = /errors\.push\(`\$\{path\}: (server "\$\{name\}": an override can only set \$\{OVERRIDE_KEYS\.join\(", "\)\})`\)/.exec(text);
    expect(orphan).not.toBeNull();
    expect(badKeys).not.toBeNull();
    const fill = (t: string): string => t.replace("${name}", "docs").replace('${OVERRIDE_KEYS.join(", ")}', OVERRIDE_KEYS.join(", "));
    const kept = new Map([["docs", { url: "https://x.example/mcp" }]]);
    const o = classifyProjectEntry("docs", { enabled: false }, new Map());
    const b = classifyProjectEntry("docs", { timeout: 5 }, kept);
    expect(o.kind === "orphan" && o.message).toBe(fill((orphan as RegExpExecArray)[1]));
    expect(b.kind === "bad-keys" && b.message).toBe(fill((badKeys as RegExpExecArray)[1]));
    // the merged-validation message is pi's own validateMcpServerConfig output (mirrored in validatePiEntry)
    const bad = classifyProjectEntry("docs", { exposure: "nope" }, kept);
    expect(bad.kind === "invalid" && bad.message).toContain('server "docs": exposure must be one of');
  });
});
