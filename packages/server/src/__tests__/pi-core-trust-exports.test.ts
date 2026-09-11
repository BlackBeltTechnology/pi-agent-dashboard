/**
 * pi 0.85.1 runtime-symbol reachability for the trust gate (test-plan #X3).
 *
 * The resource-activation WRITE path and the project-trust gate depend on two
 * symbols pi reaches through its package `exports` map: `ProjectTrustStore` and
 * `hasTrustRequiringProjectResources`. A withdrawal from that map breaks the
 * trust gate at RUNTIME, not build time — a green compile proves nothing. This
 * loads the REAL installed pi through `getPiCore()` and proves both resolve and
 * are usable.
 *
 * See change: update-pi-core-0-85-adopt-apis (task 6.5, design §7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPiCore } from "../pi/pi-resource-activation.js";

describe("X3: trust symbols resolve through the 0.85.1 exports map", () => {
	it("ProjectTrustStore is constructible and records/reads a decision", async () => {
		const core = await getPiCore();
		expect(typeof core.ProjectTrustStore).toBe("function");

		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-"));
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-cwd-"));
		try {
			const store = new core.ProjectTrustStore(agentDir);
			expect(store.get(cwd)).toBeNull();
			store.set(cwd, true);
			// A fresh instance reads the persisted decision.
			expect(new core.ProjectTrustStore(agentDir).get(cwd)).toBe(true);
		} finally {
			fs.rmSync(agentDir, { recursive: true, force: true });
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("hasTrustRequiringProjectResources is callable and returns a boolean", async () => {
		const core = await getPiCore();
		expect(typeof core.hasTrustRequiringProjectResources).toBe("function");

		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-req-"));
		const configured = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-req-"));
		try {
			expect(typeof core.hasTrustRequiringProjectResources(empty)).toBe("boolean");
			// A folder holding pi project config IS trust-requiring (writing
			// `.pi/settings.json` is itself what makes it so).
			fs.mkdirSync(path.join(configured, ".pi"), { recursive: true });
			fs.writeFileSync(path.join(configured, ".pi", "settings.json"), "{}");
			expect(core.hasTrustRequiringProjectResources(configured)).toBe(true);
		} finally {
			fs.rmSync(empty, { recursive: true, force: true });
			fs.rmSync(configured, { recursive: true, force: true });
		}
	});
});
