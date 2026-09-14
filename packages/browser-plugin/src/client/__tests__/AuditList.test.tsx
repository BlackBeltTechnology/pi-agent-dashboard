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

		// Baseline seq: establishes the ref, no refetch.
		act(() => ws.emit({ type: "browser_relay_status", instances: [], auditSeq: 5 }));
		expect(auditCalls).toHaveLength(1);

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
		expect(getByTestId("browser-audit-row-OSS-0").textContent).toContain("denied");
		expect(getByTestId("browser-audit-row-OSS-0").textContent).toContain("Network.getAllCookies");
		expect(auditCalls).toHaveLength(2);

		// Same seq again: no refetch.
		act(() => ws.emit({ type: "browser_relay_status", instances: [], auditSeq: 6 }));
		expect(auditCalls).toHaveLength(2);
		expect(queryByTestId("browser-audit-row-OSS-0")).toBeTruthy();
	});
});
