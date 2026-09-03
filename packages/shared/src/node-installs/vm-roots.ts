/**
 * Version-manager installation roots — THE single definition of where
 * nvm / fnm / volta / asdf install Node versions (design D3).
 *
 * The tool-registry strategy chains do NOT walk these roots; they are
 * additive to the enumeration (scope decision 0.2: all four managers).
 * Both this module and any future consumer (e.g. the spawn ladder's
 * version-manager rung) MUST import from here so the root set cannot
 * drift between consumers.
 *
 * See change: add-node-runtime-family-selection.
 */
import path from "node:path";

/** A discovered version-manager installation directory. */
export interface VmInstallDir {
	key: "nvm" | "fnm" | "volta" | "asdf";
	/** Installation root — the candidate root (entries probed inside). */
	root: string;
	/** Version parsed from the directory name, or null when unparseable. */
	version: string | null;
}

/** `v20.11.0` / `20.11.0` → `"20.11.0"`. */
export function versionFromDirName(dir: string): string | null {
	const base = path.basename(dir);
	const m = /^v?(\d+\.\d+\.\d+[^/]*)$/.exec(base);
	return m ? (m[1] ?? null) : null;
}

interface VmLayout {
	/** Directories under home that hold per-version install dirs. */
	versionParents: (home: string, platform: NodeJS.Platform) => string[];
}

const LAYOUTS: Record<"nvm" | "fnm" | "volta" | "asdf", VmLayout> = {
	nvm: {
		versionParents: (home, platform) =>
			platform === "win32"
				? // nvm-windows keeps versions under %APPDATA%\nvm (binaries at
				  // the version-dir root).
				  [path.join(home, "AppData", "Roaming", "nvm")]
				: [path.join(home, ".nvm", "versions", "node")],
	},
	fnm: {
		versionParents: (home) => [
			// Newer fnm defaults to the XDG data dir; older to ~/.fnm. Probe
			// both; duplicates cannot occur (disjoint parents).
			path.join(home, ".local", "share", "fnm", "node-versions"),
			path.join(home, ".fnm", "node-versions"),
		],
	},
	volta: {
		versionParents: (home) => [path.join(home, ".volta", "tools", "image", "node")],
	},
	asdf: {
		versionParents: (home) => [path.join(home, ".asdf", "installs", "nodejs")],
	},
};

/**
 * Scan every version-manager layout for installed Node version
 * directories. Filesystem-only: `readdirSync` on the parent, `stat` for
 * directory-ness — never a spawned process.
 */
export function scanVersionManagerInstalls(deps: {
	homedir: string;
	platform: NodeJS.Platform;
	isDirectory(p: string): boolean;
	readDir(p: string): string[];
}): VmInstallDir[] {
	const out: VmInstallDir[] = [];
	for (const key of ["nvm", "fnm", "volta", "asdf"] as const) {
		for (const parent of LAYOUTS[key].versionParents(deps.homedir, deps.platform)) {
			if (!deps.isDirectory(parent)) continue;
			let entries: string[];
			try {
				entries = deps.readDir(parent);
			} catch {
				continue;
			}
			for (const name of entries) {
				const root = path.join(parent, name);
				if (!deps.isDirectory(root)) continue;
				// isDirectory is the existence proof in a real fs; per-member
				// probing decides the entries. No extra exists() check.
				out.push({ key, root, version: versionFromDirName(root) });
			}
		}
	}
	return out;
}
