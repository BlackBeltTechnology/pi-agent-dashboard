import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveTracker } from "../nav/move-tracker.js";

function dispatchPackageEvent(detail: any) {
	window.dispatchEvent(new CustomEvent("pi-package-event", { detail }));
}

beforeEach(() => {
	moveTracker.__resetForTests();
	vi.useRealTimers();
});

describe("moveTracker", () => {
	it("register() creates a running entry retrievable by moveId and source", () => {
		moveTracker.register({
			moveId: "m1",
			source: "npm:pi-flows",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		const byId = moveTracker.get("m1");
		expect(byId?.phase).toBe("running");
		expect(byId?.message).toBe("Moving\u2026");
		expect(moveTracker.getBySource("npm:pi-flows")?.moveId).toBe("m1");
	});

	it("ignores complete events without moveId", () => {
		moveTracker.register({
			moveId: "m1",
			source: "npm:pi-flows",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		dispatchPackageEvent({
			type: "package_operation_complete",
			operationId: "op1",
			source: "npm:pi-flows",
			success: true,
			// no moveId
		});
		expect(moveTracker.get("m1")?.phase).toBe("running");
	});

	it("complete success transitions to success phase + auto-clears", () => {
		vi.useFakeTimers();
		moveTracker.register({
			moveId: "m2",
			source: "npm:pi-flows",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		dispatchPackageEvent({
			type: "package_operation_complete",
			operationId: "op1",
			moveId: "m2",
			source: "npm:pi-flows",
			success: true,
		});
		expect(moveTracker.get("m2")?.phase).toBe("success");
		vi.advanceTimersByTime(3000);
		expect(moveTracker.get("m2")).toBeUndefined();
	});

	it("complete failure transitions to error phase, no auto-clear", () => {
		vi.useFakeTimers();
		moveTracker.register({
			moveId: "m3",
			source: "npm:bad",
			fromScope: "local",
			fromCwd: "/proj",
			toScope: "global",
		});
		dispatchPackageEvent({
			type: "package_operation_complete",
			operationId: "op1",
			moveId: "m3",
			source: "npm:bad",
			success: false,
			error: "boom",
		});
		const state = moveTracker.get("m3");
		expect(state?.phase).toBe("error");
		expect(state?.message).toBe("boom");
		vi.advanceTimersByTime(10_000);
		expect(moveTracker.get("m3")?.phase).toBe("error");
	});

	it("partialSuccess (install OK, remove failed) transitions to partial-success and stays sticky", () => {
		vi.useFakeTimers();
		moveTracker.register({
			moveId: "m4",
			source: "npm:pi-flows",
			fromScope: "local",
			fromCwd: "/proj",
			toScope: "global",
		});
		dispatchPackageEvent({
			type: "package_operation_complete",
			operationId: "op1",
			moveId: "m4",
			source: "npm:pi-flows",
			success: true,
			partialSuccess: { installed: true, removed: false, removeError: "EBUSY" },
		});
		const state = moveTracker.get("m4");
		expect(state?.phase).toBe("partial-success");
		expect(state?.partialSuccess?.removed).toBe(false);
		expect(state?.message).toBe("EBUSY");
		vi.advanceTimersByTime(10_000);
		expect(moveTracker.get("m4")?.phase).toBe("partial-success");
	});

	it("clear() removes a tracked move (used for partial-success dismiss)", () => {
		moveTracker.register({
			moveId: "m5",
			source: "npm:x",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		moveTracker.clear("m5");
		expect(moveTracker.get("m5")).toBeUndefined();
	});

	// ── reset-to-npm reuses the move-tracker (kind: "reset") ────────────────
	// See change: reset-override-to-npm.

	it("reset register() shows reset-specific running copy", () => {
		moveTracker.register({
			moveId: "r1",
			source: "/home/dev/pi-web-access",
			fromScope: "global",
			toScope: "global",
			kind: "reset",
		});
		expect(moveTracker.get("r1")?.message).toBe("Resetting\u2026");
	});

	it("reset complete success shows reset-specific copy + auto-clears", () => {
		vi.useFakeTimers();
		moveTracker.register({
			moveId: "r2",
			source: "/home/dev/pi-web-access",
			fromScope: "global",
			toScope: "global",
			kind: "reset",
		});
		dispatchPackageEvent({
			type: "package_operation_complete",
			operationId: "op1",
			moveId: "r2",
			action: "reset",
			source: "/home/dev/pi-web-access",
			success: true,
		});
		const state = moveTracker.get("r2");
		expect(state?.phase).toBe("success");
		expect(state?.message).toBe("Reset complete");
		vi.advanceTimersByTime(3000);
		expect(moveTracker.get("r2")).toBeUndefined();
	});

	it("reset partial-success (install OK, local remove failed) stays sticky", () => {
		vi.useFakeTimers();
		moveTracker.register({
			moveId: "r3",
			source: "/home/dev/pi-web-access",
			fromScope: "global",
			toScope: "global",
			kind: "reset",
		});
		dispatchPackageEvent({
			type: "package_operation_complete",
			operationId: "op1",
			moveId: "r3",
			action: "reset",
			source: "/home/dev/pi-web-access",
			success: true,
			partialSuccess: { installed: true, removed: false, removeError: "EPERM" },
		});
		const state = moveTracker.get("r3");
		expect(state?.phase).toBe("partial-success");
		expect(state?.kind).toBe("reset");
		expect(state?.message).toBe("EPERM");
		vi.advanceTimersByTime(10_000);
		expect(moveTracker.get("r3")?.phase).toBe("partial-success");
	});

	it("subscribe() notifies on every state change", () => {
		const cb = vi.fn();
		const unsub = moveTracker.subscribe(cb);
		moveTracker.register({
			moveId: "m6",
			source: "npm:y",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		expect(cb).toHaveBeenCalled();
		unsub();
	});
});
