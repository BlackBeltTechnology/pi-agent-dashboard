/**
 * Pure client-side helpers for the installed-packages UI.
 *
 * `computeDestIdentity` mirrors the server's `computeIdentity` for non-
 * filesystem cases (npm, git, https). For path sources we don't have
 * the settings.json directory at hand, so we fall back to the literal
 * source string. This is safe for the "already-at-destination" preflight
 * because path sources are unique per-folder anyway.
 *
 * See change: unify-package-management-ui.
 */

const PROTOCOL_PREFIXES = ["https://", "http://", "ssh://", "git://"];

/**
 * Compute a string identity for dedup'ing installed-package rows across
 * scopes. Mirrors the server's `computeIdentity` for the cases this
 * code paths through (npm, git, https). Path sources fall back to the
 * literal source string since we don't have absolute-path resolution
 * in the browser.
 */
export function computeDestIdentity(source: string): string {
	if (source.startsWith("npm:")) {
		const rest = source.slice(4);
		const scoped = rest.startsWith("@");
		const atIdx = scoped ? rest.indexOf("@", 1) : rest.indexOf("@");
		const name = atIdx >= 0 ? rest.slice(0, atIdx) : rest;
		return `npm:${name}`;
	}
	if (source.startsWith("git:") || PROTOCOL_PREFIXES.some((p) => source.startsWith(p))) {
		const lastAt = source.lastIndexOf("@");
		if (lastAt > 0) {
			const tail = source.slice(lastAt + 1);
			if (!tail.includes(":") && !tail.includes("/")) {
				return source.slice(0, lastAt);
			}
		}
		return source;
	}
	// Path sources — fall back to literal. Safe because path identity is
	// already unique per directory; cross-scope duplication detection
	// happens server-side in the Move endpoint anyway.
	return source;
}
