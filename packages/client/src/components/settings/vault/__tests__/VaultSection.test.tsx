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

// ── surface-operate-required-remedy ───────────────────────────────────────
describe("VaultSection — operate refusal callout", () => {
  const refusal = (remedies?: unknown[]) => ({
    ok: false,
    status: 403,
    json: () => Promise.resolve({ success: false, error: "operate_required", message: "the vault needs an operate-tier credential or a locally trusted caller", ...(remedies ? { reason: "no-credential", remedies } : {}) }),
  });
  /** `GET /api/vault` answers come from `queue`; the last entry repeats. */
  function stubVault(queue: Array<() => unknown>) {
    let i = 0;
    const fn = vi.fn((url: string) => {
      if (url === "/api/vault") return Promise.resolve(queue[Math.min(i++, queue.length - 1)]());
      return Promise.resolve(ok(url === "/api/vault/import/candidates" ? [] : {}));
    });
    vi.stubGlobal("fetch", fn);
    return () => fn.mock.calls.filter((c) => c[0] === "/api/vault").length;
  }

  it("F1 renders one row per remedy in server order, never the error line", async () => {
    for (const [remedies, expected] of [
      [["use-host"], ["use-host"]],
      [["use-host", "re-pair", "sign-in"], ["use-host", "re-pair", "sign-in"]],
      [["re-pair"], ["re-pair"]],
      [["use-host", "request-access"], ["use-host"]],
    ] as const) {
      stubVault([() => refusal([...remedies])]);
      const { unmount } = render(<VaultSection />);
      await screen.findByTestId("vault-operate-required");
      expect(screen.getAllByTestId("vault-operate-remedy").map((r) => r.getAttribute("data-remedy"))).toEqual(expected);
      expect(screen.queryByTestId("vault-error")).toBeNull();
      unmount();
    }
  });

  it("F2 is a polite status with a labelled list and a sign-in link to the login page", async () => {
    stubVault([() => refusal(["use-host", "sign-in"])]);
    render(<VaultSection />);
    const callout = await screen.findByTestId("vault-operate-required");
    expect(callout.getAttribute("role")).toBe("status");
    expect(screen.getByRole("list", { name: "What you can do" })).toBeTruthy();
    expect(screen.getByTestId("vault-operate-signin").getAttribute("href")).toBe("/auth/login");
    // no sign-in remedy ⇒ no link
    cleanup();
    stubVault([() => refusal(["use-host"])]);
    render(<VaultSection />);
    await screen.findByTestId("vault-operate-required");
    expect(screen.queryByTestId("vault-operate-signin")).toBeNull();
  });

  it("F3 keeps today's line for an older server (no remedies), a network error and a 500", async () => {
    const failures: Array<() => unknown> = [
      () => refusal(undefined),
      () => { throw new Error("socket closed"); },
      () => ({ ok: false, status: 500, json: () => Promise.resolve({ success: false, error: "internal", message: "internal error (see server.log)" }) }),
    ];
    for (const f of failures) {
      // a throwing entry must surface as a rejected fetch, as a network error does
      vi.stubGlobal("fetch", vi.fn(() => { try { return Promise.resolve(f()); } catch (e) { return Promise.reject(e); } }));
      const { unmount } = render(<VaultSection />);
      const line = await screen.findByTestId("vault-error");
      expect(line.textContent).toContain("Couldn't load the vault:");
      expect(screen.queryByTestId("vault-operate-required")).toBeNull();
      unmount();
    }
  });

  it("F4 retry success replaces the callout with the vault", async () => {
    stubVault([() => refusal(["use-host"]), () => ok(overview)]);
    render(<VaultSection />);
    fireEvent.click(await screen.findByTestId("vault-operate-retry"));
    await screen.findByTestId("vault-account-a1");
    expect(screen.queryByTestId("vault-operate-required")).toBeNull();
  });

  it("F5 retry is single-flight: one request, disabled + aria-busy while pending", async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { release = r; });
    let n = 0;
    const fn = vi.fn((url: string) => {
      if (url !== "/api/vault") return Promise.resolve(ok(url === "/api/vault/import/candidates" ? [] : {}));
      return n++ === 0 ? Promise.resolve(refusal(["use-host"])) : pending;
    });
    vi.stubGlobal("fetch", fn);
    render(<VaultSection />);
    const retry = await screen.findByTestId("vault-operate-retry");
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect((screen.getByTestId("vault-operate-retry") as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId("vault-operate-required").getAttribute("aria-busy")).toBe("true");
    expect(fn.mock.calls.filter((c) => c[0] === "/api/vault")).toHaveLength(2); // initial load + exactly one retry
    release(refusal(["use-host"]));
    await waitFor(() => expect((screen.getByTestId("vault-operate-retry") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("vault-operate-required").getAttribute("aria-busy")).toBe("false");
  });

  it("X2 a retry that fails on the network falls back to the existing error line", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url !== "/api/vault") return Promise.resolve(ok(url === "/api/vault/import/candidates" ? [] : {}));
      return n++ === 0 ? Promise.resolve(refusal(["use-host"])) : Promise.reject(new Error("socket closed"));
    }));
    render(<VaultSection />);
    fireEvent.click(await screen.findByTestId("vault-operate-retry"));
    const line = await screen.findByTestId("vault-error");
    expect(line.textContent).toContain("socket closed");
    expect(screen.queryByTestId("vault-operate-required")).toBeNull();
  });
});
