/**
 * Folder Add-ons page ("Add-ons in this folder"): effective-set strip, groups,
 * the per-folder "on here" switch flow (revert on failure, keptOn / notOwned
 * replies, trust dialog + retry), Added-in-this-folder actions, Discover.
 * Hooks that talk to the package queue are mocked; `fetch` is mocked by URL.
 * See change: addons-hub-folder-view (test-plan #F1–#F9).
 */
import type { AddonFeature } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackagesPage } from "../DirectorySettings/PackagesPage.js";

const CWD = "/repo";
const ops = {
	install: vi.fn(),
	remove: vi.fn(),
	update: vi.fn(),
	operation: { operationId: null, status: "idle", message: "", source: "" },
};
vi.mock("../../hooks/usePackageOperations.js", () => ({
	usePackageOperations: () => ({
		...ops,
		coreUpdate: vi.fn(), move: vi.fn(), moveStateFor: () => undefined, clearMove: vi.fn(), statusFor: () => "idle",
		messageFor: () => "", clearOperation: vi.fn(), queueDepth: 0, runningSource: null, isAnyRunning: false, handleMessage: vi.fn(),
	}),
}));
vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../../hooks/useInstalledPackages.js", () => ({
	useInstalledPackages: () => ({ packages: [], isLoading: false, error: null, refresh: vi.fn() }),
}));
// Discover embeds the package browser; a stub exposes its install callback.
vi.mock("../packages/PackageBrowser.js", () => ({
	PackageBrowser: (p: { onConfirmInstall?: (s: string) => void; hideGlobalInstalledRecommended?: boolean }) => (
		<div data-testid="browser-stub" data-hide-installed={String(p.hideGlobalInstalledRecommended)}>
			<button type="button" onClick={() => p.onConfirmInstall?.("npm:r1")}>
				install-r1
			</button>
		</div>
	),
}));

const mk = (id: string, name: string, folderState: AddonFeature["folderState"], extra: Partial<AddonFeature> = {}): AddonFeature => ({
	id,
	displayName: name,
	description: `${name} description`,
	kind: "agent-only",
	origin: "community",
	authorLabels: ["acme"],
	state: "on",
	packages: [
		{
			source: `npm:${id}`, scope: "user", identity: `npm:${id}`, sourceKind: "npm", entryOff: false,
			contents: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
		},
	],
	requires: [],
	requiredBy: [],
	folderState,
	...extra,
});

const LOOSE = { skills: 29, agents: 0, prompts: 0, extensions: 0, themes: 0 };
const loose0 = { skills: 0, agents: 0, prompts: 0, extensions: 0, themes: 0 };

interface Mock {
	features: AddonFeature[];
	loose?: typeof LOOSE;
	settingsError?: string;
	toggle?: (body: any) => { status: number; body: unknown };
	trust?: () => { status: number; body: unknown };
}
let state: Mock;
let fetchMock: ReturnType<typeof vi.fn>;
const res = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function answer(input: RequestInfo, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input.url;
	if (url.includes("/api/addons/catalog")) {
		return res(200, {
			success: true,
			features: state.features,
			folder: { cwd: CWD, looseCounts: state.loose ?? loose0, ...(state.settingsError ? { settingsError: state.settingsError } : {}) },
		});
	}
	if (url.includes("/toggle") && init?.method === "POST") {
		const r = (state.toggle ?? (() => ({ status: 200, body: { success: true, changed: true, keptOn: [], notOwned: [] } })))(JSON.parse(String(init.body)));
		return res(r.status, r.body);
	}
	if (url.includes("/api/resources/trust")) {
		const r = (state.trust ?? (() => ({ status: 200, body: { success: true, data: { trusted: true } } })))();
		return res(r.status, r.body);
	}
	if (url.includes("/api/resources/reload")) return res(200, { success: true, data: { reloaded: 1 } });
	return res(200, { success: true, data: [] });
}

