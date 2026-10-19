/**
 * Vault Accounts tab: combined key + variable creation, field validation, usage lines,
 * two-step revoke with a fresh impact read, kind sections.
 * See change: retro-ux-credential-vault (test-plan E14, E15, F6, X4, X9).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultOverview } from "../../../../lib/vault/vault-api.js";
import { VaultAccountsPanel } from "../VaultAccountsPanel.js";
import { type Call, callsTo, fail, makeOverview, ok, stubVaultFetch } from "./vault-fixtures.js";

const SECRET = "supersecretvalue-0001";
const acct = (id: string, provider: string, label: string, extra: Record<string, string> = {}) => ({ id, provider, kind: "key", namespace: "user", label, ...extra });

/** The panel's `overview` follows `current`, which the fetch handlers mutate (as the server would). */
let current: VaultOverview;
let calls: Call[];
const onChanged = vi.fn();

function Host() {
  const [ov, setOv] = useState(current);
  return (
    <VaultAccountsPanel
      overview={ov}
      onChanged={async () => {
        onChanged();
        setOv({ ...current });
      }}
    />
  );
}

const openForm = () => fireEvent.click(screen.getByTestId("vault-account-new"));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

beforeEach(() => {
  onChanged.mockClear();
  current = makeOverview({ accounts: [acct("a1", "gemini", "personal"), acct("a2", "gemini", "work")] });
  calls = stubVaultFetch({ overview: () => current });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("E14 — the variable offered with a new key", () => {
  const cases: Array<{ name: string; provider: string; patch: Partial<VaultOverview>; mode: "create" | "default" | null; variable?: string }> = [
    { name: "new provider offers its variable, ticked", provider: "assemblyai", patch: {}, mode: "create", variable: "ASSEMBLYAI_API_KEY" },
    { name: "a reserved derived name (NODE_ prefix) offers nothing", provider: "node", patch: {}, mode: null },
    { name: "provider words become underscores", provider: "Google Gemini", patch: {}, mode: "create", variable: "GOOGLE_GEMINI_API_KEY" },
    {
      name: "an existing variable of the same provider offers make-default, unticked",
      provider: "gemini",
      patch: { bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }] },
      mode: "default",
      variable: "GEMINI_API_KEY",
    },
    {
      name: "an existing variable whose default is another provider offers nothing",
      provider: "gemini",
      patch: {
        accounts: [acct("a1", "gemini", "personal"), acct("o1", "openai", "work")],
        bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "o1" }],
      },
      mode: null,
    },
    {
      name: "an existing variable with no default offers make-default",
      provider: "gemini",
      patch: { bindings: [{ name: "GEMINI_API_KEY", target: "env" }] },
      mode: "default",
      variable: "GEMINI_API_KEY",
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      current = { ...current, ...c.patch };
      render(<Host />);
      openForm();
      type("Provider", c.provider);
      const option = screen.queryByTestId("vault-account-variable");
      if (c.mode === null) return expect(option).toBeNull();
      expect(option?.getAttribute("data-mode")).toBe(c.mode);
      expect(option?.textContent).toContain(c.variable);
      expect((screen.getByTestId("vault-account-variable-toggle") as HTMLInputElement).checked).toBe(c.mode === "create");
    });
  }

  it("make-default shows the impact line with the projects that use the default", () => {
    current = {
      ...current,
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
      grants: [
        { subject: "repo:github.com/acme/a", bindingName: "GEMINI_API_KEY", state: "ok" },
        { subject: "dir:hub:/w/b", bindingName: "GEMINI_API_KEY", state: "ok" },
        { subject: "dir:hub:/w/c", bindingName: "GEMINI_API_KEY", accountId: "a2", state: "ok" },
      ],
    };
    render(<Host />);
    openForm();
    type("Provider", "gemini");
    expect(screen.getByTestId("vault-account-variable-impact").textContent).toContain("Used by 2 projects that don't pick their own account");
  });

  async function addKey(provider: string, label = "main") {
    openForm();
    type("Provider", provider);
    type("Label", label);
    type("Key", SECRET);
    fireEvent.click(screen.getByTestId("vault-account-submit"));
  }
  const accountPosts = () => callsTo(calls, "POST", "/api/vault/accounts");

  it("keeping the offered option creates the account, then the variable with it as default", async () => {
    calls = stubVaultFetch({
      overview: () => current,
      handler: (c) => {
        if (c.method === "POST" && c.url === "/api/vault/accounts") {
          current = { ...current, accounts: [...current.accounts, acct("new1", "assemblyai", "main")] };
          return ok(acct("new1", "assemblyai", "main"));
        }
        return undefined;
      },
    });
    render(<Host />);
    await addKey("assemblyai");
    await waitFor(() => expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(1));
    expect(accountPosts()[0].body).toEqual({ provider: "assemblyai", label: "main", value: SECRET });
    expect(callsTo(calls, "POST", "/api/vault/bindings")[0].body).toEqual({ name: "ASSEMBLYAI_API_KEY", defaultAccountId: "new1" });
  });

  it("an existing variable keeps its default unless the option is ticked", async () => {
    current = { ...current, bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }] };
    calls = stubVaultFetch({
      overview: () => current,
      handler: (c) => (c.method === "POST" && c.url === "/api/vault/accounts" ? ok(acct("new2", "gemini", "main")) : undefined),
    });
    render(<Host />);
    await addKey("gemini");
    await waitFor(() => expect(accountPosts()).toHaveLength(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(0);

    type("Provider", "gemini"); // the form was cleared after the first key
    fireEvent.click(screen.getByTestId("vault-account-variable-toggle"));
    type("Key", SECRET);
    type("Label", "second");
    fireEvent.click(screen.getByTestId("vault-account-submit"));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")?.url).toBe("/api/vault/bindings/GEMINI_API_KEY/default");
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ accountId: "new2" });
  });
});

