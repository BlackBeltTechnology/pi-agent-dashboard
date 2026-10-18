/**
 * AuditList RTL (change: add-browser-relay, task 4.2; test-plan F4).
 * A higher `browser_relay_status.auditSeq` refetches and surfaces a new
 * `denied` row; a repeated seq does NOT refetch.
 */
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditList } from "../AuditList.js";
import { renderWithPlugin } from "./test-utils.js";

function jsonOk(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ "content-type": "application/json" }),
		json: async () => body,
	} as unknown as Response;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("AuditList", () => {
	it("F4: refetches on a higher auditSeq and not on the same seq", async () => {
		let entries: unknown[] = [];
		const auditCalls: string[] = [];
		const fetchMock = vi.fn(async (url: string) => {
			auditCalls.push(url);
			return jsonOk({ entries });
		});
		(globalThis as { fetch?: unknown }).fetch = fetchMock;

		const { getByTestId, queryByTestId, ws } = renderWithPlugin(
			<AuditList profileDirectory="OSS" />,
		);
		await waitFor(() => expect(getByTestId("browser-audit-empty-OSS")).toBeTruthy());
		expect(auditCalls).toHaveLength(1);

		// First seq: no prior baseline, so it is treated as a change and refetches
		// once (at worst a redundant fetch; swallowing it lost real changes).
		act(() => ws.emit({ type: "browser_relay_status", instances: [], auditSeq: 5 }));
		await waitFor(() => expect(auditCalls).toHaveLength(2));

		// A denial lands: higher seq -> refetch -> the new row appears.
		entries = [
			{
				ts: 1_700_000_000_000,
				profileDirectory: "OSS",
				instanceId: "i1",
				kind: "denied",
				detail: "Network.getAllCookies",
			},
		];
		act(() => ws.emit({ type: "browser_relay_status", instances: [], auditSeq: 6 }));
		await waitFor(() => expect(getByTestId("browser-audit-row-OSS-0")).toBeTruthy());
		// human event word, never the raw `kind` token (spec "Audit viewer")
		expect(getByTestId("browser-audit-row-OSS-0").textContent).toContain("Denied");
		expect(getByTestId("browser-audit-row-OSS-0").textContent).not.toContain("denied");
		expect(getByTestId("browser-audit-row-OSS-0").textContent).toContain("Network.getAllCookies");
		expect(auditCalls).toHaveLength(3);

		// Same seq again: no refetch.
		act(() => ws.emit({ type: "browser_relay_status", instances: [], auditSeq: 6 }));
		expect(auditCalls).toHaveLength(3);
		expect(queryByTestId("browser-audit-row-OSS-0")).toBeTruthy();
	});

	it("#F11 detach causes and @dedicated rows render under their profiles when auditSeq bumps", async () => {
		const byProfile: Record<string, unknown[]> = { "Profile 21": [], "@dedicated": [] };
		const fetchMock = vi.fn(async (url: string) => {
			const profile = decodeURIComponent(new URL(url, "http://x.test").searchParams.get("profile") ?? "");
			return jsonOk({ entries: byProfile[profile] ?? [] });
		});
		(globalThis as { fetch?: unknown }).fetch = fetchMock;

		const { getByTestId, ws } = renderWithPlugin(
			<>
				<AuditList profileDirectory="Profile 21" />
				<AuditList profileDirectory="@dedicated" />
			</>,
		);
		await waitFor(() => expect(getByTestId("browser-audit-empty-Profile 21")).toBeTruthy());
		await waitFor(() => expect(getByTestId("browser-audit-empty-@dedicated")).toBeTruthy());

		byProfile["Profile 21"] = [
			{
				ts: 1_700_000_000_000,
				profileDirectory: "Profile 21",
				instanceId: "i1",
				kind: "detach",
				detail: "closed:All controlled tabs detached",
			},
		];
		byProfile["@dedicated"] = [
			{
				ts: 1_700_000_001_000,
				profileDirectory: "@dedicated",
				instanceId: "d1",
				kind: "denied",
				detail: "Browser.close",
			},
			{
				ts: 1_700_000_000_500,
				profileDirectory: "@dedicated",
				instanceId: "d1",
				kind: "detach",
				detail: "no-cdp-client",
			},
		];
		act(() => ws.emit({ type: "browser_relay_status", instances: [], auditSeq: 9 }));

		await waitFor(() => expect(getByTestId("browser-audit-row-Profile 21-0")).toBeTruthy());
		const detach = getByTestId("browser-audit-row-Profile 21-0").textContent ?? "";
		expect(detach).toContain("Disconnected");
		expect(detach).not.toMatch(/\bdetach\b/);
		expect(detach).toContain("closed:All controlled tabs detached");
		// Raw kind stays a machine hook on the pill, never visible text.
		expect(getByTestId("browser-audit-row-Profile 21-0").querySelector('[data-status="detach"]')).not.toBeNull();

		await waitFor(() => expect(getByTestId("browser-audit-row-@dedicated-0")).toBeTruthy());
		const denied = getByTestId("browser-audit-row-@dedicated-0").textContent ?? "";
		expect(denied).toContain("Denied");
		expect(denied).toContain("Browser.close");
		expect(getByTestId("browser-audit-row-@dedicated-1").textContent).toContain("no-cdp-client");
		// Rows live under their own profile's list only.
		expect(getByTestId("browser-audit-Profile 21").contains(getByTestId("browser-audit-row-@dedicated-0"))).toBe(false);
	});

	it("Activity group is collapsed by default; summary shows the entry count, or 'none yet'", async () => {
		let entries: unknown[] = [];
		(globalThis as { fetch?: unknown }).fetch = vi.fn(async () => jsonOk({ entries }));
		const first = renderWithPlugin(<AuditList profileDirectory="OSS" />);
		await waitFor(() => expect(first.getByTestId("browser-audit-empty-OSS")).toBeTruthy());
		const group = first.getByTestId("browser-audit-OSS") as HTMLDetailsElement;
		expect(group.tagName).toBe("DETAILS");
		expect(group.open).toBe(false);
		expect(group.querySelector("summary")?.textContent).toContain("Activity");
		expect(group.querySelector("summary")?.textContent).toContain("none yet");
		expect(first.getByTestId("browser-audit-empty-OSS").textContent).toBe("No activity yet.");
		first.unmount();

		entries = [
			{ ts: 1_700_000_000_000, profileDirectory: "OSS", instanceId: "i1", kind: "attach", detail: "2 tabs" },
			{ ts: 1_700_000_000_500, profileDirectory: "OSS", instanceId: "i1", kind: "viewer-input", detail: "click" },
		];
		const second = renderWithPlugin(<AuditList profileDirectory="OSS" />);
		await waitFor(() => expect(second.getByTestId("browser-audit-row-OSS-0")).toBeTruthy());
		const g2 = second.getByTestId("browser-audit-OSS") as HTMLDetailsElement;
		expect(g2.open).toBe(false);
		expect(g2.querySelector("summary")?.textContent).toContain("2 entries");
		// a table with column headers; event words are human, never raw kind tokens
		expect(Array.from(g2.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["When", "Event", "Detail"]);
		expect(second.getByTestId("browser-audit-row-OSS-0").textContent).toContain("Connected");
		expect(second.getByTestId("browser-audit-row-OSS-0").textContent).not.toContain("attach");
		expect(second.getByTestId("browser-audit-row-OSS-1").textContent).not.toContain("viewer-input");
	});
});