beforeEach(() => {
	Object.values(ops).forEach((v) => typeof v === "function" && (v as ReturnType<typeof vi.fn>).mockClear?.());
	state = { features: [] };
	fetchMock = vi.fn(answer);
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const togglePosts = () => fetchMock.mock.calls.filter(([u, i]) => String(u).includes("/toggle") && i?.method === "POST");
const text = (id: string) => screen.getByTestId(id).textContent ?? "";

/** 31 global pi features, 1 folder package, 29 loose skills, 1 feature off here. */
function stripFixture(): AddonFeature[] {
	const g = Array.from({ length: 31 }, (_, i) => mk(`g${i}`, `Global ${i}`, i === 0 ? "off-here" : "inherited"));
	const folderPkg = mk("local-pkg", "Folder Pkg", "added-here", {
		packages: [{ source: "npm:local-pkg", scope: "project", identity: "npm:local-pkg", sourceKind: "npm", entryOff: false, contents: { extensions: 1, skills: 0, prompts: 0, themes: 0 } }],
	});
	return [...g, folderPkg];
}

describe("folder Add-ons page — strip", () => {
	// test-plan #F1
	it("reads from Global + added here − turned off here = what loads here", async () => {
		state = { features: stripFixture(), loose: LOOSE };
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-g1");
		expect(text("folder-strip-global")).toContain("31");
		expect(text("folder-strip-global")).toContain("from Global");
		expect(text("folder-strip-added")).toContain("1 + 29 files");
		expect(text("folder-strip-added")).toContain("added in this folder");
		expect(text("folder-strip-off")).toContain("1");
		expect(text("folder-strip-off")).toContain("turned off here");
		expect(text("folder-strip-total")).toContain("Sessions here load 31 add-ons + 29 own files");
		expect(text("folder-strip-total")).toContain("new sessions started in this folder");
	});

	// test-plan #F2
	it("never counts a feature that is off globally, whatever its folder state", async () => {
		state = {
			features: [...stripFixture(), mk("gone", "Gone", "off-globally", { state: "off" })],
			loose: LOOSE,
		};
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-gone");
		expect(text("folder-strip-global")).toContain("31");
		expect(text("folder-strip-off")).toContain("1");
		expect(text("folder-strip-total")).toContain("31 add-ons + 29 own files");
	});

	it("shows the heading, the Global / This folder switch and the dashboard-plugins explainer", async () => {
		state = { features: [] };
		render(<PackagesPage cwd={CWD} />);
		expect(screen.getByText("Add-ons in this folder")).toBeTruthy();
		expect(screen.getByTestId("folder-addons-scope-folder").getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByTestId("folder-addons-explainer").textContent).toContain("always apply to every folder");
	});
});

describe("folder Add-ons page — switch flow", () => {
	// test-plan #F3
	it("turning a From Global row off updates the row and the strip without a reload, and offers a session reload", async () => {
		const features = [mk("pi-web-access", "Web Access", "inherited"), mk("other", "Other", "inherited")];
		state = { features };
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-pi-web-access");
		expect(text("folder-strip-off")).toContain("0");
		state.toggle = () => {
			features[0] = mk("pi-web-access", "Web Access", "off-here");
			return { status: 200, body: { success: true, changed: true, keptOn: [], notOwned: [] } };
		};
		fireEvent.click(screen.getByTestId("folder-addon-switch-pi-web-access"));
		await waitFor(() => expect(text("folder-addon-state-pi-web-access")).toBe("off in this folder"));
		expect(togglePosts()).toHaveLength(1);
		expect(JSON.parse(String(togglePosts()[0][1].body))).toEqual({ scope: "local", cwd: CWD, enabled: false });
		expect(text("folder-strip-off")).toContain("1");
		expect(screen.getByTestId("addon-reload-banner")).toBeTruthy();
		fireEvent.click(screen.getByTestId("addon-reload-button"));
		await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes("/api/resources/reload") && JSON.parse(String(i.body)).cwd === CWD)).toBe(true));
	});

	// test-plan #F4
	it("a failed toggle leaves the switch on, the strip unchanged and shows the server message inline", async () => {
		state = { features: [mk("pi-web-access", "Web Access", "inherited")], toggle: () => ({ status: 409, body: { success: false, error: "settings unparseable" } }) };
		render(<PackagesPage cwd={CWD} />);
		const sw = await screen.findByTestId("folder-addon-switch-pi-web-access");
		fireEvent.click(sw);
		await waitFor(() => expect(text("folder-addon-error-pi-web-access")).toBe("settings unparseable"));
		expect(screen.getByTestId("folder-addon-switch-pi-web-access").getAttribute("aria-checked")).toBe("true");
		expect(text("folder-strip-off")).toContain("0");
		expect(screen.queryByTestId("addon-reload-banner")).toBeNull();
	});

	it("a network error also leaves the row as it was", async () => {
		state = { features: [mk("a", "A", "inherited")] };
		render(<PackagesPage cwd={CWD} />);
		const sw = await screen.findByTestId("folder-addon-switch-a");
		fetchMock.mockImplementationOnce(async () => {
			throw new TypeError("network down");
		});
		fireEvent.click(sw);
		await waitFor(() => expect(text("folder-addon-error-a")).toContain("network down"));
		expect(screen.getByTestId("folder-addon-switch-a").getAttribute("aria-checked")).toBe("true");
	});

	// test-plan #F5
	it("a keptOn reply keeps the switch on and names the requiring feature", async () => {
		state = {
			features: [mk("x", "Pkg X", "inherited"), mk("plugin:b", "Plugin B", "dashboard-only", { packages: [] })],
			toggle: () => ({ status: 200, body: { success: true, changed: false, keptOn: [{ source: "npm:x", by: ["plugin:b"] }], notOwned: [] } }),
		};
		render(<PackagesPage cwd={CWD} />);
		fireEvent.click(await screen.findByTestId("folder-addon-switch-x"));
		await waitFor(() => expect(text("folder-addon-kepton-x")).toContain("Plugin B"));
		expect(screen.getByTestId("folder-addon-switch-x").getAttribute("aria-checked")).toBe("true");
		expect(screen.queryByTestId("addon-reload-banner")).toBeNull();
	});

	it("a notOwned reply shows the entry and retries exactly once with removeUnowned after the confirmation", async () => {
		const entry = { source: "npm:x", autoload: false, extensions: [], skills: [], prompts: [], themes: [] };
		let calls = 0;
		state = {
			features: [mk("x", "Pkg X", "off-here")],
			toggle: (body) => {
				calls++;
				return body.removeUnowned
					? { status: 200, body: { success: true, changed: true, keptOn: [], notOwned: [], removed: ["npm:x"] } }
					: { status: 200, body: { success: true, changed: false, keptOn: [], notOwned: [{ source: "npm:x", reason: "no-record", entry }] } };
			},
		};
		render(<PackagesPage cwd={CWD} />);
		fireEvent.click(await screen.findByTestId("folder-addon-switch-x"));
		const dlg = await screen.findByTestId("folder-addon-notowned-x");
		expect(dlg.textContent).toContain('"autoload": false');
		expect(calls).toBe(1);
		fireEvent.click(within(dlg).getByTestId("folder-addon-remove-unowned-x"));
		await waitFor(() => expect(calls).toBe(2));
		const bodies = togglePosts().map(([, i]) => JSON.parse(String(i.body)));
		expect(bodies).toEqual([
			{ scope: "local", cwd: CWD, enabled: true },
			{ scope: "local", cwd: CWD, enabled: true, removeUnowned: true },
		]);
		await waitFor(() => expect(screen.queryByTestId("folder-addon-notowned-x")).toBeNull());
	});

	it("a 403 trustRequired opens the trust dialog; approving records the decision and retries the toggle", async () => {
		let first = true;
		const features = [mk("a", "A", "inherited")];
		state = {
			features,
			toggle: () => {
				if (first) {
					first = false;
					return {
						status: 403,
						body: {
							success: false,
							error: "Choose how to trust this folder.",
							data: { trustRequired: true, trustOptions: [{ id: "trust", label: "Trust", trusted: true }, { id: "decline", label: "Do not trust", trusted: false }], implicitlyTrusted: false },
						},
					};
				}
				features[0] = mk("a", "A", "off-here");
				return { status: 200, body: { success: true, changed: true, keptOn: [], notOwned: [] } };
			},
		};
		render(<PackagesPage cwd={CWD} />);
		fireEvent.click(await screen.findByTestId("folder-addon-switch-a"));
		const backdrop = await screen.findByTestId("resource-trust-backdrop");
		expect(backdrop).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /^Trust$/ }));
		await waitFor(() => expect(text("folder-addon-state-a")).toBe("off in this folder"));
		const trustCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/resources/trust"));
		expect(JSON.parse(String(trustCall?.[1].body))).toEqual({ cwd: CWD, optionId: "trust" });
		expect(togglePosts()).toHaveLength(2);
	});

	// review B1: a confirmed removal must survive the trust detour
	it("a confirmed removeUnowned retry keeps its flag through the trust dialog", async () => {
		const entry = { source: "npm:x", autoload: false, extensions: [], skills: [], prompts: [], themes: [] };
		const trustPrompt = {
			status: 403,
			body: {
				success: false,
				error: "trust?",
				data: { trustRequired: true, trustOptions: [{ id: "trust", label: "Trust", trusted: true }], implicitlyTrusted: false },
			},
		};
		let trusted = false;
		state = {
			features: [mk("x", "Pkg X", "off-here")],
			toggle: (body) => {
				if (body.removeUnowned) {
					return trusted ? { status: 200, body: { success: true, changed: true, keptOn: [], notOwned: [], removed: ["npm:x"] } } : trustPrompt;
				}
				return { status: 200, body: { success: true, changed: false, keptOn: [], notOwned: [{ source: "npm:x", reason: "no-record", entry }] } };
			},
			trust: () => {
				trusted = true;
				return { status: 200, body: { success: true, data: { trusted: true } } };
			},
		};
		render(<PackagesPage cwd={CWD} />);
		fireEvent.click(await screen.findByTestId("folder-addon-switch-x"));
		fireEvent.click(await screen.findByTestId("folder-addon-remove-unowned-x"));
		await screen.findByTestId("resource-trust-backdrop");
		fireEvent.click(screen.getByRole("button", { name: /^Trust$/ }));
		await waitFor(() => expect(screen.queryByTestId("folder-addon-notowned-x")).toBeNull());
		const bodies = togglePosts().map(([, i]) => JSON.parse(String(i.body)));
		expect(bodies).toEqual([
			{ scope: "local", cwd: CWD, enabled: true },
			{ scope: "local", cwd: CWD, enabled: true, removeUnowned: true },
			{ scope: "local", cwd: CWD, enabled: true, removeUnowned: true },
		]);
	});

	it("declining the trust dialog writes nothing and leaves the switch alone", async () => {
		state = {
			features: [mk("a", "A", "inherited")],
			toggle: () => ({
				status: 403,
				body: { success: false, error: "trust?", data: { trustRequired: true, trustOptions: [{ id: "decline", label: "Do not trust", trusted: false }], implicitlyTrusted: false } },
			}),
		};
		render(<PackagesPage cwd={CWD} />);
		fireEvent.click(await screen.findByTestId("folder-addon-switch-a"));
		await screen.findByTestId("resource-trust-backdrop");
		fireEvent.click(screen.getByRole("button", { name: /Do not trust/ }));
		await waitFor(() => expect(screen.queryByTestId("resource-trust-backdrop")).toBeNull());
		expect(togglePosts()).toHaveLength(1);
		expect(screen.getByTestId("folder-addon-switch-a").getAttribute("aria-checked")).toBe("true");
	});
});

