import { describe, it, expect, vi, beforeEach } from "vitest";
import { PiCoreUpdater } from "../pi/pi-core-updater.js";
import {
	PackageManagerWrapper,
	PackageOperationBusyError,
} from "../package/package-manager-wrapper.js";
import type { PiCorePackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

// Pi PM is mocked in other tests via vi.mock; we don't need it here because
// we never call the install/remove/update methods — only runExclusive().
vi.mock("@earendil-works/pi-coding-agent", () => ({
	DefaultPackageManager: function () {
		return {};
	},
	SettingsManager: { create: () => ({}) },
}));

function pkg(name: string, source: "global" | "managed" = "global"): PiCorePackage {
	return {
		name,
		displayName: name,
		currentVersion: "0.1.0",
		latestVersion: "0.2.0",
		updateAvailable: true,
		installSource: source,
	};
}

describe("PiCoreUpdater", () => {
	let wrapper: PackageManagerWrapper;

	beforeEach(() => {
		wrapper = new PackageManagerWrapper();
	});

	it("updates packages sequentially and emits start/output/complete events", async () => {
		const events: Array<{ name: string; phase: string; message?: string }> = [];
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async (p, onOutput) => {
				onOutput("added 1 package");
			},
		});
		updater.setProgressListener((e) => events.push(e));

		const out = await updater.update([pkg("pi-foo"), pkg("pi-bar")]);

		expect(out.results).toEqual([
			{ name: "pi-foo", success: true },
			{ name: "pi-bar", success: true },
		]);
		// Per-package: start, output, complete
		const phases = events.map((e) => `${e.name}:${e.phase}`);
		expect(phases).toEqual([
			"pi-foo:start",
			"pi-foo:output",
			"pi-foo:complete",
			"pi-bar:start",
			"pi-bar:output",
			"pi-bar:complete",
		]);
	});

	it("continues after a failure and reports per-package errors", async () => {
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async (p) => {
				if (p.name === "pi-bad") throw new Error("npm update exited with code 1");
			},
		});
		const events: Array<{ phase: string }> = [];
		updater.setProgressListener((e) => events.push({ phase: e.phase }));

		const out = await updater.update([pkg("pi-bad"), pkg("pi-good")]);

		expect(out.results).toEqual([
			{ name: "pi-bad", success: false, error: "npm update exited with code 1" },
			{ name: "pi-good", success: true },
		]);
		// First package emits start + error; second emits start + complete
		expect(events.map((e) => e.phase)).toEqual(["start", "error", "start", "complete"]);
	});

	it("invokes onAllComplete only when at least one package succeeded", async () => {
		const onAllComplete = vi.fn().mockResolvedValue(3);
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				/* success */
			},
			onAllComplete,
		});

		const out = await updater.update([pkg("pi-foo")]);
		expect(out.sessionsReloaded).toBe(3);
		expect(onAllComplete).toHaveBeenCalledTimes(1);
	});

	it("skips onAllComplete when all packages fail", async () => {
		const onAllComplete = vi.fn().mockResolvedValue(99);
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				throw new Error("boom");
			},
			onAllComplete,
		});

		const out = await updater.update([pkg("pi-foo"), pkg("pi-bar")]);
		expect(out.sessionsReloaded).toBe(0);
		expect(onAllComplete).not.toHaveBeenCalled();
		expect(out.results.every((r) => !r.success)).toBe(true);
	});

	it("returns 0 sessionsReloaded and does not throw when onAllComplete rejects", async () => {
		const onAllComplete = vi.fn().mockRejectedValue(new Error("reload failed"));
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				/* success */
			},
			onAllComplete,
		});

		const out = await updater.update([pkg("pi-foo")]);
		expect(out.results[0].success).toBe(true);
		expect(out.sessionsReloaded).toBe(0);
	});

	it("acquires the shared busy-lock and throws when wrapper is already busy", async () => {
		// Start a long-running runExclusive on the wrapper to simulate an
		// extension operation in flight.
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		const locked = wrapper.runExclusive(() => held);

		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				/* no-op */
			},
		});

		await expect(updater.update([pkg("pi-foo")])).rejects.toBeInstanceOf(
			PackageOperationBusyError,
		);

		// Release the held lock and confirm a subsequent update succeeds.
		release();
		await locked;

		const out = await updater.update([pkg("pi-foo")]);
		expect(out.results[0].success).toBe(true);
	});

	it("releases the busy-lock after update completes (success path)", async () => {
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				/* success */
			},
		});
		await updater.update([pkg("pi-foo")]);
		expect(wrapper.isBusy()).toBe(false);
		// Second call should be immediately permitted.
		const out = await updater.update([pkg("pi-bar")]);
		expect(out.results[0].success).toBe(true);
	});

	it("releases the busy-lock even when every package fails", async () => {
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				throw new Error("nope");
			},
		});
		await updater.update([pkg("pi-foo")]);
		expect(wrapper.isBusy()).toBe(false);
	});

	it("passes install-source-aware args & cwd to runNpmUpdate", async () => {
		const seen: Array<{ name: string; source: "global" | "managed" }> = [];
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async (p) => {
				seen.push({ name: p.name, source: p.installSource });
			},
		});
		await updater.update([pkg("pi-foo", "global"), pkg("pi-bar", "managed")]);
		expect(seen).toEqual([
			{ name: "pi-foo", source: "global" },
			{ name: "pi-bar", source: "managed" },
		]);
	});

	it("swallows progress-listener exceptions without failing the update", async () => {
		const updater = new PiCoreUpdater({
			packageManagerWrapper: wrapper,
			runNpmUpdate: async () => {
				/* success */
			},
		});
		updater.setProgressListener(() => {
			throw new Error("listener explosion");
		});
		// Silence the console.error emitted by the safe-emit guard
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const out = await updater.update([pkg("pi-foo")]);
		expect(out.results[0].success).toBe(true);
		err.mockRestore();
	});
});
