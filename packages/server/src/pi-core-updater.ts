/**
 * Pi core package updater.
 *
 * Runs `npm update -g <pkg>` for globally-installed packages or
 * `npm update <pkg>` in `~/.pi-dashboard/` for managed installs.
 * Coordinates with PackageManagerWrapper's busy-lock so extension
 * operations and core updates can't run concurrently.
 */
import { spawn } from "node:child_process"; // ban:child_process-ok npm-update streams stdout/stderr via pipe for progress events; refactor to platform/spawn Recipe is tracked tech debt
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import type { PiCorePackage, PiCoreUpdateResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { PackageManagerWrapper } from "./package-manager-wrapper.js";

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

/** Default npm-update runner. */
function defaultRunNpmUpdate(
	pkg: PiCorePackage,
	onOutput: (line: string) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const args =
			pkg.installSource === "global"
				? ["update", "-g", pkg.name]
				: ["update", pkg.name];
		const cwd = pkg.installSource === "managed" ? MANAGED_DIR : process.cwd();

		if (pkg.installSource === "managed" && !existsSync(MANAGED_DIR)) {
			reject(new Error(`Managed install directory not found: ${MANAGED_DIR}`));
			return;
		}

		const child = spawn("npm", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
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
						? ` (permission error — try: sudo npm update -g ${pkg.name})`
						: "";
				reject(new Error(`npm update exited with code ${code}${hint}`));
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
