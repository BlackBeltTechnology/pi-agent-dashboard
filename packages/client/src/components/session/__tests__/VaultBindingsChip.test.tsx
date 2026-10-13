/**
 * Per-session vault chip: hidden without bindings, lists names + states only,
 * explains revoked, offers confirmation for a pending checkout, and converges.
 * See change: add-credential-vault (task 6.8).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultBindingsChip } from "../VaultBindingsChip.js";

let payload: unknown;
let status = 200;
let calls: Array<{ url: string; method: string }>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  status = 200;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string }) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(status === 200 ? { success: true, data: payload } : { success: false }) });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("VaultBindingsChip", () => {
  it("renders nothing without bindings", async () => {
    payload = { bindings: [] };
    render(<VaultBindingsChip sessionId="s1" />);
    await flush();
    expect(screen.queryByTestId("vault-chip")).toBeNull();
  });

  it("renders nothing for an unknown session", async () => {
    status = 404;
    render(<VaultBindingsChip sessionId="zz" />);
    await flush();
    expect(screen.queryByTestId("vault-chip")).toBeNull();
  });

  it("F4: lists delivered, local-override and revoked rows with the running-process note, no values", async () => {
    payload = {
      bindings: [
        { name: "A_KEY", state: "delivered" },
        { name: "B_KEY", state: "local-override" },
        { name: "C_KEY", state: "revoked" },
      ],
      lastContactAt: 1_700_000_000_000,
    };
    render(<VaultBindingsChip sessionId="s1" />);
    await flush();
    fireEvent.click(screen.getByTestId("vault-chip"));
    const rows = screen.getAllByTestId("vault-binding-row");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["delivered", "local-override", "revoked"]);
    expect(screen.getAllByTestId("vault-revoked-note")).toHaveLength(1);
    expect(screen.getByTestId("vault-last-contact").textContent).toContain("Last vault contact");
    expect(document.body.textContent).not.toMatch(/secret|value=/i);
  });

  it("B2: shows a hub-unreachable row with its label", async () => {
    payload = { bindings: [{ name: "A_KEY", state: "hub-unreachable" }], lastContactAt: 1_700_000_000_000 };
    render(<VaultBindingsChip sessionId="s1" />);
    await flush();
    fireEvent.click(screen.getByTestId("vault-chip"));
    expect(screen.getByTestId("vault-binding-row").getAttribute("data-state")).toBe("hub-unreachable");
    expect(screen.getByTestId("vault-binding-state").textContent).toBe("Hub unreachable");
    expect(screen.getByTestId("vault-last-contact").textContent).toContain("Last vault contact");
  });

  it("F2: offers Confirm for a pending checkout and converges to delivered without a reload", async () => {
    payload = {
      bindings: [{ name: "A_KEY", state: "pending-confirmation" }],
      project: { deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" },
    };
    render(<VaultBindingsChip sessionId="s1" />);
    await flush();
    expect(screen.getByTestId("vault-chip").getAttribute("data-pending")).toBe("true");
    fireEvent.click(screen.getByTestId("vault-chip"));
    expect(screen.getByTestId("vault-pending-copy").textContent).toContain("github.com/acme/app");
    fireEvent.click(screen.getByTestId("vault-confirm"));
    await flush();
    expect(calls.some((c) => c.url === "/api/vault/confirmations" && c.method === "POST")).toBe(true);
    payload = { bindings: [{ name: "A_KEY", state: "delivered" }], project: { deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" } };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByTestId("vault-binding-row").getAttribute("data-state")).toBe("delivered");
    expect(screen.queryByTestId("vault-confirm")).toBeNull();
  });
});
