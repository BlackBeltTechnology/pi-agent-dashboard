/**
 * Updates tab: Update all enqueues FIFO. See change: addons-hub-feature-catalog (test-plan #E30).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddonsUpdatesTab } from "../packages/AddonsUpdatesTab.js";
import { feature, part } from "./addons-feature-fixtures.js";

afterEach(() => cleanup());

describe("AddonsUpdatesTab", () => {
	it("E30: Update all enqueues every updatable part then pi core, FIFO", () => {
		const calls: string[] = [];
		const features = [
			feature("pkg:npm:a", { displayName: "A", packages: [part("npm:a"), part("npm:a2")] }),
			feature("pkg:npm:b", { displayName: "B", packages: [part("npm:b")] }),
			feature("pkg:npm:c", { displayName: "C", packages: [part("npm:c")] }), // no update
		];
		render(
			<AddonsUpdatesTab
				features={features}
				updates={new Set(["npm:a", "npm:a2", "npm:b"])}
				corePackages={[
					{ name: "@earendil-works/pi-coding-agent", displayName: "pi", currentVersion: "1", latestVersion: "2", updateAvailable: true, installSource: "global" },
				]}
				statusFor={() => "idle"}
				coreSource={(n) => `pi-core:${n}`}
				onUpdatePart={(s) => calls.push(`part:${s}`)}
				onUpdateCore={(n) => calls.push(`core:${n}`)}
				renderPartRow={({ feature: f, part: p }) => <span data-testid={`row-${p.source}`}>{f.displayName}</span>}
				renderCoreRow={(p) => <span data-testid={`row-${p.name}`}>{p.displayName}</span>}
			/>,
		);
		expect(screen.queryByTestId("row-npm:c")).toBeNull();
		fireEvent.click(screen.getByTestId("addons-update-all"));
		expect(calls).toEqual(["part:npm:a", "part:npm:a2", "part:npm:b", "core:@earendil-works/pi-coding-agent"]);
	});

	it("says everything is up to date when nothing has an update", () => {
		render(
			<AddonsUpdatesTab
				features={[feature("pkg:npm:a", { packages: [part("npm:a")] })]}
				updates={new Set()}
				corePackages={[]}
				statusFor={() => "idle"}
				coreSource={(n) => n}
				onUpdatePart={vi.fn()}
				onUpdateCore={vi.fn()}
				renderPartRow={() => null}
				renderCoreRow={() => null}
			/>,
		);
		expect(screen.getByTestId("addons-updates-empty")).toBeTruthy();
	});

	it("does not claim everything is up to date before the first update check completes", () => {
		render(
			<AddonsUpdatesTab
				features={[feature("pkg:npm:a", { packages: [part("npm:a")] })]}
				updates={new Set()}
				checked={false}
				corePackages={[]}
				statusFor={() => "idle"}
				coreSource={(n) => n}
				onUpdatePart={vi.fn()}
				onUpdateCore={vi.fn()}
				renderPartRow={() => null}
				renderCoreRow={() => null}
			/>,
		);
		expect(screen.queryByTestId("addons-updates-empty")).toBeNull();
		expect(screen.getByTestId("addons-updates-pending")).toBeTruthy();
	});
});
