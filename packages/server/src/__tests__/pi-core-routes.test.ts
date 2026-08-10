import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPiCoreRoutes } from "../routes/pi-core-routes.js";
import { PackageOperationBusyError } from "../package/package-manager-wrapper.js";
import type { PiCoreStatus, PiCorePackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

function makePkg(name: string, updateAvailable = false): PiCorePackage {
	return {
		name,
		displayName: name,
		currentVersion: "0.1.0",
		latestVersion: updateAvailable ? "0.2.0" : "0.1.0",
		updateAvailable,
		installSource: "global",
	};
}

describe("pi-core-routes", () => {
	let app: FastifyInstance;
	let checker: any;
	let updater: any;
	let onUpdateComplete: any;

	beforeEach(async () => {
		checker = {
			getStatus: vi.fn<(refresh?: boolean) => Promise<PiCoreStatus>>(),
			invalidate: vi.fn(),
		};
		updater = {
			update: vi.fn(),
		};
		onUpdateComplete = vi.fn();
		app = Fastify({ logger: false });
		registerPiCoreRoutes(app, {
			piCoreChecker: checker,
			piCoreUpdater: updater,
			onUpdateComplete,
		});
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it("GET /api/pi-core/versions returns cached status", async () => {
		const status: PiCoreStatus = {
			packages: [makePkg("pi-web-access")],
			updatesAvailable: 0,
			lastChecked: new Date().toISOString(),
		};
		checker.getStatus.mockResolvedValue(status);

		const res = await app.inject({ method: "GET", url: "/api/pi-core/versions" });
		expect(res.statusCode).toBe(200);
		const body = res.json() as any;
		expect(body.success).toBe(true);
		expect(body.data).toEqual(status);
		expect(checker.getStatus).toHaveBeenCalledWith(false);
	});

	it("GET /api/pi-core/versions?refresh=true forces refresh", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [],
			updatesAvailable: 0,
			lastChecked: new Date().toISOString(),
		});
		const res = await app.inject({ method: "GET", url: "/api/pi-core/versions?refresh=true" });
		expect(res.statusCode).toBe(200);
		expect(checker.getStatus).toHaveBeenCalledWith(true);
	});

	it("POST /api/pi-core/update with empty body updates all packages with updateAvailable", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [makePkg("pi-web-access", true), makePkg("pi-foo", false)],
			updatesAvailable: 1,
			lastChecked: new Date().toISOString(),
		});
		updater.update.mockResolvedValue({
			results: [{ name: "pi-web-access", success: true }],
			sessionsReloaded: 2,
		});

		const res = await app.inject({ method: "POST", url: "/api/pi-core/update", payload: {} });
		expect(res.statusCode).toBe(200);
		const body = res.json() as any;
		expect(body.success).toBe(true);
		expect(body.data.results).toHaveLength(1);
		expect(body.data.sessionsReloaded).toBe(2);

		// Only updates the one with updateAvailable
		expect(updater.update).toHaveBeenCalledTimes(1);
		const arg = updater.update.mock.calls[0][0];
		expect(arg).toHaveLength(1);
		expect(arg[0].name).toBe("pi-web-access");

		// Cache invalidated so next status reflects new versions
		expect(checker.invalidate).toHaveBeenCalled();

		// onUpdateComplete called so server can broadcast to browsers (badge refetch)
		expect(onUpdateComplete).toHaveBeenCalledTimes(1);
		expect(onUpdateComplete).toHaveBeenCalledWith({
			results: [{ name: "pi-web-access", success: true }],
			sessionsReloaded: 2,
		});
	});

	it("POST /api/pi-core/update does not call onUpdateComplete on busy-error", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [makePkg("pi-web-access", true)],
			updatesAvailable: 1,
			lastChecked: new Date().toISOString(),
		});
		updater.update.mockRejectedValue(new PackageOperationBusyError());

		const res = await app.inject({ method: "POST", url: "/api/pi-core/update", payload: {} });
		expect(res.statusCode).toBe(409);
		expect(onUpdateComplete).not.toHaveBeenCalled();
	});

	it("POST /api/pi-core/update with specific packages filters to those", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [makePkg("pi-web-access", true), makePkg("pi-foo", true)],
			updatesAvailable: 2,
			lastChecked: new Date().toISOString(),
		});
		updater.update.mockResolvedValue({ results: [{ name: "pi-foo", success: true }], sessionsReloaded: 0 });

		const res = await app.inject({
			method: "POST",
			url: "/api/pi-core/update",
			payload: { packages: ["pi-foo"] },
		});
		expect(res.statusCode).toBe(200);
		expect(updater.update.mock.calls[0][0].map((p: PiCorePackage) => p.name)).toEqual(["pi-foo"]);
	});

	it("POST /api/pi-core/update rejects unknown packages with 400", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [makePkg("pi-web-access", true)],
			updatesAvailable: 1,
			lastChecked: new Date().toISOString(),
		});

		const res = await app.inject({
			method: "POST",
			url: "/api/pi-core/update",
			payload: { packages: ["not-a-real-package"] },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json() as any;
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/not-a-real-package/);
	});

	it("POST /api/pi-core/update returns 409 when busy", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [makePkg("pi-web-access", true)],
			updatesAvailable: 1,
			lastChecked: new Date().toISOString(),
		});
		updater.update.mockRejectedValue(new PackageOperationBusyError());

		const res = await app.inject({ method: "POST", url: "/api/pi-core/update", payload: {} });
		expect(res.statusCode).toBe(409);
		const body = res.json() as any;
		expect(body.success).toBe(false);
	});

	it("POST /api/pi-core/update returns empty result when nothing to update", async () => {
		checker.getStatus.mockResolvedValue({
			packages: [makePkg("pi-web-access", false)],
			updatesAvailable: 0,
			lastChecked: new Date().toISOString(),
		});

		const res = await app.inject({ method: "POST", url: "/api/pi-core/update", payload: {} });
		expect(res.statusCode).toBe(200);
		const body = res.json() as any;
		expect(body.data.results).toEqual([]);
		expect(body.data.sessionsReloaded).toBe(0);
		expect(updater.update).not.toHaveBeenCalled();
	});
});
