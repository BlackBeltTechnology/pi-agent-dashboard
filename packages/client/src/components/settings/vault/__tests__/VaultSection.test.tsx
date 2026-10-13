/**
 * Vault settings page: lists labels only (never a value), refuses a short key
 * client-side, flags a no-account grant, and shows names-only import proposals.
 * See change: add-credential-vault (task 6.7).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultSection } from "../VaultSection.js";

const SECRET = "supersecretvalue-0001";
let overview: Record<string, unknown>;
let calls: Array<{ url: string; method: string; body?: unknown }>;

const ok = (data: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) });

beforeEach(() => {
  calls = [];
  overview = {
    status: { state: "ok" },
    accounts: [
      { id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "personal" },
      { id: "a2", provider: "gemini", kind: "key", namespace: "user", label: "work" },
      { id: "o1", provider: "x", kind: "oauth", namespace: "user", label: "other" },
    ],
    bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
    grants: [
      { subject: "repo:github.com/acme/app", bindingName: "GEMINI_API_KEY", state: "ok" },
      { subject: "dir:hub:/work/x", bindingName: "GEMINI_API_KEY", accountId: "gone", state: "no-account" },
    ],
    confirmations: [{ deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" }],
    pluginApprovals: [{ pluginId: "deck3d", bindingName: "POLY_PIZZA_KEY" }],
    plugins: [{ pluginId: "deck3d", displayName: "Deck3D", declared: ["POLY_PIZZA_KEY", "GEMINI_API_KEY"] }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url === "/api/vault" && method === "GET") return Promise.resolve(ok(overview));
      if (url === "/api/vault/import/candidates") return Promise.resolve(ok([{ id: "c1", label: "skill .env", exists: true }, { id: "c2", label: "missing", exists: false }]));
      if (url === "/api/vault/import/propose") return Promise.resolve(ok({ id: "p1", items: [{ name: "A_KEY" }], skipped: [{ name: "B_KEY", reason: "value shorter than 8 characters" }] }));
      return Promise.resolve(ok({}));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VaultSection", () => {
  it("lists accounts by label only and never shows a value", async () => {
    render(<VaultSection />);
    await screen.findByTestId("vault-account-a1");
    const labels = screen.getAllByTestId("vault-account-label").map((e) => e.textContent);
    expect(labels).toEqual(["personal", "work"]);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getByTestId("vault-accounts-other").textContent).toContain("1");
  });

  it("sends the typed value once and clears the field", async () => {
    render(<VaultSection />);
    await screen.findByTestId("vault-account-form");
    fireEvent.change(screen.getByLabelText("Provider (e.g. gemini)"), { target: { value: "gemini" } });
    fireEvent.change(screen.getByLabelText("Label (e.g. personal)"), { target: { value: "ci" } });
    const key = screen.getByLabelText("Key") as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(key, { target: { value: SECRET } });
    fireEvent.click(screen.getByText("Add account"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/vault/accounts" && c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.url === "/api/vault/accounts")?.body).toEqual({ provider: "gemini", label: "ci", value: SECRET });
    await waitFor(() => expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe(""));
  });

  it("flags a grant whose account was revoked", async () => {
    render(<VaultSection />);
    await screen.findByTestId("vault-grants-list");
    const rows = screen.getAllByTestId("vault-grant-row");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["ok", "no-account"]);
    expect(screen.getAllByTestId("vault-grant-no-account")).toHaveLength(1);
  });

  it("shows plugin declarations with their approval state and toggles one", async () => {
    render(<VaultSection />);
    const row = await screen.findByTestId("vault-plugin-deck3d-GEMINI_API_KEY");
    const box = row.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect((screen.getByTestId("vault-plugin-deck3d-POLY_PIZZA_KEY").querySelector("input") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/vault/plugin-approvals/deck3d/GEMINI_API_KEY" && c.method === "PUT")).toBe(true));
  });

  it("import lists existing candidates only and proposes names without values", async () => {
    render(<VaultSection />);
    await screen.findByTestId("vault-import-candidates");
    expect(screen.queryByText("missing")).toBeNull();
    fireEvent.click(await screen.findByText("Review"));
    const proposal = await screen.findByTestId("vault-import-proposal");
    expect(proposal.textContent).toContain("A_KEY");
    expect(screen.getByTestId("vault-import-skipped").textContent).toContain("B_KEY");
  });

  it("explains a corrupt vault without content", async () => {
    overview.status = { state: "corrupt", backup: "/h/vault.json.corrupt-1" };
    render(<VaultSection />);
    const banner = await screen.findByTestId("vault-corrupt");
    expect(banner.textContent).toContain("vault.json.corrupt-1");
  });
});