describe("E15 — the key must have 8 characters", () => {
  it("7 characters: the field is invalid with a message and nothing is sent; 8 characters: one POST", async () => {
    render(<Host />);
    openForm();
    type("Provider", "soniox");
    type("Label", "personal");
    type("Key", "1234567");
    fireEvent.click(screen.getByTestId("vault-account-submit"));
    const key = field("Key");
    expect(key.getAttribute("aria-invalid")).toBe("true");
    const described = document.getElementById(key.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toMatch(/at least 8 characters/);
    expect(callsTo(calls, "POST", "/api/vault/accounts")).toHaveLength(0);

    type("Key", "12345678");
    expect(field("Key").getAttribute("aria-invalid")).not.toBe("true");
    fireEvent.click(screen.getByTestId("vault-account-submit"));
    await waitFor(() => expect(callsTo(calls, "POST", "/api/vault/accounts")).toHaveLength(1));
  });

  it("sends the typed value once, clears the field and can reveal it before sending", async () => {
    render(<Host />);
    openForm();
    type("Provider", "gemini");
    type("Label", "ci");
    expect(field("Key").type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show key" }));
    expect(field("Key").type).toBe("text");
    type("Key", SECRET);
    fireEvent.click(screen.getByTestId("vault-account-submit"));
    await waitFor(() => expect(field("Key").value).toBe(""));
    expect(callsTo(calls, "POST", "/api/vault/accounts")).toHaveLength(1);
    expect(field("Key").type).toBe("password");
    expect(document.body.textContent).not.toContain(SECRET);
  });
});

describe("X4 — a partial failure is reported and its retry is idempotent", () => {
  it("says the key was saved, keeps the account, and Retry succeeds without a second account POST", async () => {
    calls = stubVaultFetch({
      overview: () => current,
      handler: (c) => {
        if (c.method === "POST" && c.url === "/api/vault/accounts") {
          current = { ...current, accounts: [...current.accounts, acct("new1", "assemblyai", "personal")] };
          return ok(acct("new1", "assemblyai", "personal"));
        }
        if (c.method === "POST" && c.url === "/api/vault/bindings") return fail(409, "conflict", "Binding already exists");
        return undefined;
      },
    });
    render(<Host />);
    openForm();
    type("Provider", "assemblyai");
    type("Label", "personal");
    type("Key", SECRET);
    fireEvent.click(screen.getByTestId("vault-account-submit"));
    const partial = await screen.findByTestId("vault-account-partial");
    expect(partial.textContent).toContain("Key saved; the variable wasn't created");
    expect(partial.textContent).toContain("Binding already exists");
    expect(screen.getByTestId("vault-account-new1")).toBeTruthy();

    // Another request created the variable with this account as default, then the user retries.
    current = { ...current, bindings: [{ name: "ASSEMBLYAI_API_KEY", target: "env", defaultAccountId: "new1" }] };
    fireEvent.click(within(partial).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByTestId("vault-account-partial")).toBeNull());
    expect(callsTo(calls, "POST", "/api/vault/accounts")).toHaveLength(1);
    expect(callsTo(calls, "POST", "/api/vault/bindings")).toHaveLength(1);
  });
});

describe("usage lines, rotate note, kind sections", () => {
  it("each account says what uses it", () => {
    current = {
      ...current,
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
      grants: [{ subject: "dir:hub:/w/x", bindingName: "GEMINI_API_KEY", accountId: "a2", state: "ok" }],
    };
    render(<Host />);
    expect(screen.getByTestId("vault-account-a1").textContent).toContain("Default for GEMINI_API_KEY");
    expect(screen.getByTestId("vault-account-a2").textContent).toContain("Chosen by 1 project");
    cleanup();
    current = makeOverview({ accounts: [acct("a9", "soniox", "personal")] });
    render(<Host />);
    expect(screen.getByTestId("vault-account-a9").textContent).toContain("Not used by any variable");
  });

  it("rotate states that running processes keep the old value", () => {
    render(<Host />);
    fireEvent.click(within(screen.getByTestId("vault-account-a1")).getByTestId("vault-account-rotate"));
    expect(screen.getByTestId("vault-account-a1").textContent).toMatch(/Running processes keep the old one/);
    expect((screen.getByLabelText(/New value for gemini \/ personal/) as HTMLInputElement).type).toBe("password");
  });

  it("Sign-in accounts and Services appear only when such accounts exist; other kinds stay a count", () => {
    render(<Host />);
    expect(screen.queryByTestId("vault-accounts-signin")).toBeNull();
    expect(screen.queryByTestId("vault-accounts-services")).toBeNull();
    expect(screen.queryByTestId("vault-accounts-other")).toBeNull();
    cleanup();
    current = makeOverview({
      accounts: [
        acct("a1", "gemini", "personal"),
        { id: "o1", provider: "anthropic", kind: "oauth", namespace: "user", label: "pro" },
        { id: "s1", provider: "svc", kind: "key", namespace: "service:svc-1", label: "svc token" },
        { id: "m1", provider: "x", kind: "mystery", namespace: "user", label: "odd" },
      ],
    });
    render(<Host />);
    expect(within(screen.getByTestId("vault-accounts-signin")).getByTestId("vault-account-o1")).toBeTruthy();
    expect(within(screen.getByTestId("vault-accounts-services")).getByTestId("vault-account-s1")).toBeTruthy();
    expect(screen.getByTestId("vault-accounts-other").textContent).toContain("1");
    expect(screen.queryByTestId("vault-account-m1")).toBeNull();
  });
});

describe("revoke — two steps with a fresh impact read", () => {
  beforeEach(() => {
    current = makeOverview({
      accounts: [acct("a1", "gemini", "personal"), acct("a2", "gemini", "work")],
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a2" }],
      grants: [
        { subject: "repo:github.com/robson/deck3d", bindingName: "GEMINI_API_KEY", accountId: "a2", state: "ok" },
        { subject: "dir:hub:/Users/robson/Movies/video-feliratozas", bindingName: "GEMINI_API_KEY", accountId: "a2", state: "ok" },
      ],
      pluginApprovals: [{ pluginId: "demo", bindingName: "GEMINI_API_KEY" }],
    });
  });

  it("F6 — Cancel takes focus on open; Escape closes the callout and returns focus to the Revoke trigger", async () => {
    render(<Host />);
    const trigger = within(screen.getByTestId("vault-account-a2")).getByTestId("vault-account-revoke");
    trigger.focus();
    fireEvent.click(trigger);
    const callout = await screen.findByTestId("vault-confirm-impact");
    expect(callout.getAttribute("role")).toBe("alertdialog");
    const cancel = within(callout).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.keyDown(callout, { key: "Escape" });
    expect(screen.queryByTestId("vault-confirm-impact")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("names the projects, the no-fallback rule, the plugin approvals and the running-process note; Cancel changes nothing", async () => {
    render(<Host />);
    fireEvent.click(within(screen.getByTestId("vault-account-a2")).getByTestId("vault-account-revoke"));
    const callout = await screen.findByTestId("vault-confirm-impact");
    await waitFor(() => expect(within(callout).getByRole("button", { name: "Revoke account" }).hasAttribute("disabled")).toBe(false));
    const text = callout.textContent ?? "";
    expect(text).toContain("deck3d");
    expect(text).toContain("video-feliratozas");
    expect(text).toMatch(/does not fall back to the variable's default/);
    expect(text).toContain("GEMINI_API_KEY");
    expect(text).toMatch(/demo/);
    expect(text).toMatch(/Running processes keep the old value/);
    fireEvent.click(within(callout).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("vault-confirm-impact")).toBeNull();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("revokes only after the second step", async () => {
    render(<Host />);
    fireEvent.click(within(screen.getByTestId("vault-account-a2")).getByTestId("vault-account-revoke"));
    const callout = await screen.findByTestId("vault-confirm-impact");
    const confirm = within(callout).getByRole("button", { name: "Revoke account" });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(callsTo(calls, "DELETE", "/api/vault/accounts/a2")).toHaveLength(1));
  });

  it("X9 — a failed re-read shows the error, disables Revoke account, Retry re-reads, Cancel works, nothing is deleted", async () => {
    let failing = true;
    let overviewReads = 0;
    calls = stubVaultFetch({
      handler: (c) => {
        if (c.method === "GET" && c.url === "/api/vault") {
          overviewReads += 1;
          if (failing) return Promise.reject(new TypeError("Failed to fetch")) as unknown as Response;
          return ok(current);
        }
        return undefined;
      },
    });
    render(<Host />);
    fireEvent.click(within(screen.getByTestId("vault-account-a2")).getByTestId("vault-account-revoke"));
    const callout = await screen.findByTestId("vault-confirm-impact");
    await waitFor(() => expect(callout.textContent).toContain("Can't reach the dashboard server"));
    const confirm = within(callout).getByRole("button", { name: "Revoke account" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const readsBefore = overviewReads;
    failing = false;
    fireEvent.click(within(callout).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(overviewReads).toBe(readsBefore + 1));
    await waitFor(() => expect((within(screen.getByTestId("vault-confirm-impact")).getByRole("button", { name: "Revoke account" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(screen.getByTestId("vault-confirm-impact")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("vault-confirm-impact")).toBeNull();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
});

describe("E28 — TLS solver accounts on the Accounts tab (add-acme-dns01-certs)", () => {
  const SOLVER_VALUE = "cf-token-must-never-render-0001";
  beforeEach(() => {
    current = makeOverview({
      accounts: [
        acct("u1", "gemini", "personal"),
        { id: "t1", provider: "cloudflare", kind: "tls-solver", namespace: "tls:home", label: "cloudflareToken" },
      ],
    });
    calls = stubVaultFetch({ overview: () => current });
  });

  it("lists them under TLS certificates by name only, with the Gateway source and a Gateway link", () => {
    render(<Host />);
    const group = screen.getByTestId("vault-accounts-tls");
    expect(within(group).getByRole("heading", { name: "TLS certificates" })).toBeTruthy();
    const row = within(group).getByTestId("vault-account-t1");
    expect(within(row).getByTestId("vault-account-label").textContent).toBe("cloudflareToken");
    expect(row.textContent).toContain("cloudflare");
    expect(within(row).getByTestId("vault-account-tls-usage").textContent).toBe("Gateway source home");
    expect(within(row).getByTestId("vault-account-tls-link").getAttribute("href")).toBe("/settings/gateway");
  });

  it("offers no rotate or revoke control and shows no value", () => {
    render(<Host />);
    const row = screen.getByTestId("vault-account-t1");
    expect(within(row).queryByTestId("vault-account-rotate")).toBeNull();
    expect(within(row).queryByTestId("vault-account-revoke")).toBeNull();
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row.querySelector("input")).toBeNull();
    expect(document.body.textContent).not.toContain(SOLVER_VALUE);
  });

  it("keeps the key group to key accounts and omits the group when there are no solver accounts", () => {
    render(<Host />);
    expect(within(screen.getByTestId("vault-accounts-list")).queryByTestId("vault-account-t1")).toBeNull();
    expect(within(screen.getByTestId("vault-accounts-list")).getByTestId("vault-account-u1")).toBeTruthy();
    expect(screen.queryByTestId("vault-accounts-other")).toBeNull();
    cleanup();
    current = makeOverview({ accounts: [acct("u1", "gemini", "personal")] });
    render(<Host />);
    expect(screen.queryByTestId("vault-accounts-tls")).toBeNull();
  });
});
