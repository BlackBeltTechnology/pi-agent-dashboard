/**
 * Pi core package updater.
 *
 * Runs `npm install -g <pkg>@latest` for globally-installed packages or
 * `npm install <pkg>@latest` in `~/.pi-dashboard/` for managed installs.
 * The `@latest` suffix is required because the consuming `package.json`
 * dependency range (e.g. `^0.70.0`) would otherwise pin updates to the
 * same minor — breaking cross-minor upgrades that pi now ships routinely
 * (0.71+ minors carry breaking changes per its CHANGELOG).
 * Coordinates with PackageManagerWrapper's busy-lock so extension
 * operations and core updates can't run concurrently.
 *
 * See change: fix-pi-core-update-cross-minor.
 */
import { spawn } from "node:child_process"; // ban:child_process-ok npm-update streams stdout/stderr via pipe for progress events; refactor to platform/spawn Recipe is tracked tech debt
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import type { PiCorePackage, PiCoreUpdateResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { prependManagedNodeToPath } from "@blackbelt-technology/pi-dashboard-shared/platform/managed-node-path.js";
import type { PackageManagerWrapper } from "../package/package-manager-wrapper.js";

const UPDATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per package

const MANAGED_DIR = path.join(os.homedir(), ".pi-dashboard");

export interface UpdateProgressEvent {
	name: string;
	phase: "start" | "output" | "complete" | "error";
	message?: string;
}

export type UpdateProgressListener = (event: UpdateProgressEvent) => void;

export interface PiCoreUpdaterOptions {
	packageManagerWrapper: PackageManagerWrapper;
	/** Test seam: override spawner. */
	runNpmUpdate?: (pkg: PiCorePackage, onOutput: (line: string) => void) => Promise<void>;
	/** Optional: called after successful update of at least one package. */
	onAllComplete?: () => Promise<number>;
}

/**
 * Test seams for `defaultRunNpmUpdate`. Production callers omit
 * `_seams`; tests inject fakes to avoid real spawns.
 *
 * `_resolveNpm` defaults to `getDefaultRegistry().resolveExecutor("npm")`.
 * `_spawn` defaults to `node:child_process` `spawn`.
 * `_envBuilder` defaults to `prependManagedNodeToPath(process.env)`.
 */
export interface DefaultRunNpmUpdateSeams {
	_resolveNpm?: () =>
		| { ok: true; argv: string[] }
		| { ok: false; reason: string };
	_spawn?: typeof spawn;
	_envBuilder?: () => NodeJS.ProcessEnv;
}

/**
 * Default npm-update runner.
 *
 * After change `embed-managed-node-runtime`:
 *   - Resolves the `npm` binary via `ToolRegistry.resolve("npm")` so
 *     the managed-Node runtime (when installed) is preferred over the
 *     system PATH — the user-visible regression class this change
 *     exists to prevent (`npm update exited with code 1` on a fresh
 *     Windows install with no system Node).
 *   - Refuses to spawn a bare `"npm"` if the registry can't resolve
 *     it. Surfaces a clear `npm` unresolved error per the spec
 *     scenario "ToolRegistry resolution failure surfaces a clear
 *     error".
 *   - Prepends the managed Node directory to the spawned child's
 *     `PATH` via `prependManagedNodeToPath`, so any nested `node` /
 *     `npm` invocation inside the npm subprocess also resolves to the
 *     managed runtime.
 */
export function defaultRunNpmUpdate(
	pkg: PiCorePackage,
	onOutput: (line: string) => void,
	seams: DefaultRunNpmUpdateSeams = {},
): Promise<void> {
	return new Promise((resolve, reject) => {
		// Always target the npm `latest` dist-tag — bypasses the
		// consuming package.json range so cross-minor jumps work. See
		// change: fix-pi-core-update-cross-minor.
		const spec = `${pkg.name}@latest`;
		const args =
			pkg.installSource === "global"
				? ["install", "-g", spec]
				: ["install", spec];
		const cwd = pkg.installSource === "managed" ? MANAGED_DIR : process.cwd();

		if (pkg.installSource === "managed" && !existsSync(MANAGED_DIR)) {
			reject(new Error(`Managed install directory not found: ${MANAGED_DIR}`));
			return;
		}

		// Resolve npm via ToolRegistry: managed runtime > override > PATH.
		// On unresolved, refuse — do not fall back to bare spawn("npm").
		const resolveNpm =
			seams._resolveNpm ??
			(() => {
				const r = getDefaultRegistry().resolveExecutor("npm");
				return r.ok && r.path
					? { ok: true as const, argv: r.argv }
					: { ok: false as const, reason: "no override, no managed runtime, no npm on PATH" };
			});
		const npmRes = resolveNpm();
		if (!npmRes.ok) {
			reject(new Error(
				`npm could not be resolved (${npmRes.reason}). ` +
				"Install Node.js or run `pi-dashboard repair` to restore the managed Node runtime.",
			));
			return;
		}

		// `argv` is ready-to-spawn: on Windows + an npm-cli.js resolution
		// it is `[node.exe, npm-cli.js]` (bypasses the .cmd shim and the
		// cmd.exe console flash); elsewhere it is `[npm]`.
		const [cmd, ...argvPrefix] = npmRes.argv;
		const spawnFn = seams._spawn ?? spawn;
		const envFn = seams._envBuilder ?? (() => prependManagedNodeToPath(process.env));
		const child = spawnFn(cmd, [...argvPrefix, ...args], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: envFn(),
			windowsHide: true,
		});

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`npm update timed out after ${UPDATE_TIMEOUT_MS / 1000}s`));
		}, UPDATE_TIMEOUT_MS);

		let stderrBuf = "";

		child.stdout?.on("data", (chunk: Buffer) => {
			const lines = chunk.toString().split("\n").filter((l) => l.trim());
			for (const line of lines) onOutput(line);
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderrBuf += text;
			const lines = text.split("\n").filter((l) => l.trim());
			for (const line of lines) onOutput(line);
		});

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve();
			} else {
				const hint =
					pkg.installSource === "global" && /permission|EACCES|EPERM|EROFS/i.test(stderrBuf)
						? ` (permission error — try: sudo npm install -g ${pkg.name}@latest)`
						: "";
				reject(new Error(`npm install exited with code ${code}${hint}`));
			}
		});
	});
}

