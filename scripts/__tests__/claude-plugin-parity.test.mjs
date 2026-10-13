/**
 * Parity + route-existence tests for the Claude plugin's control skill.
 *
 *  - E35: the shipped `references/api-reference.md` equals the extension
 *    skill's reference minus the "WebSocket bus verbs" section, byte for byte.
 *  - E36: the sync script fails (non-zero, naming the heading) when that
 *    heading is absent from the source.
 *  - E38: every `METHOD /api/...` the control SKILL.md names is registered
 *    by the server.
 *
 * See change: add-claude-code-plugin.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SECTION_HEADING, transformApiReference } from "../sync-claude-plugin.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = path.join(REPO_ROOT, "packages/extension/.pi/skills/pi-dashboard/references/api-reference.md");
const SHIPPED = path.join(REPO_ROOT, "packages/claude-plugin/skills/pi-dashboard-control/references/api-reference.md");
const CONTROL_SKILL = path.join(REPO_ROOT, "packages/claude-plugin/skills/pi-dashboard-control/SKILL.md");
const SYNC = path.join(REPO_ROOT, "scripts/sync-claude-plugin.mjs");

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("derived api-reference (E35)", () => {
  it("equals the source minus the WebSocket bus verbs section", () => {
    const expected = transformApiReference(fs.readFileSync(SOURCE, "utf8"));
    const shipped = fs.readFileSync(SHIPPED, "utf8");
    expect(
      shipped === expected,
      `${path.relative(REPO_ROOT, SHIPPED)} drifted from its source; run: node scripts/sync-claude-plugin.mjs`,
    ).toBe(true);
  });

  it("the transform removes only that section", () => {
    const src = fs.readFileSync(SOURCE, "utf8");
    const out = transformApiReference(src);
    expect(out).not.toContain(SECTION_HEADING);
    expect(out).toContain("## Health & Status");
    expect(src.length - out.length).toBeGreaterThan(100);
  });
});

describe("missing heading (E36)", () => {
  it("exits non-zero naming the heading", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-plugin-sync-"));
    tmpDirs.push(dir);
    const src = fs.readFileSync(SOURCE, "utf8").replace(SECTION_HEADING, "## Renamed section");
    const srcPath = path.join(dir, "api-reference.md");
    const outPath = path.join(dir, "out.md");
    fs.writeFileSync(srcPath, src);
    const r = spawnSync("node", [SYNC, "--source", srcPath, "--out", outPath], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(SECTION_HEADING);
    expect(fs.existsSync(outPath)).toBe(false);
  });
});

/** Every `.ts` file under `dir`, excluding tests. */
function serverSources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      out.push(...serverSources(full));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("route existence (E38)", () => {
  const skill = fs.readFileSync(CONTROL_SKILL, "utf8");
  const corpus = serverSources(path.join(REPO_ROOT, "packages/server/src")).map((f) => fs.readFileSync(f, "utf8"));

  /** METHOD + path pairs the skill names, from curl lines and `METHOD /api/..` mentions. */
  function namedRoutes() {
    const routes = new Map();
    for (const m of skill.matchAll(/curl[^\n]*?-X\s+(GET|POST|PUT|DELETE)\s+\S*?(\/api\/[A-Za-z0-9/_:-]+)/g)) {
      routes.set(`${m[1]} ${m[2]}`, { method: m[1], path: m[2] });
    }
    for (const m of skill.matchAll(/curl\s+(?:-s\s+)?(?:-H\s+\S+\s+)?\S*?(\/api\/[A-Za-z0-9/_:-]+)(?=\s|$)/gm)) {
      routes.set(`GET ${m[1]}`, { method: "GET", path: m[1] });
    }
    return [...routes.values()];
  }

  /** Skill examples use a literal ID placeholder where the server has `:id`. */
  const toServerPath = (p) => p.replace(/\/session\/ID(\/|$)/, "/session/:id$1");

  it("names at least the five documented routes", () => {
    const keys = namedRoutes().map((r) => `${r.method} ${toServerPath(r.path)}`);
    for (const k of [
      "GET /api/health",
      "GET /api/sessions",
      "POST /api/session/:id/prompt",
      "POST /api/session/:id/abort",
      "POST /api/session/spawn",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("every named method + path is registered by the server", () => {
    const missing = [];
    for (const { method, path: p } of namedRoutes()) {
      const serverPath = toServerPath(p);
      const literal = [`"${serverPath}"`, `'${serverPath}'`, `\`${serverPath}\``];
      const registered = corpus.some((src) => {
        for (const lit of literal) {
          let from = 0;
          for (;;) {
            const idx = src.indexOf(lit, from);
            if (idx === -1) break;
            const start = src.lastIndexOf("fastify.", idx);
            if (start !== -1 && idx - start < 400) {
              const head = src.slice(start, idx).toLowerCase();
              if (head.startsWith(`fastify.${method.toLowerCase()}`)) return true;
            }
            from = idx + lit.length;
          }
        }
        return false;
      });
      if (!registered) missing.push(`${method} ${serverPath}`);
    }
    expect(missing).toEqual([]);
  });
});
