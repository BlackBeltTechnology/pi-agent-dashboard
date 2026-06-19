// ---------------------------------------------------------------------------
// source-matching — canonical "two source strings refer to the same package"
// predicate, shared between the server's /api/packages/recommended route
// and the Electron wizard's bootstrap enricher.
//
// Pure string logic, no fs / no pi SDK dependency. Safe to import from any
// package (shared, server, client, electron).
//
// Input sources take one of these forms:
//
//   npm:<name>[@<version>]
//     e.g.  "npm:pi-web-access", "npm:@scope/example-pkg@0.5.2"
//
//   git@<host>:<owner>/<repo>[.git]
//     e.g.  "git@github.com:BlackBeltTechnology/pi-flows.git"
//
//   https://<host>/<owner>/<repo>[.git][#ref]
//     e.g.  "https://github.com/BlackBeltTechnology/pi-flows.git"
//
//   git:<host>/<owner>/<repo>[#ref]
//     e.g.  "git:github.com/BlackBeltTechnology/pi-flows#main"
//
//   any other string (absolute path, relative path, unrecognized URL)
//     → parsed as kind:"raw" with the literal preserved
//
// Matching rules:
//   - Same kind: exact comparison of the semantically-meaningful parts.
//   - Cross-kind (git ↔ raw): the raw source's basename (last path
//     segment, stripped of trailing slash and trailing .git) must equal
//     the git repo name, case-insensitive. This handles the common case
//     where a user registered the package via `pi install -l <path>`
//     instead of by URL and the basename is the repo name.
// ---------------------------------------------------------------------------

export type SourceKey =
	| { kind: "npm"; name: string }
	| { kind: "git"; host: string; owner: string; repo: string }
	| { kind: "raw"; source: string };

export function parseSourceKey(source: string): SourceKey {
	const trimmed = source.trim();

	if (trimmed.startsWith("npm:")) {
		const spec = trimmed.slice(4).trim();
		// Strip a trailing @version but preserve the scope @ in @scope/name.
		// If spec starts with @, the SECOND @ (if any) delimits version.
		let name = spec;
		if (spec.startsWith("@")) {
			const idx = spec.indexOf("@", 1);
			if (idx > 0) name = spec.slice(0, idx);
		} else {
			const idx = spec.indexOf("@");
			if (idx > 0) name = spec.slice(0, idx);
		}
		return { kind: "npm", name };
	}

	const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/.]+)(?:\.git)?$/);
	if (sshMatch) {
		return { kind: "git", host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
	}

	const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/#.]+)(?:\.git)?(?:#.+)?$/);
	if (httpsMatch) {
		return {
			kind: "git",
			host: httpsMatch[1],
			owner: httpsMatch[2],
			repo: httpsMatch[3],
		};
	}

	const gitPrefixMatch = trimmed.match(/^git:([^/]+)\/([^/]+)\/([^/#]+?)(?:\.git)?(?:#.+)?$/);
	if (gitPrefixMatch) {
		return {
			kind: "git",
			host: gitPrefixMatch[1],
			owner: gitPrefixMatch[2],
			repo: gitPrefixMatch[3],
		};
	}

	return { kind: "raw", source: trimmed };
}

/**
 * Extract the basename (last path segment, .git-stripped) from a raw
 * source string. Returns lowercase or null.
 */
function localPathBasename(src: string): string | null {
	const stripped = src.replace(/\/+$/, "").replace(/\.git$/, "");
	const segments = stripped.split(/[\\/]/);
	const tail = segments[segments.length - 1];
	return tail ? tail.toLowerCase() : null;
}

/**
 * True iff two source strings refer to the same package. See module
 * header for the full matching rules and rationale.
 */
export function sourcesMatch(a: string, b: string): boolean {
	const ka = parseSourceKey(a);
	const kb = parseSourceKey(b);

	if (ka.kind === kb.kind) {
		if (ka.kind === "npm" && kb.kind === "npm") return ka.name === kb.name;
		if (ka.kind === "git" && kb.kind === "git") {
			return (
				ka.host.toLowerCase() === kb.host.toLowerCase() &&
				ka.owner.toLowerCase() === kb.owner.toLowerCase() &&
				ka.repo.toLowerCase() === kb.repo.toLowerCase()
			);
		}
		if (ka.kind === "raw" && kb.kind === "raw") return ka.source === kb.source;
	}

	// Cross-kind: git ↔ raw (local path). Match on repo basename.
	const gitKey = ka.kind === "git" ? ka : kb.kind === "git" ? kb : null;
	const rawKey = ka.kind === "raw" ? ka : kb.kind === "raw" ? kb : null;
	if (gitKey && rawKey) {
		const basename = localPathBasename(rawKey.source);
		if (basename && basename === gitKey.repo.toLowerCase()) return true;
	}

	// Cross-kind: git ↔ npm. Match the git repo name against the npm
	// package's unscoped name (strip @scope/). Handles packages migrated from
	// a git source to a published npm scope without updating every
	// registration (e.g. pi-anthropic-messages).
	const npmKey = ka.kind === "npm" ? ka : kb.kind === "npm" ? kb : null;
	if (gitKey && npmKey) {
		const unscoped = npmKey.name.replace(/^@[^/]+\//, "").toLowerCase();
		if (unscoped && unscoped === gitKey.repo.toLowerCase()) return true;
	}

	// Cross-kind: npm ↔ raw (local path). Match the local path basename
	// against the npm package's unscoped name. Handles a local checkout
	// (`pi install -l <path>`) of a package whose manifest source is the
	// npm scope (e.g. pi-anthropic-messages after its npm rescope).
	if (npmKey && rawKey) {
		const basename = localPathBasename(rawKey.source);
		const unscoped = npmKey.name.replace(/^@[^/]+\//, "").toLowerCase();
		if (basename && unscoped && basename === unscoped) return true;
	}

	return false;
}
