/**
 * Pi-install enumeration, divergence and floor reading — moved verbatim from
 * `packages/extension/src/__tests__/doctor/checks.test.ts` when the helpers
 * were promoted into `shared/pi-installs/`. Behaviour-preserving move: the
 * enumerate/divergence/floor cases are unchanged, the floor-resolution cases
 * are new (design D11's single reader).
 *
 * See change: select-pi-runtime-install (task 1.3, 1.5).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	enumeratePiInstalls,
	PI_COMPATIBILITY_FALLBACK,
	piVersionDivergence,
	readPiCompatibilityRange,
	readPiFloor,
	resolvePiFloor,
} from "../index.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "pi-installs-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function writePkg(dir: string, name: string, version: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name, version, main: "index.js" }),
	);
	writeFileSync(path.join(dir, "index.js"), "module.exports = {};");
}

describe("enumeratePiInstalls + divergence", () => {
	it("reads each install version and flags divergence", () => {
		const a = path.join(root, "cli");
		const b = path.join(root, "repo");
		writePkg(a, "@earendil-works/pi-coding-agent", "0.80.3");
		writePkg(b, "@earendil-works/pi-coding-agent", "0.80.2");
		const installs = enumeratePiInstalls({
			cli: a,
			repo: b,
			missing: path.join(root, "nope"),
		});
		expect(installs.find((i) => i.location === "cli")?.version).toBe("0.80.3");
		expect(installs.find((i) => i.location === "missing")?.version).toBeNull();
		const div = piVersionDivergence(installs);
		expect(div.diverged).toBe(true);
		expect(div.versions.sort()).toEqual(["0.80.2", "0.80.3"]);
	});

	it("no divergence when all versions match", () => {
		const a = path.join(root, "a");
		const b = path.join(root, "b");
		writePkg(a, "pi", "0.80.3");
		writePkg(b, "pi", "0.80.3");
		expect(piVersionDivergence(enumeratePiInstalls({ a, b })).diverged).toBe(
			false,
		);
	});
});

describe("readPiFloor", () => {
	it("reads piCompatibility.minimum from a server package.json", () => {
		const p = path.join(root, "package.json");
		writeFileSync(
			p,
			JSON.stringify({ piCompatibility: { minimum: "0.78.0" } }),
		);
		expect(readPiFloor(p)).toBe("0.78.0");
	});
	it("returns null when absent", () => {
		const p = path.join(root, "package.json");
		writeFileSync(p, JSON.stringify({}));
		expect(readPiFloor(p)).toBeNull();
	});
});

describe("single floor reader (D11)", () => {
	it("resolvePiFloor falls back to the declared fallback when the file is missing", () => {
		const missing = path.join(root, "nope", "package.json");
		expect(readPiFloor(missing)).toBeNull();
		expect(resolvePiFloor(missing)).toBe(PI_COMPATIBILITY_FALLBACK.minimum);
	});

	it("resolvePiFloor and readPiCompatibilityRange agree on the present case", () => {
		const p = path.join(root, "package.json");
		writeFileSync(
			p,
			JSON.stringify({
				piCompatibility: { minimum: "0.78.0", recommended: "0.84.1" },
			}),
		);
		expect(resolvePiFloor(p)).toBe("0.78.0");
		expect(readPiCompatibilityRange(p)).toEqual({
			minimum: "0.78.0",
			recommended: "0.84.1",
			maximum: null,
		});
	});

	it("readPiCompatibilityRange returns null on a malformed file", () => {
		const p = path.join(root, "package.json");
		writeFileSync(p, "{ not json");
		expect(readPiCompatibilityRange(p)).toBeNull();
	});
});
