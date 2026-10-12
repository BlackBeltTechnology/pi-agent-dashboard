/**
 * Tests for GET /api/packages/health and POST /api/packages/cleanup.
 * See change: add-package-health-cleanup.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageOperationBusyError } from "../package/package-manager-wrapper.js";
import { registerPackageHealthRoutes } from "../routes/package-health-routes.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  DefaultPackageManager: function () {
    return {};
  },
  SettingsManager: { create: () => ({}) },
}));

describe("package-health-routes", () => {
  let app: FastifyInstance;
  let dir: string;
  let settingsPath: string;
  let wrapper: any;

  const writeSettings = (obj: unknown) => fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2));
  const readSettings = () => JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  const backups = () => fs.readdirSync(dir).filter((f) => f.endsWith(".bak"));
  const cleanup = (body: unknown) =>
    app.inject({ method: "POST", url: "/api/packages/cleanup", payload: body as object });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-health-"));
    settingsPath = path.join(dir, "settings.json");
    const liveDir = path.join(dir, "live");
    fs.mkdirSync(liveDir);
    fs.writeFileSync(path.join(liveDir, "package.json"), JSON.stringify({ name: "live", version: "1.0.0" }));
    wrapper = {
      listInstalled: vi.fn().mockResolvedValue([
        { source: "npm:live", scope: "user", filtered: false, installedPath: liveDir },
        { source: "npm:gone", scope: "user", filtered: false },
        { source: "/dead/path", scope: "user", filtered: false },
      ]),
      runExclusive: vi.fn(async (fn: () => Promise<unknown>) => fn()),
      invalidateAllPackageManagers: vi.fn(),
    };
    app = Fastify();
    registerPackageHealthRoutes(app, { packageManagerWrapper: wrapper, settingsPath });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("GET /api/packages/health", () => {
    it("returns classified entries + summary", async () => {
      const res = await app.inject({ method: "GET", url: "/api/packages/health" });
      expect(res.statusCode).toBe(200);
      const { success, data } = JSON.parse(res.body);
      expect(success).toBe(true);
      expect(data.entries.map((e: any) => [e.source, e.status])).toEqual([
        ["npm:live", "ok"],
        ["npm:gone", "stale-npm"],
        ["/dead/path", "missing-path"],
      ]);
      expect(data.summary).toEqual({ ok: 1, staleNpm: 1, missingPath: 1, duplicateGroups: [] });
    });

    it("reports scanner failure as success:false", async () => {
      wrapper.listInstalled.mockRejectedValue(new Error("pi unavailable"));
      const res = await app.inject({ method: "GET", url: "/api/packages/health" });
      expect(JSON.parse(res.body)).toMatchObject({ success: false, error: "pi unavailable" });
    });
  });

  describe("POST /api/packages/cleanup", () => {
    const base = {
      theme: "dark",
      nested: { a: [1, 2, 3] },
      packages: ["npm:a", { source: "npm:b", extensions: ["+x"] }, "/c"],
    };

    it("drops valid sources (string + object entries), preserves other keys, writes backup first", async () => {
      writeSettings(base);
      const before = fs.readFileSync(settingsPath, "utf-8");
      const res = await cleanup({ drop: ["npm:b", "/c"] });
      expect(res.statusCode).toBe(200);
      const { data } = JSON.parse(res.body);
      expect(data).toMatchObject({ before: 3, after: 1, dropped: ["npm:b", "/c"] });
      expect(readSettings()).toEqual({ ...base, packages: ["npm:a"] });
      expect(backups()).toHaveLength(1);
      expect(data.backupPath).toBe(path.join(dir, backups()[0]));
      expect(fs.readFileSync(data.backupPath, "utf-8")).toBe(before);
      expect(wrapper.invalidateAllPackageManagers).toHaveBeenCalledTimes(1);
      expect(wrapper.runExclusive).toHaveBeenCalledTimes(1);
    });

    it("rejects an unknown source with 400 {unknown}, no mutation, no backup", async () => {
      writeSettings(base);
      const before = fs.readFileSync(settingsPath, "utf-8");
      const res = await cleanup({ drop: ["npm:a", "DOES-NOT-EXIST"] });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).unknown).toEqual(["DOES-NOT-EXIST"]);
      expect(fs.readFileSync(settingsPath, "utf-8")).toBe(before);
      expect(backups()).toHaveLength(0);
    });

    it("empty drop is a 200 no-op without backup (idempotent re-apply)", async () => {
      writeSettings(base);
      const before = fs.readFileSync(settingsPath, "utf-8");
      const first = await cleanup({ drop: ["/c"] });
      expect(first.statusCode).toBe(200);
      const res = await cleanup({ drop: [] });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data).toMatchObject({ before: 2, after: 2, dropped: [], backupPath: "" });
      expect(backups()).toHaveLength(1);
      expect(fs.readFileSync(settingsPath, "utf-8")).not.toBe(before);
    });

    it("re-dropping an already-dropped source is rejected as unknown", async () => {
      writeSettings(base);
      await cleanup({ drop: ["/c"] });
      const res = await cleanup({ drop: ["/c"] });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).unknown).toEqual(["/c"]);
    });

    it("duplicate drop entries are de-duplicated", async () => {
      writeSettings(base);
      const res = await cleanup({ drop: ["/c", "/c"] });
      expect(JSON.parse(res.body).data).toMatchObject({ before: 3, after: 2, dropped: ["/c"] });
    });

    it.each([[undefined], [{ drop: "x" }], [{ drop: [1] }], [{}]])("rejects malformed body %j with 400", async (body) => {
      writeSettings(base);
      const res = await cleanup(body ?? {});
      expect(res.statusCode).toBe(400);
      expect(backups()).toHaveLength(0);
    });

    it("refuses to overwrite an unparseable settings.json", async () => {
      fs.writeFileSync(settingsPath, "{ not json");
      const res = await cleanup({ drop: ["/c"] });
      expect(res.statusCode).toBe(500);
      expect(fs.readFileSync(settingsPath, "utf-8")).toBe("{ not json");
      expect(backups()).toHaveLength(0);
    });

    it("missing settings.json: any drop is unknown", async () => {
      const res = await cleanup({ drop: ["/c"] });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 when a package operation is running", async () => {
      writeSettings(base);
      wrapper.runExclusive.mockRejectedValue(new PackageOperationBusyError());
      const res = await cleanup({ drop: ["/c"] });
      expect(res.statusCode).toBe(409);
      expect(readSettings()).toEqual(base);
    });
  });
});