export class PiCoreUpdater {
	private listener: UpdateProgressListener | undefined;
	private readonly pmWrapper: PackageManagerWrapper;
	private readonly runNpmUpdate: (
		pkg: PiCorePackage,
		onOutput: (line: string) => void,
	) => Promise<void>;
	private readonly onAllComplete: (() => Promise<number>) | undefined;

	constructor(opts: PiCoreUpdaterOptions) {
		this.pmWrapper = opts.packageManagerWrapper;
		this.runNpmUpdate = opts.runNpmUpdate ?? defaultRunNpmUpdate;
		this.onAllComplete = opts.onAllComplete;
	}

	setProgressListener(listener: UpdateProgressListener | undefined): void {
		this.listener = listener;
	}

	/**
	 * Update a set of core packages sequentially. Acquires the shared
	 * busy-lock via PackageManagerWrapper.runExclusive — will throw
	 * PackageOperationBusyError if an extension operation is running.
	 *
	 * Returns per-package results plus the count of sessions reloaded
	 * after a successful update.
	 */
	async update(
		packages: PiCorePackage[],
	): Promise<{ results: PiCoreUpdateResult[]; sessionsReloaded: number }> {
		return this.pmWrapper.runExclusive(async () => {
			const results: PiCoreUpdateResult[] = [];

			for (const pkg of packages) {
				this.emit({ name: pkg.name, phase: "start", message: `Updating ${pkg.name}...` });
				try {
					await this.runNpmUpdate(pkg, (line) => {
						this.emit({ name: pkg.name, phase: "output", message: line });
					});
					results.push({ name: pkg.name, success: true });
					this.emit({ name: pkg.name, phase: "complete", message: `Updated ${pkg.name}` });
				} catch (err) {
					const msg = (err as Error).message ?? String(err);
					results.push({ name: pkg.name, success: false, error: msg });
					this.emit({ name: pkg.name, phase: "error", message: msg });
				}
			}

			let sessionsReloaded = 0;
			if (results.some((r) => r.success) && this.onAllComplete) {
				try {
					sessionsReloaded = await this.onAllComplete();
				} catch (err) {
					console.error("[pi-core-updater] session reload failed:", err);
				}
			}

			return { results, sessionsReloaded };
		});
	}

	private emit(event: UpdateProgressEvent): void {
		try {
			this.listener?.(event);
		} catch (err) {
			console.error("[pi-core-updater] progress listener error:", err);
		}
	}
}
