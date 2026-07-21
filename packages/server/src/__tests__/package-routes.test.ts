/**
 * Tests for package management REST routes.
 */

import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlreadyAtDestinationError,
  InvalidMoveRequestError,
  InvalidResetRequestError,
  PackageOperationBusyError,
  UnsupportedSourceForDestinationError,
} from "../package/package-manager-wrapper.js";
import { registerPackageRoutes } from "../routes/package-routes.js";

// Mock pi dependency (pulled transitively by package-manager-wrapper)
vi.mock("@earendil-works/pi-coding-agent", () => ({
  DefaultPackageManager: function() { return {}; },
  SettingsManager: { create: () => ({}) },
}));

// Mock npm-search-proxy
vi.mock("../package/npm-search-proxy.js", () => ({
  searchPackages: vi.fn().mockResolvedValue({ packages: [{ name: "pi-doom", types: ["extension"] }], total: 1 }),
  fetchReadme: vi.fn().mockResolvedValue({ readme: "# Test", name: "pi-doom", version: "1.0.0" }),
  fetchPackageMeta: vi.fn().mockResolvedValue({ version: "0.5.0" }),
  PackageNotFoundError: class PackageNotFoundError extends Error {
    constructor(name: string) { super(`Package not found: ${name}`); this.name = "PackageNotFoundError"; }
  },
}));

import { fetchReadme, PackageNotFoundError, searchPackages } from "../package/npm-search-proxy.js";

function createMockWrapper() {
  return {
    run: vi.fn().mockResolvedValue("op-123"),
    move: vi.fn().mockResolvedValue("move-456"),
    reset: vi.fn().mockResolvedValue("reset-789"),
    listInstalled: vi.fn().mockReturnValue([{ source: "npm:pi-doom", scope: "user", filtered: false }]),
    checkUpdates: vi.fn().mockResolvedValue([]),
    isBusy: vi.fn().mockReturnValue(false),
    setProgressListener: vi.fn(),
    setCompleteListener: vi.fn(),
    setReloadSessions: vi.fn(),
  } as any;
}

