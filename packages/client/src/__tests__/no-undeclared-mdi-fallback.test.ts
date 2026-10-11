/**
 * Repo-level invariant: every `?? mdi<Name>` fallback expression in
 * client `.tsx` files MUST have its `mdi<Name>` identifier present in
 * an `import { ... } from "@mdi/js"` statement in the same file.
 *
 * Why this lint exists: commit `26cc9ee7` removed `mdiConsoleLine` from
 * the `@mdi/js` import in `SessionCard.tsx` while leaving two
 * `?? mdiConsoleLine` fallback references in place. The bundler did not
 * complain (Vite does not enforce `tsc`'s undeclared-name check at
 * bundle time). At runtime, when a freshly-spawned session's `source`
 * was missing from the `sourceIcons` map, the nullish branch evaluated
 * the dangling identifier and threw `ReferenceError: mdiConsoleLine is
 * not defined` during render — blanking the entire Electron window
 * because no ErrorBoundary sat above the layout chrome.
 *
 * This lint catches the specific shape (`?? mdi<Pascal>`) so the same
 * dropped-import regression cannot recur silently.
 *
 * Dynamic icon paths (variables, expressions, `[icon as keyof typeof ...]`)
 * are NOT inspected — TypeScript catches those when run.
 *
 * If this test fails, either add the identifier to the file's
 * `@mdi/js` import or remove the dangling fallback.
 *
 * See change: fix-session-card-icon-import-and-shell-boundary.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/** Match `?? mdi<PascalCase>` — captures the identifier. */
const MDI_FALLBACK_RE = /\?\?\s*(mdi[A-Z][a-zA-Z0-9]+)\b/g;

/**
 * Match an `import { ... } from "@mdi/js"` statement (single- or
 * double-quoted, multi-line tolerant). Returns the identifier list.
 */
const MDI_IMPORT_RE =
	/import\s*\{([^}]*)\}\s*from\s*["']@mdi\/js["']/g;

async function* walk(dir: string): AsyncGenerator<string> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === "node_modules" ||
				entry.name === "dist" ||
				entry.name === "__tests__"
			)
				continue;
			yield* walk(full);
		} else if (entry.isFile() && entry.name.endsWith(".tsx")) {
			yield full;
		}
	}
}

function collectImportedMdiIdents(content: string): Set<string> {
	const idents = new Set<string>();
	MDI_IMPORT_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MDI_IMPORT_RE.exec(content)) !== null) {
		const inner = match[1];
		// Split by comma; trim; strip `as` aliases (we want the original
		// name since fallbacks reference the original).
		for (const raw of inner.split(",")) {
			const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
			if (name) idents.add(name);
		}
	}
	return idents;
}

/**
 * @structural-pin repo-wide lint: a dangling mdi identifier only throws on a rare nullish branch at render; tsc misses it under the bundler
 */
describe("no undeclared `?? mdi<Name>` fallback in client .tsx files", () => {
	it("every `?? mdi<Name>` identifier is imported from @mdi/js in the same file", async () => {
		const here = path.dirname(url.fileURLToPath(import.meta.url));
		const repoRoot = path.resolve(here, "..", "..", "..", "..");
		const clientSrc = path.resolve(repoRoot, "packages", "client", "src");

		const violations: Array<{ file: string; line: number; ident: string; text: string }> = [];

		for await (const file of walk(clientSrc)) {
			const content = await fs.readFile(file, "utf-8");
			const imported = collectImportedMdiIdents(content);
			const lines = content.split(/\r?\n/);

			lines.forEach((line, idx) => {
				MDI_FALLBACK_RE.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = MDI_FALLBACK_RE.exec(line)) !== null) {
					const ident = match[1];
					if (!imported.has(ident)) {
						violations.push({
							file: path.relative(repoRoot, file),
							line: idx + 1,
							ident,
							text: line.trim(),
						});
					}
				}
			});
		}

		if (violations.length > 0) {
			const msg =
				`Dangling \`?? mdi<Name>\` fallback found in client components.\n` +
				`Each fallback identifier MUST be present in an \`import { ... } from "@mdi/js"\` statement in the same file.\n` +
				`Either add the identifier to the import, or remove the fallback.\n\n` +
				`Offenders (${violations.length}):\n` +
				violations
					.map((v) => `  ${v.file}:${v.line}  ${v.ident}  ${v.text}`)
					.join("\n");
			expect(violations, msg).toEqual([]);
		}
	});
});
