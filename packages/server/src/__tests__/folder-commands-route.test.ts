/**
 * `GET /api/pi-resources/commands?cwd=` — folder command list without a live
 * session. test-plan: E9–E14, X4. See change: redesign-directory-home-split.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiResource, PiResourceScope, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCommandRegistry } from "../pi/session-skill-registry.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";

const PASS = async () => {};

const emptyScope = (): PiResourceScope => ({ extensions: [], skills: [], prompts: [], agents: [], themes: [] });
const res = (name: string, filePath: string, type: PiResource["type"] = "skill", enabled = true): PiResource => ({
  name,
  filePath,
  type,
  enabled,
  description: `${name} desc`,
});
const scan = (over: Partial<PiResourcesResult> = {}): PiResourcesResult => ({
  local: emptyScope(),
  global: emptyScope(),
  packages: [],
  ...over,
});
const skillCmd = (n: string, p?: string): CommandInfo => ({ name: `skill:${n}`, source: "skill", ...(p ? { path: p } : {}) });

interface Sess {
  id: string;
  cwd: string;
  status: string;
}

describe("GET /api/pi-resources/commands", () => {
  let fastify: FastifyInstance;
  let tmp: string;
  const registered: string[] = [];

  async function setup(opts: { sessions?: Sess[]; connected?: string[]; scanResult?: PiResourcesResult | Error }) {
    fastify = Fastify();
    const scanResult = opts.scanResult ?? scan();
    const refresh = vi.fn(async () => {
      if (scanResult instanceof Error) throw scanResult;
      return scanResult;
    });
    registerOpenSpecRoutes(fastify, {
      sessionManager: { listAll: () => opts.sessions ?? [] } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      directoryService: { getPiResources: () => undefined, refreshPiResources: refresh } as never,
      networkGuard: PASS as never,
      piGateway: { isSessionConnected: (id: string) => (opts.connected ?? []).includes(id) },
    });
    await fastify.ready();
    return refresh;
  }
  const get = async (cwd: string | null) => {
    const r = await fastify.inject({
      method: "GET",
      url: cwd === null ? "/api/pi-resources/commands" : `/api/pi-resources/commands?cwd=${encodeURIComponent(cwd)}`,
    });
    return { status: r.statusCode, body: r.statusCode === 200 ? JSON.parse(r.payload).data : undefined };
  };
  const report = (id: string, commands: CommandInfo[]) => {
    registered.push(id);
    sessionCommandRegistry.retain(id, commands);
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "folder-cmds-")));
  });
  afterEach(async () => {
    await fastify?.close();
    for (const id of registered.splice(0)) sessionCommandRegistry.remove(id);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("E9: most recently accepted live list wins", async () => {
    const big = Array.from({ length: 173 }, (_, i) => skillCmd(`s${i}`));
    report("A", big);
    report("B", big.slice(0, 5));
    await setup({
      sessions: [
        { id: "A", cwd: tmp, status: "active" },
        { id: "B", cwd: tmp, status: "active" },
      ],
      connected: ["A", "B"],
    });
    const { body } = await get(tmp);
    expect(body.origin).toBe("live");
    expect(body.commands).toHaveLength(5);
  });

  it("E10: ended / not-connected / subdirectory sessions never count as live; empty list falls to scan", async () => {
    const sub = path.join(tmp, "sub");
    fs.mkdirSync(sub);
    report("ended", [skillCmd("a")]);
    report("crashed", [skillCmd("b")]);
    report("subdir", [skillCmd("c")]);
    await setup({
      sessions: [
        { id: "ended", cwd: tmp, status: "ended" },
        { id: "crashed", cwd: tmp, status: "active" },
        { id: "subdir", cwd: sub, status: "active" },
      ],
      connected: ["subdir"],
    });
    expect((await get(tmp)).body.origin).not.toBe("live");
    await fastify.close();

    sessionCommandRegistry.retain("emptyl", []);
    registered.push("emptyl");
    await setup({
      sessions: [{ id: "emptyl", cwd: tmp, status: "active" }],
      connected: ["emptyl"],
      scanResult: scan({ global: { ...emptyScope(), skills: [res("xlsx", "/g/xlsx/SKILL.md")] } }),
    });
    const { body } = await get(tmp);
    expect(body.origin).toBe("scan");
    expect(body.commands.map((c: CommandInfo) => c.name)).toEqual(["skill:xlsx"]);
  });

  it("E11: trailing separator and symlink resolve to the live session; missing dir is 200", async () => {
    const link = `${tmp}-link`;
    fs.symlinkSync(tmp, link);
    try {
      report("A", [skillCmd("a")]);
      await setup({ sessions: [{ id: "A", cwd: tmp, status: "active" }], connected: ["A"] });
      expect((await get(`${tmp}/`)).body.origin).toBe("live");
      expect((await get(link)).body.origin).toBe("live");
      const gone = await get("/definitely/gone/");
      expect(gone.status).toBe(200);
      expect(["none", "scan"]).toContain(gone.body.origin);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it("E12: missing / relative / empty cwd → 400", async () => {
    await setup({});
    expect((await get(null)).status).toBe(400);
    expect((await get("p")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });

  it("E13: scan mapping — enabled skills/prompts, scope, path", async () => {
    const doc = path.join(tmp, ".pi/skills/document-organizer/SKILL.md");
    const pkg = path.join(tmp, ".pi/git/pkg/skills/pkgskill/SKILL.md");
    await setup({
      scanResult: scan({
        local: { ...emptyScope(), skills: [res("document-organizer", doc)] },
        global: {
          ...emptyScope(),
          skills: [res("xlsx", "/home/u/.pi/agent/skills/xlsx/SKILL.md"), res("pdf", "/home/u/.pi/agent/skills/pdf/SKILL.md", "skill", false)],
          prompts: [res("weekly-review", "/home/u/.pi/agent/prompts/weekly-review.md", "prompt")],
        },
        packages: [{ name: "p", source: "npm:p", scope: "local", resources: { ...emptyScope(), skills: [res("pkgskill", pkg)] } }],
      }),
    });
    const { body } = await get(tmp);
    const byName = new Map<string, { scope: string; source: string; path: string }>(
      body.commands.map((c: { name: string; scope: string; source: string; path: string }) => [c.name, c]),
    );
    expect(body.origin).toBe("scan");
    expect(byName.get("skill:document-organizer")).toMatchObject({ scope: "folder", source: "skill", path: doc });
    expect(byName.get("skill:pkgskill")).toMatchObject({ scope: "folder" });
    expect(byName.get("skill:xlsx")).toMatchObject({ scope: "global" });
    expect(byName.get("weekly-review")).toMatchObject({ source: "prompt", scope: "global" });
    expect(byName.has("skill:pdf")).toBe(false);
  });

  it("E14: live entries get scope from their path", async () => {
    report("A", [
      skillCmd("local", path.join(tmp, ".pi/skills/local/SKILL.md")),
      skillCmd("glob", "/home/u/.pi/agent/skills/glob/SKILL.md"),
      skillCmd("nopath"),
    ]);
    await setup({ sessions: [{ id: "A", cwd: tmp, status: "active" }], connected: ["A"] });
    const { body } = await get(tmp);
    expect(body.commands.map((c: { name: string; scope: string }) => [c.name, c.scope])).toEqual([
      ["skill:local", "folder"],
      ["skill:glob", "global"],
      ["skill:nopath", "global"],
    ]);
  });

  it("X4: a degraded scan still answers with origin scan", async () => {
    await setup({ scanResult: scan({ degraded: true, global: { ...emptyScope(), skills: [res("xlsx", "/g/xlsx/SKILL.md")] } }) });
    const { status, body } = await get(tmp);
    expect(status).toBe(200);
    expect(body.origin).toBe("scan");
  });

  it("a scan failure degrades to origin none, not a 500", async () => {
    await setup({ scanResult: new Error("boom") });
    const { status, body } = await get(tmp);
    expect(status).toBe(200);
    expect(body).toEqual({ commands: [], origin: "none" });
  });
});
