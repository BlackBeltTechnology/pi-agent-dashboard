/**
 * Vault Variables tab: one card per variable (default account, project rows with a status
 * pill, plugin approvals), new-variable validation, plugin requests, two-step delete.
 * See change: retro-ux-credential-vault (test-plan E16, E17, E18, E19, F5).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultOverview } from "../../../../lib/vault/vault-api.js";
import { VaultVariablesTab } from "../VaultVariablesTab.js";
import { type Call, callsTo, makeOverview, ok, stubVaultFetch } from "./vault-fixtures.js";

const acct = (id: string, provider: string, label: string) => ({ id, provider, kind: "key", namespace: "user", label });
const ACCOUNTS = [acct("a1", "gemini", "personal"), acct("a2", "gemini", "work")];

let current: VaultOverview;
let calls: Call[];

function Host() {
  const [ov, setOv] = useState(current);
  return <VaultVariablesTab overview={ov} onChanged={() => setOv({ ...current })} />;
}

beforeEach(() => {
  current = makeOverview({ accounts: ACCOUNTS, bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }] });
  calls = stubVaultFetch({ overview: () => current });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("E16 — a reserved name is caught at the field", () => {
  const create = (name: string) => {
    if (!screen.queryByLabelText("Variable name")) fireEvent.click(screen.getByTestId("vault-variable-new"));
    fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: name } });
    fireEvent.click(screen.getByTestId("vault-variable-create"));
  };
  it("PATH and NODE_OPTIONS are refused inline with a message naming them; MY_SERVICE_TOKEN is created", async () => {
    render(<Host />);
    for (const name of ["PATH", "NODE_OPTIONS"]) {
      create(name);
      const input = screen.getByLabelText("Variable name");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const message = document.getElementById(input.getAttribute("aria-describedby") ?? "");
      expect(message?.textContent).toContain(name);
      expect(message?.textContent).toMatch(/reserved/);
      expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(0);
    }
    create("MY_SERVICE_TOKEN");
    await waitFor(() => expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/api/vault/bindings")[0].body).toEqual({ name: "MY_SERVICE_TOKEN" });
  });

  it("a malformed name is refused with its own message", () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("vault-variable-new"));
    fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: "my token" } });
    fireEvent.click(screen.getByTestId("vault-variable-create"));
    expect(screen.getByLabelText("Variable name").getAttribute("aria-invalid")).toBe("true");
    expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(0);
  });
});

describe("E17 — status is text with an icon, never colour alone", () => {
  beforeEach(() => {
    current = makeOverview({
      accounts: ACCOUNTS,
      bindings: [
        { name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" },
        { name: "SONIOX_API_KEY", target: "env" },
      ],
      grants: [
        { subject: "dir:hub:/w/folder", bindingName: "GEMINI_API_KEY", state: "ok" },
        { subject: "repo:github.com/acme/with-checkout", bindingName: "GEMINI_API_KEY", state: "ok" },
        { subject: "repo:github.com/acme/no-checkout", bindingName: "GEMINI_API_KEY", state: "ok" },
        { subject: "dir:hub:/w/revoked", bindingName: "GEMINI_API_KEY", accountId: "gone", state: "no-account" },
        { subject: "dir:hub:/w/nodefault", bindingName: "SONIOX_API_KEY", state: "ok" },
      ],
      confirmations: [{ deviceId: "hub", dir: "/src/with-checkout", repoKey: "github.com/acme/with-checkout" }],
    });
  });

  it("maps every grant to its status; data-state stays the server's ok / no-account", () => {
    render(<Host />);
    const rows = screen.getAllByTestId("vault-grant-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["delivering", "delivering", "pending", "no-account", "no-default"]);
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["ok", "ok", "ok", "no-account", "ok"]);
    const texts = rows.map((r) => r.textContent ?? "");
    expect(texts[0]).toContain("Delivering");
    expect(texts[1]).toContain("Delivering");
    expect(texts[2]).toContain("Waiting for a checkout confirmation");
    expect(texts[2]).toMatch(/Vault chip/);
    expect(texts[3]).toContain("No account: delivers nothing");
    expect(texts[4]).toContain("Delivers nothing until the variable has a default");
    expect(screen.getAllByTestId("vault-grant-no-account")).toHaveLength(1);
    expect(screen.getAllByTestId("vault-grants-list")).toHaveLength(1);
    expect(within(screen.getByTestId("vault-grants-list")).getAllByTestId("vault-grant-row")).toHaveLength(5);
  });

  it("marks a variable without a default as needing an account", () => {
    render(<Host />);
    expect(within(screen.getByTestId("vault-binding-SONIOX_API_KEY")).getByTestId("vault-binding-repair").textContent).toContain("No default account");
    expect(within(screen.getByTestId("vault-binding-GEMINI_API_KEY")).queryByTestId("vault-binding-repair")).toBeNull();
  });

  it("repairs a no-account grant by choosing an account, or by falling back to the variable default", async () => {
    render(<Host />);
    const row = screen.getAllByTestId("vault-grant-row")[3];
    fireEvent.change(within(row).getByLabelText(/Account for revoked/), { target: { value: "a2" } });
    await waitFor(() => expect(callsTo(calls, "POST", "/api/vault/grants")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/api/vault/grants")[0].body).toEqual({ subject: "dir:hub:/w/revoked", bindingName: "GEMINI_API_KEY", accountId: "a2" });
    fireEvent.click(within(row).getByRole("button", { name: "Use variable default" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/api/vault/grants")).toHaveLength(2));
    expect(callsTo(calls, "POST", "/api/vault/grants")[1].body).toEqual({ subject: "dir:hub:/w/revoked", bindingName: "GEMINI_API_KEY" });
  });
});

describe("one card answers who gets a key", () => {
  beforeEach(() => {
    current = makeOverview({
      accounts: ACCOUNTS,
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
      grants: [
        { subject: "repo:github.com/acme/app", bindingName: "GEMINI_API_KEY", state: "ok" },
        { subject: "dir:hub:/work/scratch", bindingName: "GEMINI_API_KEY", accountId: "a2", state: "ok" },
      ],
      confirmations: [
        { deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" },
        { deviceId: "hub", dir: "/src/orphan", repoKey: "github.com/acme/other" },
      ],
    });
  });

  it("lists both projects with kind and account; the repository row lists its checkout with a revoke action", async () => {
    render(<Host />);
    const [repo, folder] = screen.getAllByTestId("vault-grant-row");
    expect(repo.textContent).toMatch(/Repository/);
    expect(repo.textContent).toContain("github.com/acme/app");
    expect(repo.textContent).toContain("variable default (gemini / personal)");
    expect(folder.textContent).toMatch(/Folder/);
    expect(folder.textContent).toContain("/work/scratch");
    expect(folder.textContent).toContain("gemini / work");
    const checkout = within(repo).getByTestId("vault-confirmation-row");
    expect(checkout.textContent).toContain("/src/app");
    fireEvent.click(within(checkout).getByRole("button", { name: /Revoke/ }));
    await waitFor(() => expect(callsTo(calls, "DELETE", "/api/vault/confirmations")).toHaveLength(1));
    expect(callsTo(calls, "DELETE", "/api/vault/confirmations")[0].body).toEqual({ deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" });
  });

  it("a confirmation that matches no grant is still listed, with a revoke action", async () => {
    render(<Host />);
    const list = screen.getByTestId("vault-confirmations-list");
    const rows = within(list).getAllByTestId("vault-confirmation-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("github.com/acme/other");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Revoke/ }));
    await waitFor(() => expect(callsTo(calls, "DELETE", "/api/vault/confirmations")).toHaveLength(1));
  });

  it("changing the default account shows its impact before saving", async () => {
    render(<Host />);
    const card = screen.getByTestId("vault-binding-GEMINI_API_KEY");
    fireEvent.change(within(card).getByLabelText("Default account"), { target: { value: "a2" } });
    expect(within(card).getByTestId("vault-binding-default-impact").textContent).toContain("Used by 1 project that doesn't pick its own account");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.click(within(card).getByRole("button", { name: "Save default" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")?.url).toBe("/api/vault/bindings/GEMINI_API_KEY/default");
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ accountId: "a2" });
  });

  it("removes a project from a variable", async () => {
    render(<Host />);
    fireEvent.click(within(screen.getAllByTestId("vault-grant-row")[1]).getByTestId("vault-grant-remove"));
    await waitFor(() => expect(callsTo(calls, "DELETE", "/api/vault/grants")).toHaveLength(1));
    expect(callsTo(calls, "DELETE", "/api/vault/grants")[0].body).toEqual({ subject: "dir:hub:/work/scratch", bindingName: "GEMINI_API_KEY" });
  });

  it("opens the project picker inside the card and closes it on Cancel", async () => {
    render(<Host />);
    const card = screen.getByTestId("vault-binding-GEMINI_API_KEY");
    fireEvent.click(within(card).getByTestId("vault-grant-open"));
    expect(await within(card).findByTestId("vault-grant-picker")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByTestId("vault-grant-picker")).toBeNull();
  });
});

describe("E18 — a subject of another kind is shown, not delivered", () => {
  it("shows the subject text and 'Not delivered to sessions', with no delivery status", () => {
    current = makeOverview({
      accounts: ACCOUNTS,
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
      grants: [{ subject: "service:svc-1", bindingName: "GEMINI_API_KEY", state: "ok" }],
    });
    render(<Host />);
    const row = screen.getByTestId("vault-grant-row");
    expect(row.textContent).toContain("service:svc-1");
    expect(row.textContent).toContain("Not delivered to sessions");
    expect(row.hasAttribute("data-status")).toBe(false);
    expect(row.textContent).not.toMatch(/Delivering|Waiting for a checkout/);
  });
});

describe("E19 — a plugin asks for a variable that does not exist", () => {
  beforeEach(() => {
    current = makeOverview({
      accounts: ACCOUNTS,
      bindings: [],
      plugins: [{ pluginId: "demo", displayName: "Demo Plugin", declared: ["POLY_PIZZA_KEY"] }],
      pluginApprovals: [{ pluginId: "demo", bindingName: "POLY_PIZZA_KEY" }],
    });
  });

  it("shows Create <NAME> and keeps the existing approval revocable", async () => {
    render(<Host />);
    expect(screen.getByTestId("vault-plugin-request").textContent).toContain("Create POLY_PIZZA_KEY");
    const row = screen.getByTestId("vault-plugin-demo-POLY_PIZZA_KEY");
    const box = within(row).getByTestId("vault-plugin-approve") as HTMLInputElement;
    expect(box.getAttribute("role")).toBe("switch");
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(callsTo(calls, "DELETE", "/api/vault/plugin-approvals/demo/POLY_PIZZA_KEY")).toHaveLength(1));
  });

  it("Create makes the binding with that name", async () => {
    render(<Host />);
    fireEvent.click(within(screen.getByTestId("vault-plugin-request")).getByRole("button", { name: "Create POLY_PIZZA_KEY" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/api/vault/bindings")[0].body).toEqual({ name: "POLY_PIZZA_KEY" });
  });

  it("a declaration of an existing variable is approved from its card", async () => {
    current = { ...current, bindings: [{ name: "POLY_PIZZA_KEY", target: "env", defaultAccountId: "a1" }], pluginApprovals: [] };
    render(<Host />);
    expect(screen.queryByTestId("vault-plugin-request")).toBeNull();
    const row = within(screen.getByTestId("vault-binding-POLY_PIZZA_KEY")).getByTestId("vault-plugin-demo-POLY_PIZZA_KEY");
    fireEvent.click(within(row).getByTestId("vault-plugin-approve"));
    await waitFor(() => expect(callsTo(calls, "PUT", "/api/vault/plugin-approvals/demo/POLY_PIZZA_KEY")).toHaveLength(1));
  });
});

describe("F5 — deleting a variable lists what it removes, read fresh", () => {
  const grant = (dir: string) => ({ subject: `dir:hub:/w/${dir}`, bindingName: "GEMINI_API_KEY", state: "ok" as const });
  beforeEach(() => {
    current = makeOverview({
      accounts: ACCOUNTS,
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
      grants: [grant("alpha"), grant("beta")],
      pluginApprovals: [{ pluginId: "demo", bindingName: "GEMINI_API_KEY" }],
    });
  });

  it("lists the projects of the re-read overview (3, not the 2 first shown); deletes only after Delete variable", async () => {
    const shown = { ...current };
    // The overview the card was rendered from has 2 grants; by the time Delete is pressed there are 3.
    const fresh = { ...current, grants: [grant("alpha"), grant("beta"), grant("gamma")] };
    calls = stubVaultFetch({ handler: (c) => (c.method === "GET" && c.url === "/api/vault" ? ok(fresh) : undefined) });
    function Static() {
      return <VaultVariablesTab overview={shown} onChanged={() => undefined} />;
    }
    render(<Static />);
    fireEvent.click(screen.getByTestId("vault-variable-delete"));
    const callout = await screen.findByTestId("vault-confirm-impact");
    await waitFor(() => expect(callout.textContent).toContain("gamma"));
    const text = callout.textContent ?? "";
    expect(text).toContain("3 projects");
    for (const name of ["alpha", "beta", "gamma"]) expect(text).toContain(name);
    expect(text).toMatch(/demo/);
    expect(text).toMatch(/within seconds/);
    expect(text).toMatch(/Processes already running keep the old value/);
    expect(callsTo(calls, "DELETE", "/api/vault/bindings/GEMINI_API_KEY")).toHaveLength(0);
    fireEvent.click(within(callout).getByRole("button", { name: "Delete variable" }));
    await waitFor(() => expect(callsTo(calls, "DELETE", "/api/vault/bindings/GEMINI_API_KEY")).toHaveLength(1));
  });

  it("Cancel sends no DELETE; a failed re-read disables Delete variable", async () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("vault-variable-delete"));
    const callout = await screen.findByTestId("vault-confirm-impact");
    fireEvent.click(within(callout).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("vault-confirm-impact")).toBeNull();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);

    stubVaultFetch({ handler: (c) => (c.method === "GET" && c.url === "/api/vault" ? (Promise.reject(new TypeError("Failed to fetch")) as unknown as Response) : undefined) });
    fireEvent.click(screen.getByTestId("vault-variable-delete"));
    const failed = await screen.findByTestId("vault-confirm-impact");
    await waitFor(() => expect(failed.textContent).toContain("Can't reach the dashboard server"));
    expect((within(failed).getByRole("button", { name: "Delete variable" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("empty states", () => {
  it("with no variables the tab says so and offers New variable", () => {
    current = makeOverview({ accounts: ACCOUNTS });
    render(<Host />);
    expect(screen.getByTestId("vault-variables-empty")).toBeTruthy();
    expect(screen.getByTestId("vault-variable-new")).toBeTruthy();
  });
});
