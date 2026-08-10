/**
 * Tests for `buildSpawnEnv` after change `embed-managed-node-runtime`:
 * pi-session spawn env SHALL contain the managed Node directory at the
 * head of `PATH` whenever `<managedDir>/node/...` is present.
 *
 * We create / remove the managed Node binary on disk under a tmp HOME
 * to flip the present/absent branches without mocking deep modules.
 *
 * See change: embed-managed-node-runtime (task 5.4).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

const isWin = process.platform === "win32";

describe("buildSpawnEnv: managed Node prepend", () => {
	let tmpHome: string;
	let origHome: string | undefined;
	let origUserProfile: string | undefined;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-managed-node-"));
		origHome = process.env.HOME;
		origUserProfile = process.env.USERPROFILE;
		process.env.HOME = tmpHome;
		// os.homedir() reads USERPROFILE on Win, HOME on POSIX.
		if (isWin) process.env.USERPROFILE = tmpHome;
	});

	afterEach(() => {
		if (origHome === undefined) delete process.env.HOME;
		else process.env.HOME = origHome;
		if (origUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = origUserProfile;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	function installFakeManagedNode(): string {
		const binDir = isWin
			? path.join(tmpHome, ".pi-dashboard", "node")
			: path.join(tmpHome, ".pi-dashboard", "node", "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, isWin ? "node.exe" : "node"), "fake");
		return binDir;
	}

	it("PATH does NOT contain managed Node dir when binary is absent", () => {
		const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" });
		const expectedDir = isWin
			? path.join(tmpHome, ".pi-dashboard", "node")
			: path.join(tmpHome, ".pi-dashboard", "node", "bin");
		expect((env.PATH ?? "").split(path.delimiter)).not.toContain(expectedDir);
	});

	it("PATH HAS managed Node dir at head when binary present", () => {
		const dir = installFakeManagedNode();
		const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" });
		const parts = (env.PATH ?? "").split(path.delimiter);
		expect(parts[0]).toBe(dir);
	});

	it("does not mutate the input env", () => {
		installFakeManagedNode();
		const base = { PATH: "/usr/bin:/bin", FOO: "bar" };
		const beforePath = base.PATH;
		const env = buildSpawnEnv(base);
		expect(base.PATH).toBe(beforePath);
		expect(env.FOO).toBe("bar");
	});
});
