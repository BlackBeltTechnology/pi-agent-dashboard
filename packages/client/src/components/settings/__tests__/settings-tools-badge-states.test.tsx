/**
 * Status-badge states for Settings → Tools rows (ToolsSection).
 *
 * A REJECTED override on a row that did NOT resolve must render a THIRD
 * badge state — distinct from BOTH the plain not-found state and the
 * existing rejected-but-fell-back state — with a tooltip naming the
 * rejected path (degrading to the reason text when the reason carries no
 * extractable path). Rows are driven through a stubbed /api/tools payload;
 * the section fetches on mount, exactly as in production.
 * See change: fix-node-family-resolution-gaps. test-plan #F1–#F7, #X1, #X2.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mdiAlert, mdiCheck, mdiClose } from "@mdi/js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ToolsSection } from "../ToolsSection.js";
import type { ToolListEntry } from "../../../lib/api/tools-api.js";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const row = (over: Partial<ToolListEntry> & { name: string }): ToolListEntry => ({
	ok: false,
	path: null,
	source: null,
	tried: [],
	resolvedAt: 0,
	...over,
});

const REJECTED_WITH_PATH = "invalid: path does not exist: /nope/bin/node";

function stubFetch(tools: ToolListEntry[]) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			// ToolsSection mounts two probes: /api/health (useHostPlatform) and
			// /api/tools (the list). Nothing else is fetched at mount.
			const body = url.includes("/api/health")
				? { success: true, platform: "linux" }
				: { success: true, data: { tools } };
			return {
				ok: true,
				headers: { get: () => "application/json" },
				json: async () => body,
			} as unknown as Response;
		}),
	);
}

async function renderTools(tools: ToolListEntry[]) {
	stubFetch(tools);
	render(<ToolsSection />);
	await waitFor(() =>
		expect(document.getElementById(`tool-row-${tools[0].name}`)).not.toBeNull(),
	);
}

/**
 * The collapsed row's status badge: the second title-bearing element (after
 * the chevron button), carrying the tooltip in `title` and the state glyph
 * as its only svg path. Markup contract of ToolRow.
 */
function badgeOf(name: string): { title: string; icon: string } {
	const el = document.getElementById(`tool-row-${name}`);
	if (!el) throw new Error(`row ${name} not rendered`);
	const badge = el.querySelectorAll("[title]")[1];
	if (!badge) throw new Error(`row ${name} has no status badge`);
	const icon = badge.querySelector("svg path");
	return {
		title: badge.getAttribute("title") ?? "",
		icon: icon?.getAttribute("d") ?? "",
	};
}

// #F7 — the new tooltip key must resolve in every catalog (i18n parity,
// ui-i18n-coverage). The zh-CN dictionary is module-private inside i18n.tsx,
// so read the sources as text — same approach as settings-unit-i18n.test.tsx.
const here = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(here, "../../../lib");
const SOURCES: [string, string][] = [
	["zh-CN", readFileSync(resolve(LIB, "i18n/i18n.tsx"), "utf8")],
	["hu", readFileSync(resolve(LIB, "i18n/i18n-hu.ts"), "utf8")],
	["en", readFileSync(resolve(LIB, "i18n-en-source.json"), "utf8")],
];
const TOOLTIP_KEY = "common.overrideRejectedDidNotResolve";