describe("folder Add-ons page — rows and groups", () => {
	// test-plan #F6
	it("renders partly-off, off-globally, plugin-backed off rows, bridge as a chip only, and collapses Dashboard-only", async () => {
		state = {
			features: [
				mk("partly", "Partly", "partly-off-here"),
				mk("gone", "Gone", "off-globally", { state: "off" }),
				mk("plug", "Plug", "off-here", {
					kind: "agent-and-dashboard",
					plugin: { id: "plug", enabled: true, loaded: true, hasSettings: false, missingRequirements: [], dependsOn: [] },
					bridge: { path: "/x/bridge.ts" },
					packageAgents: 3,
				}),
				mk("ui", "Only UI", "dashboard-only", { packages: [], kind: "dashboard-only" }),
			],
		};
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-partly");
		expect(screen.getByTestId("folder-addon-switch-partly").getAttribute("aria-checked")).toBe("mixed");
		expect(text("folder-addon-state-partly")).toBe("partly off here");
		const gone = screen.getByTestId("folder-addon-switch-gone") as HTMLButtonElement;
		expect(gone.disabled).toBe(true);
		expect(text("folder-addon-global-off-gone")).toContain("turned off globally");
		expect(text("folder-addon-plugin-note-plug")).toContain("dashboard UI stays");
		expect(text("folder-addon-agents-note-plug")).toContain("3 agents");
		expect(screen.getByTestId("folder-addon-row-plug").textContent).toContain("bridge");
		expect(screen.queryByTestId("folder-addon-row-ui")).toBeNull();
		const details = screen.getByTestId("folder-group-dashboard-only") as HTMLDetailsElement;
		expect(details.open).toBe(false);
		expect(details.textContent).toContain("Only UI");
	});

	it("never renders a core feature or a bridge feature as a row", async () => {
		state = { features: [mk("core:pi", "pi", undefined, { kind: "core", packages: [] }), mk("a", "A", "inherited")] };
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-a");
		expect(screen.queryByTestId("folder-addon-row-core:pi")).toBeNull();
	});

	// test-plan #F7
	it("filter chips and the text filter narrow the groups", async () => {
		state = {
			features: [
				mk("here", "Here One", "added-here"),
				mk("off1", "Off One", "off-here"),
				mk("off2", "Off Two", "off-here"),
				...Array.from({ length: 5 }, (_, i) => mk(`inh${i}`, i === 0 ? "Web Thing" : `Inherited ${i}`, "inherited")),
			],
		};
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-off1");
		const count = () => document.querySelectorAll('[data-testid^="folder-addon-row-"], [data-testid^="folder-added-row-"]').length;
		expect(count()).toBe(8);
		fireEvent.click(screen.getByTestId("folder-chip-added"));
		expect(count()).toBe(1);
		fireEvent.click(screen.getByTestId("folder-chip-added"));
		fireEvent.click(screen.getByTestId("folder-chip-off"));
		expect(count()).toBe(2);
		fireEvent.click(screen.getByTestId("folder-chip-off"));
		fireEvent.change(screen.getByTestId("folder-addons-filter-input"), { target: { value: "web" } });
		expect(count()).toBe(1);
		expect(screen.getByTestId("folder-addon-row-inh0")).toBeTruthy();
	});

	// test-plan #F8
	it("keeps update + uninstall for a folder package and shows one 'Your files in .pi/' row linking to Resources", async () => {
		state = {
			features: [
				mk("local-pkg", "Folder Pkg", "added-here", {
					packages: [{ source: "npm:local-pkg", scope: "project", identity: "npm:local-pkg", sourceKind: "npm", entryOff: false, version: "1.2.3", contents: { extensions: 3, skills: 0, prompts: 0, themes: 0 } }],
					loading: { loaded: 1, total: 3 },
				}),
			],
			loose: LOOSE,
		};
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-added-row-local-pkg");
		expect(text("folder-added-loading-local-pkg")).toContain("only 1 of its 3");
		fireEvent.click(screen.getByTestId("folder-added-update-local-pkg"));
		expect(ops.update).toHaveBeenCalledWith("npm:local-pkg");
		fireEvent.click(screen.getByTestId("folder-added-uninstall-local-pkg"));
		expect(ops.remove).toHaveBeenCalledWith("npm:local-pkg");
		const files = screen.getByTestId("folder-own-files-row");
		expect(files.textContent).toContain("Your files in .pi/");
		expect(text("folder-own-files-counts")).toContain("29 skills");
		expect(screen.getByTestId("folder-own-files-link").getAttribute("href")).toMatch(/\/folder\/.+\/settings\/skills$/);
	});

	it("a global feature added here shows no uninstall (it lives in the global settings)", async () => {
		state = { features: [mk("self", "Self", "added-here")] };
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-added-row-self");
		expect(screen.queryByTestId("folder-added-uninstall-self")).toBeNull();
	});

	it("shows the project settings error", async () => {
		state = { features: [], settingsError: "Unexpected end of JSON" };
		render(<PackagesPage cwd={CWD} />);
		expect((await screen.findByTestId("folder-addons-settings-error")).textContent).toContain("Unexpected end of JSON");
	});
});

