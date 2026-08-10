import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { PackageInstallConfirmDialog } from "../packages/PackageInstallConfirmDialog.js";

afterEach(() => cleanup());

describe("PackageInstallConfirmDialog", () => {
	const baseProps = {
		source: "npm:pi-flows",
		packageName: "pi-flows",
		onConfirm: () => {},
		onCancel: () => {},
	};

	it("hides scope radio when lockScope is set", () => {
		render(<PackageInstallConfirmDialog {...baseProps} scope="global" lockScope="global" />);
		expect(screen.queryByTestId("package-install-scope-picker")).toBeNull();
		// Static "Scope: Global" line is still present in the summary block
		expect(screen.getByText("Global")).toBeTruthy();
	});

	it("shows scope radio when lockScope is undefined and onScopeChange provided", () => {
		render(
			<PackageInstallConfirmDialog
				{...baseProps}
				scope="local"
				onScopeChange={() => {}}
			/>,
		);
		expect(screen.getByTestId("package-install-scope-picker")).toBeTruthy();
		expect(screen.getByTestId("package-install-scope-local")).toBeTruthy();
		expect(screen.getByTestId("package-install-scope-global")).toBeTruthy();
	});

	it("hides scope radio when onScopeChange is missing (controlled-but-readonly)", () => {
		render(<PackageInstallConfirmDialog {...baseProps} scope="local" />);
		expect(screen.queryByTestId("package-install-scope-picker")).toBeNull();
	});

	it("default selection follows the `scope` prop", () => {
		render(
			<PackageInstallConfirmDialog
				{...baseProps}
				scope="local"
				onScopeChange={() => {}}
			/>,
		);
		const localRadio = screen
			.getByTestId("package-install-scope-local")
			.querySelector('input[type="radio"]') as HTMLInputElement;
		const globalRadio = screen
			.getByTestId("package-install-scope-global")
			.querySelector('input[type="radio"]') as HTMLInputElement;
		expect(localRadio.checked).toBe(true);
		expect(globalRadio.checked).toBe(false);
	});

	it("fires onScopeChange when user picks the other scope", () => {
		const onScopeChange = vi.fn();
		render(
			<PackageInstallConfirmDialog
				{...baseProps}
				scope="local"
				onScopeChange={onScopeChange}
			/>,
		);
		const globalRadio = screen
			.getByTestId("package-install-scope-global")
			.querySelector('input[type="radio"]') as HTMLInputElement;
		fireEvent.click(globalRadio);
		expect(onScopeChange).toHaveBeenCalledWith("global");
	});

	it("Cancel button fires onCancel", () => {
		const onCancel = vi.fn();
		render(
			<PackageInstallConfirmDialog {...baseProps} scope="global" lockScope="global" onCancel={onCancel} />,
		);
		fireEvent.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("Install button fires onConfirm", () => {
		const onConfirm = vi.fn();
		render(
			<PackageInstallConfirmDialog {...baseProps} scope="global" lockScope="global" onConfirm={onConfirm} />,
		);
		fireEvent.click(screen.getByText("Install"));
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("end-to-end: chosen scope flows through to the install handler", () => {
		// Pins the spec scenario "Confirming with selected scope" — verifies that
		// the radio selection is what the install action receives, simulating the
		// real `<PiResourcesView>` wiring (lifted state + onScopeChange + onConfirm).
		const capturedScopes: string[] = [];

		function Harness() {
			const [scope, setScope] = React.useState<"global" | "local">("local");
			return (
				<PackageInstallConfirmDialog
					{...baseProps}
					scope={scope}
					onScopeChange={setScope}
					onConfirm={() => capturedScopes.push(scope)}
				/>
			);
		}

		render(<Harness />);

		// Default selection is "local" → confirm immediately.
		fireEvent.click(screen.getByText("Install"));
		expect(capturedScopes).toEqual(["local"]);

		// Switch to global, confirm again → install action sees the new scope.
		const globalRadio = screen
			.getByTestId("package-install-scope-global")
			.querySelector('input[type="radio"]') as HTMLInputElement;
		fireEvent.click(globalRadio);
		fireEvent.click(screen.getByText("Install"));
		expect(capturedScopes).toEqual(["local", "global"]);
	});
});
