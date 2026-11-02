/**
 * Per-session vault chip: hidden without bindings, lists names + states only,
 * explains revoked, offers confirmation for a pending checkout, and converges.
 * See change: add-credential-vault (task 6.8). Replies carry a JSON content-type
 * (`vault-api.ts` reads them through `fetchJsonResponse`); chip pills, explanations, the
 * ungranted section and the grant action: see change: retro-ux-credential-vault (E23–E26, F4, X6).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultBindingsChip } from "../VaultBindingsChip.js";

let payload: unknown;
let status = 200;
let calls: Array<{ url: string; method: string; body?: unknown }>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const gets = () => calls.filter((c) => c.method === "GET").length;
const posts = (url: string) => calls.filter((c) => c.method === "POST" && c.url === url);

const PROJECT = { deviceId: "hub", dir: "/work/app", repoKey: "github.com/acme/app" };

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  status = 200;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    return Promise.resolve(
      new Response(JSON.stringify(status === 200 ? { success: true, data: payload } : { success: false }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function open(p: unknown) {
  payload = p;
  render(<VaultBindingsChip sessionId="s1" />);
  await flush();
  fireEvent.click(screen.getByTestId("vault-chip"));
}

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
    await open({
      bindings: [
        { name: "A_KEY", state: "delivered" },
        { name: "B_KEY", state: "local-override" },
        { name: "C_KEY", state: "revoked" },
      ],
      lastContactAt: 1_700_000_000_000,
    });
    const rows = screen.getAllByTestId("vault-binding-row");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["delivered", "local-override", "revoked"]);
    expect(screen.getAllByTestId("vault-revoked-note")).toHaveLength(1);
    expect(screen.getByTestId("vault-last-contact").textContent).toContain("Last vault contact");
    expect(document.body.textContent).not.toMatch(/secret|value=/i);
  });

  it("B2: shows a hub-unreachable row with its label", async () => {
    await open({ bindings: [{ name: "A_KEY", state: "hub-unreachable" }], lastContactAt: 1_700_000_000_000 });
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

describe("E23 — a pending confirmation is the primary action", () => {
  const pending = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}_KEY`, state: "pending-confirmation" }));
  for (const [n, label] of [[1, "Confirm and deliver 1 key"], [3, "Confirm and deliver 3 keys"]] as const) {
    it(`${n} pending → "${label}"; the callout states the trust decision and its scope`, async () => {
      payload = { bindings: [...pending(n), { name: "OK_KEY", state: "delivered" }], project: PROJECT };
      render(<VaultBindingsChip sessionId="s1" />);
      await flush();
      const chip = screen.getByTestId("vault-chip");
      expect(chip.getAttribute("data-pending")).toBe("true");
      expect(chip.textContent).toContain("Vault: confirm");
      fireEvent.click(chip);
      expect(screen.getByTestId("vault-confirm").textContent).toBe(label);
      const callout = screen.getByTestId("vault-confirm-callout");
      for (const part of ["github.com/acme/app", "/work/app", "hub", "any clone can claim", "Applies to every session in this checkout"]) {
        expect(callout.textContent, part).toContain(part);
      }
    });
  }

  it("without a pending binding the chip reads Vault · N and shows no callout", async () => {
    await open({ bindings: [{ name: "A_KEY", state: "delivered" }], project: PROJECT });
    expect(screen.getByTestId("vault-chip").textContent).toContain("Vault · 1");
    expect(screen.getByTestId("vault-chip").getAttribute("data-pending")).toBe("false");
    expect(screen.queryByTestId("vault-confirm-callout")).toBeNull();
  });
});

describe("E24 — every state has a bare label and an explanation", () => {
  const STATES: Array<[string, string]> = [
    ["delivered", "Delivered"],
    ["local-override", "Local value kept"],
    ["inherited", "Inherited from parent pi"],
    ["no-account", "No account"],
    ["blocked-name", "Name not allowed"],
    ["revoked", "Revoked"],
    ["hub-unreachable", "Hub unreachable"],
    ["vault-unavailable", "Vault unavailable"],
    ["made-up-state", "made-up-state"],
  ];

  it("the state element holds exactly the label; an explanation sits beside the pill; an unknown state explains itself with its label", async () => {
    await open({ bindings: STATES.map(([state], i) => ({ name: `K${i}_KEY`, state })), lastContactAt: 1_700_000_000_000, project: PROJECT });
    const rows = screen.getAllByTestId("vault-binding-row");
    expect(rows).toHaveLength(STATES.length);
    STATES.forEach(([state, label], i) => {
      const row = rows[i];
      expect(row.getAttribute("data-state")).toBe(state);
      const stateEl = within(row).getByTestId("vault-binding-state");
      expect(stateEl.textContent).toBe(label);
      const help = row.querySelector("[data-explanation]");
      expect(help, state).not.toBeNull();
      expect(stateEl.contains(help)).toBe(false);
      expect((help?.textContent ?? "").length).toBeGreaterThan(0);
      expect(row.querySelector(".font-mono")?.textContent).toBe(`K${i}_KEY`); // e2e reads the name from the first .font-mono
    });
    expect(rows[8].querySelector("[data-explanation]")?.textContent).toBe("made-up-state");
  });

  it("rows, explanations and the last-contact line stay at 12 px or larger", async () => {
    await open({ bindings: STATES.map(([state], i) => ({ name: `K${i}_KEY`, state })), lastContactAt: 1_700_000_000_000, project: PROJECT });
    // jsdom does not run Tailwind, so the size is pinned on the classes: a text-xs/sm/base token and no sub-12px arbitrary size.
    const small = /text-\[(?:\d|1[01])(?:\.\d+)?px\]/;
    const ok = /\btext-(?:xs|sm|base)\b/;
    const dialog = screen.getByTestId("vault-bindings-dialog");
    expect(dialog.innerHTML).not.toMatch(small);
    for (const el of [
      ...screen.getAllByTestId("vault-binding-row"),
      ...Array.from(dialog.querySelectorAll("[data-explanation]")),
      screen.getByTestId("vault-last-contact"),
      screen.getByTestId("vault-chip"),
    ]) {
      expect(el.className, el.getAttribute("data-testid") ?? el.tagName).toMatch(ok);
    }
  });
});

describe("E25 — chip visibility", () => {
  const row = { name: "A_KEY", state: "delivered" };
  const cases: Array<[string, unknown, boolean]> = [
    ["no bindings, ungranted undefined", { bindings: [] }, false],
    ["no bindings, ungranted []", { bindings: [], ungranted: [] }, false],
    ["no bindings, one ungranted name", { bindings: [], ungranted: ["OPENAI_API_KEY"], project: PROJECT }, true],
    ["one binding", { bindings: [row] }, true],
  ];
  for (const [name, p, shown] of cases) {
    it(`${name} → ${shown ? "shown" : "hidden"}`, async () => {
      payload = p;
      render(<VaultBindingsChip sessionId="s1" />);
      await flush();
      expect(screen.queryByTestId("vault-chip") !== null).toBe(shown);
    });
  }
});

describe("E26 — an operator grants a missing variable from the session", () => {
  it("a repository project grants repo:<key> and the row says the checkout needs confirming", async () => {
    await open({ bindings: [], ungranted: ["OPENAI_API_KEY"], project: PROJECT });
    const section = screen.getByTestId("vault-ungranted");
    expect(section.textContent).toContain("OPENAI_API_KEY");
    expect(section.textContent).toContain("Repository grants need this checkout confirmed");
    fireEvent.click(within(section).getByTestId("vault-grant-from-session"));
    await flush();
    expect(posts("/api/vault/grants")).toHaveLength(1);
    expect(posts("/api/vault/grants")[0].body).toEqual({ subject: "repo:github.com/acme/app", bindingName: "OPENAI_API_KEY" });
  });

  it("a folder project grants dir:<device>:<path> and carries no confirmation note on the row", async () => {
    await open({ bindings: [], ungranted: ["OPENAI_API_KEY"], project: { deviceId: "hub", dir: "/work/scratch" } });
    const row = screen.getByTestId("vault-ungranted-row");
    expect(row.textContent).not.toContain("Repository grants need this checkout confirmed");
    fireEvent.click(within(row).getByTestId("vault-grant-from-session"));
    await flush();
    expect(posts("/api/vault/grants")[0].body).toEqual({ subject: "dir:hub:/work/scratch", bindingName: "OPENAI_API_KEY" });
  });

  it("shows the project the grant goes to, and a link to Settings → Vault", async () => {
    await open({ bindings: [{ name: "A_KEY", state: "delivered" }], ungranted: ["OPENAI_API_KEY"], project: PROJECT });
    const line = screen.getByTestId("vault-project-line");
    expect(line.textContent).toContain("github.com/acme/app");
    expect(line.textContent).toContain("/work/app");
    expect(screen.getByTestId("vault-manage-link").getAttribute("href")).toBe("/settings/vault");
  });

  it("with no resolved project it says why the vault does not deliver here", async () => {
    await open({ bindings: [{ name: "A_KEY", state: "no-account" }], outcome: "transport-insecure" });
    expect(screen.getByTestId("vault-project-line").textContent).toMatch(/does not deliver to this session/);
    expect(screen.getByTestId("vault-project-line").textContent).toContain("transport-insecure");
    expect(screen.queryByTestId("vault-ungranted")).toBeNull();
  });
});

describe("F4 — a repository grant from the chip converges after one poll", () => {
  it("the confirm callout appears after exactly one poll and the name leaves the ungranted section", async () => {
    payload = { bindings: [{ name: "GEMINI_API_KEY", state: "delivered" }], ungranted: ["OPENAI_API_KEY"], project: PROJECT };
    render(<VaultBindingsChip sessionId="s1" />);
    await flush();
    fireEvent.click(screen.getByTestId("vault-chip"));
    expect(screen.getByTestId("vault-ungranted").textContent).toContain("OPENAI_API_KEY");
    fireEvent.click(screen.getByTestId("vault-grant-from-session"));
    await flush();
    expect(posts("/api/vault/grants")).toHaveLength(1);
    const before = gets();
    payload = {
      bindings: [{ name: "GEMINI_API_KEY", state: "delivered" }, { name: "OPENAI_API_KEY", state: "pending-confirmation" }],
      ungranted: [],
      project: PROJECT,
    };
    expect(screen.queryByTestId("vault-confirm")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(gets()).toBe(before + 1);
    expect(screen.getByTestId("vault-confirm")).toBeTruthy();
    expect(screen.queryByTestId("vault-ungranted")).toBeNull();
  });
});

describe("X6 — an unreadable vault disables grant and confirm", () => {
  it("Grant and Confirm are disabled while the session reports vault-unavailable", async () => {
    await open({
      outcome: "vault-unavailable",
      bindings: [{ name: "A_KEY", state: "pending-confirmation" }],
      ungranted: ["OPENAI_API_KEY"],
      project: PROJECT,
    });
    expect((screen.getByTestId("vault-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("vault-grant-from-session") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("vault-grant-from-session"));
    fireEvent.click(screen.getByTestId("vault-confirm"));
    await flush();
    expect(posts("/api/vault/grants")).toHaveLength(0);
    expect(posts("/api/vault/confirmations")).toHaveLength(0);
  });
});

// ── F4 (test-plan prove-vault-bridge-tls) — a refused session names the missing proof ──

describe("F4 — trustDetail names the cause with an icon and a remedy", () => {
  type Row = { detail: string; outcome: string; cause: RegExp; remedy: RegExp };
  const ROWS: Row[] = [
    { detail: "unattributed", outcome: "untrusted", cause: /not tied to a paired device/i, remedy: /PI_DASHBOARD_TOKEN/ },
    { detail: "local-unproven", outcome: "untrusted", cause: /did not prove it is local/i, remedy: /local socket|local proof/i },
    { detail: "device-inactive", outcome: "untrusted", cause: /revoked or has expired/i, remedy: /pair the device again/i },
    { detail: "plain-transport", outcome: "transport-insecure", cause: /no proven TLS connection/i, remedy: /Accept bridges[\s\S]*wss:\/\//i },
    { detail: "bearer-exposed", outcome: "transport-insecure", cause: /plain HTTP/i, remedy: /new token[\s\S]*HTTPS/i },
    { detail: "history-unknown", outcome: "transport-insecure", cause: /predates TLS tracking/i, remedy: /new token[\s\S]*HTTPS/i },
    { detail: "ticket-plain", outcome: "transport-insecure", cause: /ticket was issued over plain HTTP/i, remedy: /wss:\/\/[\s\S]*PI_DASHBOARD_HTTP_URL/ },
    { detail: "bridge-outdated", outcome: "transport-insecure", cause: /cannot confirm it validates certificates/i, remedy: /update pi-dashboard on the device/i },
  ];

  for (const r of ROWS) {
    it(`${r.detail}: icon + cause + remedy, text >= 12 px`, async () => {
      await open({
        bindings: [{ name: "A_KEY", state: "no-account" }],
        outcome: r.outcome,
        trustDetail: r.detail,
        lastContactAt: 1_700_000_000_000,
      });
      const box = screen.getByTestId("vault-trust-detail");
      expect(box.getAttribute("data-detail")).toBe(r.detail);
      expect(box.querySelector("svg"), "icon").not.toBeNull();
      expect(within(box).getByTestId("vault-trust-cause").textContent).toMatch(r.cause);
      expect(within(box).getByTestId("vault-trust-remedy").textContent).toMatch(r.remedy);
      // jsdom does not run Tailwind: pin the size on the classes (a text-xs/sm/base token, no sub-12px arbitrary size).
      expect(box.innerHTML).not.toMatch(/text-\[(?:\d|1[01])(?:\.\d+)?px\]/);
      for (const el of [within(box).getByTestId("vault-trust-cause"), within(box).getByTestId("vault-trust-remedy")]) {
        expect(el.className).toMatch(/\btext-(?:xs|sm|base)\b/);
      }
      // No value, no bearer in the text.
      expect(document.body.textContent).not.toMatch(/pi_tls_[A-Za-z0-9_-]{8,}/);
    });
  }

  it("the cause does not replace the existing outcome line", async () => {
    await open({ bindings: [{ name: "A_KEY", state: "no-account" }], outcome: "transport-insecure", trustDetail: "plain-transport" });
    expect(screen.getByTestId("vault-project-line").textContent).toContain("transport-insecure");
  });

  it("no trustDetail (or an unknown one) renders no trust box", async () => {
    await open({ bindings: [{ name: "A_KEY", state: "delivered" }], project: PROJECT });
    expect(screen.queryByTestId("vault-trust-detail")).toBeNull();
    cleanup();
    await open({ bindings: [{ name: "A_KEY", state: "no-account" }], outcome: "untrusted", trustDetail: "made-up-detail" });
    expect(screen.queryByTestId("vault-trust-detail")).toBeNull();
  });
});
