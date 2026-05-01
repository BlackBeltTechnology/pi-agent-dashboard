/**
 * Repo-level invariant: every `<a>` JSX element in the client with a
 * literal `http(s)://` href MUST also carry `target="_blank"` (and,
 * by convention, `rel="noopener noreferrer"`). Omitting `target="_blank"`
 * in the Electron shell replaces the dashboard's only window with an
 * external page, stranding the user — see issue #13.
 *
 * This lint catches the common case (literal URL in JSX). Dynamic hrefs
 * (template literals, variables) are NOT inspected — the
 * `MarkdownContent` `a` component override + Electron `will-navigate`
 * guard are the defense-in-depth layers for those.
 *
 * If this test fails, add `target="_blank" rel="noopener noreferrer"` to
 * the offending `<a>` tag, or add the opt-out marker on the same line:
 *   <a href="https://internal">...</a>  // ban:bare-anchor-ok
 *
 * See change: harden-external-link-handling.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/** Per-line opt-out marker for intentional exceptions. */
const OPT_OUT_MARKER = "ban:bare-anchor-ok";

/**
 * Match an `<a ... >` opening tag that contains a literal `http(s)://`
 * href. We only scan lines where the full opening tag fits on a single
 * line — multi-line JSX anchors are rare and would be caught by review.
 * Once an opening tag is matched, we inspect it for `target=` separately
 * (works regardless of attr order).
 */
const ANCHOR_OPEN_WITH_HTTP_HREF_RE =
	/<a\s[^>]*\bhref\s*=\s*"https?:\/\/[^"]*"[^>]*>/g;
const TARGET_ATTR_RE = /\btarget\s*=/;

async function* walk(dir: string): AsyncGenerator<string> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
			yield* walk(full);
		} else if (entry.isFile() && entry.name.endsWith(".tsx")) {
			yield full;
		}
	}
}

describe("no bare external <a> in client components", () => {
	it("every literal http(s):// <a> carries target=\"_blank\"", async () => {
		const here = path.dirname(url.fileURLToPath(import.meta.url));
		const repoRoot = path.resolve(here, "..", "..", "..", "..");
		const clientSrc = path.resolve(repoRoot, "packages", "client", "src");

		const violations: Array<{ file: string; line: number; text: string }> = [];

		for await (const file of walk(clientSrc)) {
			const content = await fs.readFile(file, "utf-8");
			const lines = content.split(/\r?\n/);
			lines.forEach((line, idx) => {
				if (line.includes(OPT_OUT_MARKER)) return;
				ANCHOR_OPEN_WITH_HTTP_HREF_RE.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = ANCHOR_OPEN_WITH_HTTP_HREF_RE.exec(line)) !== null) {
					if (TARGET_ATTR_RE.test(match[0])) continue;
					violations.push({
						file: path.relative(repoRoot, file),
						line: idx + 1,
						text: line.trim(),
					});
				}
			});
		}

		if (violations.length > 0) {
			const msg =
				`Bare <a href="http(s)://..."> without target="_blank" found in client components.\n` +
				`Add target="_blank" rel="noopener noreferrer" or the ban:bare-anchor-ok marker.\n\n` +
				`Offenders (${violations.length}):\n` +
				violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
			expect(violations, msg).toEqual([]);
		}
	});
});
