/**
 * Pure helpers for classifying pi package sources and computing
 * dedup identities. Mirrors the rules documented in pi's
 * `docs/packages.md`:
 *
 *   - npm:<spec>    → identity = bare package name (without `@version`)
 *   - git:<url>     → identity = url with trailing `@<ref>` stripped
 *   - https://...   → identity = url with trailing `@<ref>` stripped
 *   - /abs/path     → identity = the absolute path verbatim
 *   - rel-path      → identity = path resolved against settingsDir
 *
 * Used by `PackageManagerWrapper.move()` for identity preflight (so we
 * can return 409 already_at_destination before any side-effects) and
 * for source classification when picking the move execution arm.
 *
 * See change: unify-package-management-ui.
 */
import path from "node:path";

export type SourceKind = "npm" | "git" | "https" | "abs-path" | "rel-path";

const PROTOCOL_PREFIXES = ["https://", "http://", "ssh://", "git://"];

/**
 * Classify a pi package source string by kind.
 *
 * Falls through to abs-path / rel-path for anything that isn't an
 * `npm:` / `git:` / protocol-url source. Empty strings and pure
 * whitespace are treated as `rel-path` (defensive — pi would reject
 * these upstream, but we don't need to crash on them here).
 */
export function parseSourceKind(source: string): SourceKind {
	if (source.startsWith("npm:")) return "npm";
	// Protocol URLs MUST be checked before the `git:` shorthand check
	// because `git://` legitimately starts with `git:` but is a protocol
	// URL per pi's docs (handled the same as https for our purposes).
	for (const proto of PROTOCOL_PREFIXES) {
		if (source.startsWith(proto)) return "https";
	}
	if (source.startsWith("git:")) return "git";
	if (path.isAbsolute(source)) return "abs-path";
	// Windows drive-letter paths (e.g. C:\foo or C:/foo). `path.isAbsolute`
	// only returns true for these on win32; on POSIX hosts we still want
	// to classify them as abs-path so cross-host tests are stable.
	if (/^[a-zA-Z]:[\\/]/.test(source)) return "abs-path";
	return "rel-path";
}

/**
 * Compute the dedup identity for a source string per pi's package
 * scope-and-deduplication rules.
 *
 * For relative paths, `settingsDir` is the directory of the
 * `settings.json` file the entry lives in (pi resolves rel paths
 * against that location). When called without `settingsDir` the
 * relative path is returned verbatim — callers that need real
 * dedup MUST pass `settingsDir`.
 */
export function computeIdentity(source: string, settingsDir?: string): string {
	const kind = parseSourceKind(source);

	switch (kind) {
		case "npm": {
			// "npm:@scope/pkg@1.2.3" → "npm:@scope/pkg"
			// "npm:foo@1.2.3"        → "npm:foo"
			const rest = source.slice(4); // strip "npm:"
			// Find the LAST `@` that isn't part of the leading scope `@`.
			const scoped = rest.startsWith("@");
			const atIdx = scoped ? rest.indexOf("@", 1) : rest.indexOf("@");
			const name = atIdx >= 0 ? rest.slice(0, atIdx) : rest;
			return `npm:${name}`;
		}

		case "git":
		case "https": {
			// Strip trailing `@<ref>` if present. Refs come AFTER the
			// repo URL; we look for the LAST `@` that isn't the
			// `git@host` form's leading `@`.
			//
			// Heuristic: split on `@` and rejoin all but the last
			// segment IF the last segment looks like a version/ref
			// (no `/`, no `.`-host-style structure).
			const lastAt = source.lastIndexOf("@");
			if (lastAt > 0) {
				const tail = source.slice(lastAt + 1);
				// `git@github.com:...` — the `@` here is part of the host.
				const hostLikeTail = tail.includes(":") || tail.includes("/");
				if (!hostLikeTail) {
					return source.slice(0, lastAt);
				}
			}
			return source;
		}

		case "abs-path":
			return path.normalize(source);

		case "rel-path":
			if (settingsDir) {
				return path.resolve(settingsDir, source);
			}
			return source;
	}
}