describe("folder Add-ons page — Discover", () => {
	// test-plan #F9
	it("installs a new recommended entry with folder scope as the default and turns an off-here one back on", async () => {
		state = {
			features: [
				mk("pkg:npm:pi-web-access", "Web Access", "off-here", { packages: [{ source: "npm:pi-web-access", scope: "user", identity: "npm:pi-web-access", sourceKind: "npm", entryOff: false, contents: { extensions: 1, skills: 0, prompts: 0, themes: 0 } }] }),
				mk("inh", "Inherited rec", "inherited", { packages: [{ source: "npm:@blackbelt-technology/pi-flows", scope: "user", identity: "npm:@blackbelt-technology/pi-flows", sourceKind: "npm", entryOff: false, contents: { extensions: 1, skills: 0, prompts: 0, themes: 0 } }] }),
			],
		};
		render(<PackagesPage cwd={CWD} />);
		await screen.findByTestId("folder-addon-row-pkg:npm:pi-web-access");
		fireEvent.click(screen.getByTestId("folder-addons-tab-discover"));
		const offHere = screen.getByTestId("folder-discover-off-here");
		expect(offHere.textContent).toContain("Web Access");
		expect(offHere.textContent).toContain("installed globally, off here");
		expect(offHere.textContent).not.toContain("Inherited rec");
		expect(screen.getByTestId("browser-stub").getAttribute("data-hide-installed")).toBe("true");

		// R1: install dialog defaults to folder scope
		fireEvent.click(screen.getByText("install-r1"));
		const local = screen.getByRole("radio", { name: /folder|local/i }) as HTMLInputElement;
		expect(local.checked).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));
		expect(ops.install).toHaveBeenCalledWith("npm:r1", "local");

		// R2: turn on here
		fireEvent.click(screen.getByTestId("folder-discover-turn-on-pkg:npm:pi-web-access"));
		await waitFor(() => expect(togglePosts()).toHaveLength(1));
		expect(JSON.parse(String(togglePosts()[0][1].body))).toEqual({ scope: "local", cwd: CWD, enabled: true });
	});
});
