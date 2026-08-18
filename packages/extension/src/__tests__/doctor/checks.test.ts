/**
 * Doctor `_lib/checks` tests: tier-1/tier-2 peer probing and name-skew
 * detection — all against hermetic tmp fixtures (no network, no global state).
 *
 * Pi-install enumeration, divergence and floor reading moved with the helpers
 * to `packages/shared/src/pi-installs/__tests__/installs.test.ts`
 * (change: select-pi-runtime-install).
 *
 * See change: add-modular-doctor-skill (tasks 2.1, 3.2, 3.3, 7.1).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectNameSkew,
	probePeer,
} from "../../../.pi/skills/doctor/_lib/checks.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "doctor-checks-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Write a resolvable package under `<agentDir>` scope via settings packages[]. */
function writePkg(dir: string, name: string, version: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, main: "index.js" }));
	writeFileSync(path.join(dir, "index.js"), "module.exports = {};");
}

describe("probePeer", () => {
	it("resolves via tier-1 (createRequire at cwd) when a node_modules ancestor has it", () => {
		const cwd = path.join(root, "proj");
		writePkg(path.join(cwd, "node_modules", "pi-flows"), "pi-flows", "1.0.0");
		const res = probePeer("pi-flows", { cwd });
		expect(res.present).toBe(true);
		expect(res.tier).toBe("tier-1");
	});

	it("resolves via tier-2 (pi packages[]) when tier-1 misses", () => {
		const agentDir = path.join(root, "agent");
		const pkgDir = path.join(root, "installed", "peer");
		writePkg(pkgDir, "@scope/peer", "2.0.0");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			path.join(agentDir, "settings.json"),
			JSON.stringify({ packages: [pkgDir] }),
		);
		// cwd with no node_modules → tier-1 misses.
		const cwd = path.join(root, "empty");
		mkdirSync(cwd, { recursive: true });
		const res = probePeer("@scope/peer", { cwd, agentDir });
		expect(res.present).toBe(true);
		expect(res.tier).toBe("tier-2");
	});

	it("reports absent when neither tier resolves", () => {
		const res = probePeer("nonexistent-peer", { cwd: root, agentDir: root });
		expect(res.present).toBe(false);
		expect(res.tier).toBeNull();
	});
});

describe("detectNameSkew", () => {
	it("reports the live name and the dead alias probed before it", () => {
		const agentDir = path.join(root, "agent");
		const pkgDir = path.join(root, "installed", "am");
		writePkg(pkgDir, "@blackbelt-technology/pi-anthropic-messages", "0.3.4");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [pkgDir] }));
		const cwd = path.join(root, "empty");
		mkdirSync(cwd, { recursive: true });
		const res = detectNameSkew(
			["@pi/anthropic-messages", "@blackbelt-technology/pi-anthropic-messages"],
			{ cwd, agentDir },
		);
		expect(res.resolvedName).toBe("@blackbelt-technology/pi-anthropic-messages");
		expect(res.staleNames).toEqual(["@pi/anthropic-messages"]);
		expect(res.tier).toBe("tier-2");
	});
});
