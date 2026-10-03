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
	checkMcpBuiltin,
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

// migrate-mcp-to-pi-builtin test-plan E33: one finding per condition, the file
// path named, read-only.
describe("checkMcpBuiltin (E33)", () => {
	function agent(files: Record<string, unknown>): string {
		const dir = path.join(root, "agent");
		mkdirSync(dir, { recursive: true });
		for (const [name, body] of Object.entries(files)) {
			writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
		}
		return dir;
	}

	it("adapter in packages → adapter-disables-builtin naming settings.json", () => {
		const agentDir = agent({ "settings.json": { packages: ["npm:pi-mcp-adapter@5.0.0", { source: "npm:other" }] } });
		const f = checkMcpBuiltin({ agentDir });
		expect(f.map((x) => x.id)).toEqual(["adapter-disables-builtin"]);
		expect(f[0].path).toBe(path.join(agentDir, "settings.json"));
		expect(f[0].message).toMatch(/disables pi's built-in MCP/i);
	});

	it("an object-form adapter package entry is found too", () => {
		const agentDir = agent({ "settings.json": { packages: [{ source: "npm:pi-mcp-adapter", extensions: [] }] } });
		expect(checkMcpBuiltin({ agentDir }).map((x) => x.id)).toEqual(["adapter-disables-builtin"]);
	});

	it("operator pi-dashboard entry → operator-entry-shadows-registration; the provisioned shape is not reported", () => {
		const operator = agent({ "mcp.json": { mcpServers: { "pi-dashboard": { url: "http://127.0.0.1:8000/mcp" } } } });
		const f = checkMcpBuiltin({ agentDir: operator });
		expect(f.map((x) => x.id)).toEqual(["operator-entry-shadows-registration"]);
		expect(f[0].path).toBe(path.join(operator, "mcp.json"));

		rmSync(operator, { recursive: true, force: true });
		const provisioned = agent({
			"mcp.json": {
				mcpServers: { "pi-dashboard": { url: "u", requestHeadersCommand: { command: "node", args: ["/x/header-command.mjs"] } } },
			},
		});
		expect(checkMcpBuiltin({ agentDir: provisioned })).toEqual([]);
	});

	it("an mcp.json with a comment → mcp-json-not-strict naming the file (global and project)", () => {
		const agentDir = agent({ "mcp.json": '{\n  // c\n  "mcpServers": {}\n}' });
		const cwd = path.join(root, "proj");
		mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		writeFileSync(path.join(cwd, ".pi", "mcp.json"), '{ "mcpServers": {}, }');
		const f = checkMcpBuiltin({ agentDir, cwd });
		expect(f.map((x) => x.id)).toEqual(["mcp-json-not-strict", "mcp-json-not-strict"]);
		expect(f[0].path).toBe(path.join(agentDir, "mcp.json"));
		expect(f[1].path).toBe(path.join(cwd, ".pi", "mcp.json"));
		expect(f[0].message).toContain(path.join(agentDir, "mcp.json"));
	});

	it("a clean agent dir reports nothing", () => {
		const agentDir = agent({ "settings.json": { packages: ["npm:pi-flows"] }, "mcp.json": { mcpServers: { docs: { url: "https://d" } } } });
		expect(checkMcpBuiltin({ agentDir })).toEqual([]);
	});
});