describe("package-routes", () => {
  let app: FastifyInstance;
  let wrapper: ReturnType<typeof createMockWrapper>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createMockWrapper();
    app = Fastify();
    registerPackageRoutes(app, { packageManagerWrapper: wrapper });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/packages/search", () => {
    it("returns search results", async () => {
      const res = await app.inject({ method: "GET", url: "/api/packages/search?q=doom" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.packages[0].name).toBe("pi-doom");
    });

    it("passes type filter", async () => {
      await app.inject({ method: "GET", url: "/api/packages/search?type=extension" });
      expect(searchPackages).toHaveBeenCalledWith({ query: undefined, type: "extension" });
    });
  });

  describe("GET /api/packages/readme", () => {
    it("returns readme", async () => {
      const res = await app.inject({ method: "GET", url: "/api/packages/readme?pkg=pi-doom" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.readme).toBe("# Test");
    });

    it("returns 400 without pkg param", async () => {
      const res = await app.inject({ method: "GET", url: "/api/packages/readme" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for missing package", async () => {
      vi.mocked(fetchReadme).mockRejectedValueOnce(new PackageNotFoundError("x"));
      const res = await app.inject({ method: "GET", url: "/api/packages/readme?pkg=x" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/packages/installed", () => {
    it("returns installed packages with enrichment fields", async () => {
      const res = await app.inject({ method: "GET", url: "/api/packages/installed?scope=global" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const row = body.data[0];
      expect(row.source).toBe("npm:pi-doom");
      // Enrichment fields are present on every row.
      expect(row).toHaveProperty("displayName");
      expect(row).toHaveProperty("isRecommended");
      expect(row).toHaveProperty("isBundled");
      // pi-doom is not in RECOMMENDED_EXTENSIONS — falls back to basename.
      expect(row.displayName).toBe("pi-doom");
      expect(row.isRecommended).toBe(false);
      expect(row.isBundled).toBe(false);
    });

    it("matches a row to RECOMMENDED_EXTENSIONS by source", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        {
          source: "npm:@blackbelt-technology/pi-dashboard-subagents",
          scope: "user",
          filtered: false,
        },
      ]);
      const res = await app.inject({ method: "GET", url: "/api/packages/installed?scope=global" });
      const body = JSON.parse(res.body);
      const row = body.data[0];
      expect(row.isRecommended).toBe(true);
      // displayName comes from the recommended manifest.
      expect(row.displayName).toBe("pi-dashboard-subagents");
    });

    it("missing installedPath does not break enrichment", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        { source: "npm:weirdpkg", scope: "user", filtered: false },
      ]);
      const res = await app.inject({ method: "GET", url: "/api/packages/installed?scope=global" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data[0].version).toBeUndefined();
      expect(body.data[0].displayName).toBe("weirdpkg");
    });
  });

  describe("POST /api/packages/install", () => {
    it("returns 202 with operationId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/install",
        payload: { source: "npm:test", scope: "global" },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.data.operationId).toBe("op-123");
    });

    it("returns 400 without source", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/install",
        payload: { scope: "global" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 when busy", async () => {
      wrapper.run.mockRejectedValueOnce(new PackageOperationBusyError());
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/install",
        payload: { source: "npm:test", scope: "global" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("POST /api/packages/remove", () => {
    it("returns 202", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/remove",
        payload: { source: "npm:test", scope: "local", cwd: "/tmp" },
      });
      expect(res.statusCode).toBe(202);
      expect(wrapper.run).toHaveBeenCalledWith({
        action: "remove",
        source: "npm:test",
        scope: "local",
        cwd: "/tmp",
      });
    });
  });

  describe("POST /api/packages/update", () => {
    it("returns 202", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/update",
        payload: { scope: "global" },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("POST /api/packages/check-updates", () => {
    it("returns updates list", async () => {
      wrapper.checkUpdates.mockResolvedValueOnce([{ source: "npm:pi-doom", displayName: "pi-doom", type: "npm" }]);
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/check-updates",
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data[0].source).toBe("npm:pi-doom");
    });
  });

  describe("POST /api/packages/reset-to-npm", () => {
    it("returns 202 with resetId + publishedSource for a recommended override row", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        { source: "/home/dev/pi-web-access", scope: "user", filtered: false },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/reset-to-npm",
        payload: { source: "/home/dev/pi-web-access", scope: "global" },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.resetId).toBe("reset-789");
      expect(body.data.publishedSource).toBe("npm:pi-web-access");
      expect(body.data.phases).toEqual(["install", "remove"]);
      expect(wrapper.reset).toHaveBeenCalledWith({
        source: "/home/dev/pi-web-access",
        publishedSource: "npm:pi-web-access",
        scope: "global",
        cwd: undefined,
      });
    });

    it("returns 400 without source", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/reset-to-npm",
        payload: { scope: "global" },
      });
      expect(res.statusCode).toBe(400);
      expect(wrapper.reset).not.toHaveBeenCalled();
    });

    it("returns 400 when source is not installed", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        { source: "npm:pi-doom", scope: "user", filtered: false },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/reset-to-npm",
        payload: { source: "/home/dev/not-there", scope: "global" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/not installed/);
      expect(wrapper.reset).not.toHaveBeenCalled();
    });

    it("returns 400 when the row has no resolvable published variant (plain npm)", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        { source: "npm:pi-doom", scope: "user", filtered: false },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/reset-to-npm",
        payload: { source: "npm:pi-doom", scope: "global" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/no published variant/);
      expect(wrapper.reset).not.toHaveBeenCalled();
    });

    it("returns 409 operation_in_flight when a package op is already running", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        { source: "/home/dev/pi-web-access", scope: "user", filtered: false },
      ]);
      wrapper.reset.mockRejectedValueOnce(new PackageOperationBusyError());
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/reset-to-npm",
        payload: { source: "/home/dev/pi-web-access", scope: "global" },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).code).toBe("operation_in_flight");
    });

    it("returns 400 invalid_request from InvalidResetRequestError", async () => {
      wrapper.listInstalled.mockReturnValueOnce([
        { source: "/home/dev/pi-web-access", scope: "user", filtered: false },
      ]);
      wrapper.reset.mockRejectedValueOnce(new InvalidResetRequestError("cwd required"));
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/reset-to-npm",
        payload: { source: "/home/dev/pi-web-access", scope: "local" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).code).toBe("invalid_request");
    });
  });

  describe("POST /api/packages/move", () => {
    it("returns 202 with moveId + phases for npm source", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: "npm:pi-doom", fromScope: "global", toScope: "local", toCwd: "/proj" },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.moveId).toBe("move-456");
      expect(body.data.phases).toEqual(["install", "remove"]);
      expect(wrapper.move).toHaveBeenCalledWith({
        entry: "npm:pi-doom",
        fromScope: "global",
        fromCwd: undefined,
        toScope: "local",
        toCwd: "/proj",
      });
    });

    it("returns settings-edit phase for relative-path source", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: { source: "./vendor/x" }, fromScope: "local", fromCwd: "/proj", toScope: "global" },
      });
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body).data.phases).toEqual(["settings-edit"]);
    });

    it("returns 400 when entry is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { fromScope: "global", toScope: "local", toCwd: "/proj" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/entry is required/);
    });

    it("returns 400 when fromScope/toScope missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: "npm:foo" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 invalid_request from InvalidMoveRequestError", async () => {
      wrapper.move = vi.fn().mockRejectedValue(new InvalidMoveRequestError("same scope"));
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: "npm:foo", fromScope: "global", toScope: "global" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).code).toBe("invalid_request");
    });

    it("returns 400 unsupported_source_for_destination", async () => {
      wrapper.move = vi.fn().mockRejectedValue(new UnsupportedSourceForDestinationError("need fromCwd"));
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: "..", fromScope: "local", toScope: "global" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).code).toBe("unsupported_source_for_destination");
    });

    it("returns 409 already_at_destination", async () => {
      wrapper.move = vi.fn().mockRejectedValue(new AlreadyAtDestinationError("npm:foo", "global"));
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: "npm:foo", fromScope: "local", fromCwd: "/p", toScope: "global" },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).code).toBe("already_at_destination");
    });

    it("returns 409 operation_in_flight", async () => {
      wrapper.move = vi.fn().mockRejectedValue(new PackageOperationBusyError());
      const res = await app.inject({
        method: "POST",
        url: "/api/packages/move",
        payload: { entry: "npm:foo", fromScope: "global", toScope: "local", toCwd: "/p" },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).code).toBe("operation_in_flight");
    });
  });
});
