/**
 * Catalog key-parity for the browser plugin (change: add-browser-relay, task
 * 4.4; add-dedicated-agent-browser, test-plan #F14). `catalog` ships UNPREFIXED
 * leaf keys under `plugin.browser.*`; every locale must carry the same key set
 * — a missing key silently falls back to the inline English string.
 *
 * @structural-pin scans client component sources for `t("key")` literals: a key used in a component but absent from the catalog silently falls back to English, which no rendered-output test of the other locales can observe
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalog } from "../../i18n.js";

/** Keys added by add-dedicated-agent-browser (task 7.5). */
const DAB_KEYS = [
	"agentBrowsingTitle",
	"agentBrowsingError",
	"defaultBrowserLabel",
	"defaultDedicatedTitle",
	"defaultDedicatedHelp",
	"recommended",
	"defaultRealTitle",
	"defaultRealHelp",
	"realProfilePicker",
	"defaultHeadlessTitle",
	"defaultHeadlessHelp",
	"onUnavailableLabel",
	"onUnavailableAsk",
	"onUnavailableNext",
	"onUnavailableStop",
	"onUnavailableHelp",
	"idleLabel",
	"idle5",
	"idle30",
	"idle120",
	"idleNever",
	"idleHelp",
	"multiLabel",
	"multiOne",
	"multiSeveral",
	"multiHelp",
	"liveViewLabel",
	"liveViewOption",
	"globalDomainsLabel",
	"globalDomainsPlaceholder",
	"globalDomainsHelp",
	"dedicatedTitle",
	"dedicatedPillRunning",
	"dedicatedPillRunningOne",
	"dedicatedPillStarting",
	"dedicatedPillStopped",
	"dedicatedPillNotSetUp",
	"dedicatedPillUnavailable",
	"dedicatedStatus",
	"dedicatedStatusRunning",
	"dedicatedStatusRunningBy",
	"dedicatedStatusStarting",
	"dedicatedStatusStopped",
	"dedicatedLastUsed",
	"dedicatedNever",
	"dedicatedSize",
	"dedicatedServes",
	"dedicatedServesValue",
	"dedicatedData",
	"dedicatedLimits",
	"dedicatedCreateIntro",
	"dedicatedCreateAndOpen",
	"dedicatedOpen",
	"dedicatedStop",
	"dedicatedReset",
	"dedicatedResetNeedsStop",
	"dedicatedNoChrome",
	"dedicatedNoDisplay",
	"dedicatedActionFailed",
	"resetConfirmTitle",
	"resetConfirmBody",
	"resetConfirmCancel",
	"resetConfirmOk",
	"profilesTitle",
	"profilesNeedsExtension",
	"passwordManagerPill",
	"passwordManagerWarning",
	"allowedDomainsPlaceholder",
	"uninstalledSummary",
	"uninstalledSummaryOne",
] as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(HERE, "..");

/** `t("key"` literals used by the client sources. */
function usedKeys(): Set<string> {
	const keys = new Set<string>();
	for (const file of readdirSync(CLIENT_DIR).filter((f) => f.endsWith(".tsx"))) {
		const src = readFileSync(join(CLIENT_DIR, file), "utf8");
		for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1] as string);
	}
	return keys;
}

const placeholders = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("browser catalog", () => {
	it("has a non-empty key set in every locale", () => {
		for (const locale of ["zh-CN", "hu"] as const) {
			expect(Object.keys(catalog[locale]).length).toBeGreaterThan(0);
		}
	});

	it("zh-CN and hu keep key parity", () => {
		expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
	});

	it("#F14 every dedicated-browser key is present and non-empty in zh-CN and hu", () => {
		for (const locale of ["zh-CN", "hu"] as const) {
			const dict = catalog[locale] as Record<string, string>;
			for (const key of DAB_KEYS) {
				expect(typeof dict[key], `${locale}.${key}`).toBe("string");
				expect(dict[key]?.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
			}
		}
	});

	it("#F14 every key the client components look up exists in both locales", () => {
		const used = usedKeys();
		expect(used.size).toBeGreaterThan(DAB_KEYS.length);
		for (const key of DAB_KEYS) expect(used.has(key), `unused catalog key ${key}`).toBe(true);
		for (const locale of ["zh-CN", "hu"] as const) {
			const dict = catalog[locale] as Record<string, string>;
			const missing = [...used].filter((k) => !(k in dict));
			expect(missing, `${locale} missing`).toEqual([]);
		}
	});

	it("{var} placeholders agree between zh-CN and hu", () => {
		const zh = catalog["zh-CN"] as Record<string, string>;
		const hu = catalog.hu as Record<string, string>;
		for (const key of Object.keys(zh)) {
			expect(placeholders(hu[key] ?? ""), key).toEqual(placeholders(zh[key] ?? ""));
		}
	});
});