function lookup(source: string, key: string): string | undefined {
	const m = source.match(
		new RegExp(`"${key.replace(".", "\\.")}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
	);
	return m?.[1];
}

describe("ToolsSection status badge — rejected override states", () => {
	// #F1 — the third state: unresolved row with a rejected override is
	// distinct from BOTH the plain not-found state and the fallback state,
	// and its tooltip names the rejected path.
	it("rejected-override indicator on a not-found row is three-way distinct", async () => {
		await renderTools([
			row({
				name: "rejected-notfound",
				tried: [
					{ strategy: "override", result: REJECTED_WITH_PATH },
					{ strategy: "where", result: "not found on PATH" },
				],
			}),
			row({
				name: "plain-notfound",
				tried: [
					{ strategy: "override", result: "no override set" },
					{ strategy: "where", result: "not found on PATH" },
				],
			}),
			row({
				name: "fell-back",
				ok: true,
				path: "/usr/bin/node",
				source: "system",
				tried: [
					{ strategy: "override", result: REJECTED_WITH_PATH },
					{ strategy: "where", result: "ok" },
				],
			}),
		]);
		const rejected = badgeOf("rejected-notfound");
		const plain = badgeOf("plain-notfound");
		const fell = badgeOf("fell-back");

		// Tooltip names the rejected path — and does NOT claim a fallback.
		expect(rejected.title).toContain("/nope/bin/node");
		expect(rejected.title).not.toContain("fallback");

		// Unchanged states keep their exact glyphs and wording.
		expect(plain.title).toBe("Not found");
		expect(plain.icon).toBe(mdiClose);
		expect(fell.title).toBe("Override invalid; using fallback");
		expect(fell.icon).toBe(mdiAlert);

		// Three-way distinct: different glyphs, not just different colours.
		expect(rejected.icon).not.toBe(plain.icon);
		expect(rejected.icon).not.toBe(fell.icon);
	});

	// #F2 — a not-found row WITHOUT an override is unchanged.
	it("not-found row without an override is unchanged", async () => {
		await renderTools([
			row({
				name: "plain",
				tried: [
					{ strategy: "override", result: "no override set" },
					{ strategy: "where", result: "not found on PATH" },
				],
			}),
		]);
		const b = badgeOf("plain");
		expect(b.title).toBe("Not found");
		expect(b.icon).toBe(mdiClose);
		expect(b.title.toLowerCase()).not.toContain("override");
	});

	// #F3 — resolved + rejected keeps the existing fallback indicator,
	// behaviour identical to today.
	it("resolved + rejected row keeps the existing fallback indicator", async () => {
		await renderTools([
			row({
				name: "resolved-rejected",
				ok: true,
				path: "/usr/bin/node",
				source: "system",
				tried: [
					{ strategy: "override", result: REJECTED_WITH_PATH },
					{ strategy: "where", result: "ok" },
				],
			}),
		]);
		const b = badgeOf("resolved-rejected");
		expect(b.title).toBe("Override invalid; using fallback");
		expect(b.icon).toBe(mdiAlert);
	});

	// #F4 — resolved clean row is unchanged.
	it("resolved clean row is unchanged", async () => {
		await renderTools([
			row({ name: "clean", ok: true, path: "/usr/bin/node", source: "system", tried: [] }),
		]);
		const b = badgeOf("clean");
		expect(b.title).toBe("Resolved via system");
		expect(b.icon).toBe(mdiCheck);
	});

	// #F5 — wording distinguishes fell-back from did-not-resolve.
	it("tooltip distinguishes fell-back from did-not-resolve", async () => {
		await renderTools([
			row({
				name: "a-unresolved",
				tried: [{ strategy: "override", result: REJECTED_WITH_PATH }],
			}),
			row({
				name: "b-resolved",
				ok: true,
				path: "/usr/bin/npx",
				source: "system",
				tried: [
					{ strategy: "override", result: REJECTED_WITH_PATH },
					{ strategy: "where", result: "ok" },
				],
			}),
		]);
		const a = badgeOf("a-unresolved");
		const b = badgeOf("b-resolved");
		// (a) indicates the rejection without asserting a fallback occurred.
		expect(a.title).toContain("did not resolve");
		expect(a.title).not.toContain("fallback");
		// (b) retains the existing fallback phrasing.
		expect(b.title).toBe("Override invalid; using fallback");
	});

	// #F6 — an unparseable rejection reason still yields an indicator; the
	// tooltip degrades to the reason text, never an empty/undefined path.
	it("unparseable rejection reason degrades the tooltip to the reason text", async () => {
		await renderTools([
			row({
				name: "opaque",
				tried: [{ strategy: "override", result: "invalid: validator said no" }],
			}),
		]);
		const b = badgeOf("opaque");
		expect(b.title).toContain("rejected");
		expect(b.title).toContain("validator said no");
		expect(b.title).not.toMatch(/\b(undefined|null)\b/i);
		expect(b.title.trim().endsWith(":")).toBe(false);
	});

	// #F7 — i18n parity: the new tooltip key exists in en, zh-CN AND hu.
	it("tooltip key resolves in en, zh-CN, and hu", () => {
		for (const [locale, source] of SOURCES) {
			expect(lookup(source, TOOLTIP_KEY), `missing in ${locale}`).toBeTruthy();
		}
	});

	// #X1 — badge tolerates a trail-less payload (older server / plugin row):
	// no throw, degrades to the plain not-found state.
	it("tolerates a trail-less payload without throwing", async () => {
		await renderTools([
			row({ name: "empty-trail", tried: [] }),
			row({
				name: "absent-trail",
				tried: undefined as unknown as ToolListEntry["tried"],
			}),
		]);
		expect(badgeOf("empty-trail").title).toBe("Not found");
		expect(badgeOf("absent-trail").title).toBe("Not found");
	});

	// #X2 — a rejected path with spaces and non-ASCII renders intact.
	it("rejected path with spaces and non-ASCII renders intact", async () => {
		const weird = "/home/t/ünïcode dir/bin/node";
		await renderTools([
			row({
				name: "weird",
				tried: [
					{ strategy: "override", result: `invalid: path does not exist: ${weird}` },
				],
			}),
		]);
		expect(badgeOf("weird").title).toContain(weird);
	});
});
