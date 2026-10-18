/**
 * Vault settings page: lists labels only (never a value), refuses a short key
 * client-side, flags a no-account grant, and shows names-only import proposals.
 * See change: add-credential-vault (task 6.7). Fetch stubs answer with a JSON content-type
 * (`vault-api.ts` reads replies through `fetchJsonResponse`); see change: retro-ux-credential-vault.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../../../lib/api/api-context.js";
import { VaultSection } from "../VaultSection.js";
import { callsTo, fail, html, makeOverview, ok as okResponse, stubVaultFetch } from "./vault-fixtures.js";

const SECRET = "supersecretvalue-0001";
let overview: Record<string, unknown>;
let calls: Array<{ url: string; method: string; body?: unknown }>;

const JSON_HEADERS = new Headers({ "content-type": "application/json" });
const ok = (data: unknown) => ({ ok: true, status: 200, headers: JSON_HEADERS, json: () => Promise.resolve({ success: true, data }) });

beforeEach(() => {
  calls = [];
  overview = {
    status: { state: "ok" },
    accounts: [
      { id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "personal" },
      { id: "a2", provider: "gemini", kind: "key", namespace: "user", label: "work" },
      // A kind this page does not know: kept, counted, not shown. (`oauth` now has its own
      // "Sign-in accounts" section; see change: retro-ux-credential-vault, design D10.)
      { id: "o1", provider: "x", kind: "mystery", namespace: "user", label: "other" },
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
    fireEvent.click(await screen.findByTestId("vault-account-new"));
    await screen.findByTestId("vault-account-form");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "gemini" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "ci" } });
    const key = screen.getByLabelText("Key") as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(key, { target: { value: SECRET } });
    fireEvent.click(screen.getByTestId("vault-account-submit"));
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
    headers: JSON_HEADERS,
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
      [["use-host", "future-remedy"], ["use-host"]],
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
      () => ({ ok: false, status: 500, headers: JSON_HEADERS, json: () => Promise.resolve({ success: false, error: "internal", message: "internal error (see server.log)" }) }),
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
    // A rejected fetch is a `network` failure now: it names its cause instead of the raw error text.
    expect(line.textContent).toContain("Can't reach the dashboard server");
    expect(screen.queryByTestId("vault-operate-required")).toBeNull();
  });
});

// ── add-request-access-remedy (test-plan E20–E22, F1, F2) ─────────────────
describe("VaultSection — request-access remedy row", () => {
  const refusal = (remedies: unknown[]) => ({
    ok: false,
    status: 403,
    headers: JSON_HEADERS,
    json: () => Promise.resolve({ success: false, error: "operate_required", message: "m", reason: "no-credential", remedies }),
  });
  /** `GET <base>/api/vault` answers from `queue` (last repeats); every other call succeeds empty. */
  function stubVault(queue: Array<() => unknown>) {
    let i = 0;
    const fn = vi.fn((url: string) => {
      if (url.endsWith("/api/vault")) return Promise.resolve(queue[Math.min(i++, queue.length - 1)]());
      return Promise.resolve(ok(url.endsWith("/api/vault/import/candidates") ? [] : {}));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  afterEach(() => setGlobalApiBase(""));
  const link = () => screen.getByTestId("vault-operate-request-access") as HTMLAnchorElement;

  it("E20 on the page's own server: three rows in order; same-context link", async () => {
    setGlobalApiBase(window.location.origin);
    stubVault([() => refusal(["use-host", "request-access", "sign-in"])]);
    render(<VaultSection />);
    await screen.findByTestId("vault-operate-required");
    expect(screen.getAllByTestId("vault-operate-remedy").map((r) => r.getAttribute("data-remedy"))).toEqual(["use-host", "request-access", "sign-in"]);
    expect(link().getAttribute("href")).toBe("/pair?request");
    expect(link().getAttribute("target")).toBeNull();
    expect(link().textContent).toBe("Request access");
  });

  it("E21 another server: absolute link in a new context without an opener", async () => {
    setGlobalApiBase("http://192.168.16.204:8000");
    stubVault([() => refusal(["use-host", "request-access"])]);
    render(<VaultSection />);
    await screen.findByTestId("vault-operate-required");
    expect(link().getAttribute("href")).toBe("http://192.168.16.204:8000/pair?request");
    expect(link().getAttribute("target")).toBe("_blank");
    expect(link().getAttribute("rel")).toContain("noopener");
  });

  it("F1 the link keeps targeting the refusing server after the active server switches", async () => {
    setGlobalApiBase("http://192.168.16.204:8000");
    stubVault([() => refusal(["use-host", "request-access"])]);
    const { rerender } = render(<VaultSection />);
    await screen.findByTestId("vault-operate-required");
    setGlobalApiBase("http://192.168.16.31:8000"); // no reload
    rerender(<VaultSection />);
    expect(link().getAttribute("href")).toBe("http://192.168.16.204:8000/pair?request");
  });

  it("F2 retry stays single-flight with the new row", async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { release = r; });
    let n = 0;
    const fn = vi.fn((url: string) => {
      if (!url.endsWith("/api/vault")) return Promise.resolve(ok(url.endsWith("/api/vault/import/candidates") ? [] : {}));
      return n++ === 0 ? Promise.resolve(refusal(["use-host", "request-access"])) : pending;
    });
    vi.stubGlobal("fetch", fn);
    render(<VaultSection />);
    const retry = await screen.findByTestId("vault-operate-retry");
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect((screen.getByTestId("vault-operate-retry") as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId("vault-operate-required").getAttribute("aria-busy")).toBe("true");
    expect(fn.mock.calls.filter((c) => c[0] === "/api/vault")).toHaveLength(2);
    release(refusal(["use-host", "request-access"]));
    await waitFor(() => expect((screen.getByTestId("vault-operate-retry") as HTMLButtonElement).disabled).toBe(false));
  });
});

// ── retro-ux-credential-vault ─────────────────────────────────────────────
describe("VaultSection — tabs (F1)", () => {
  const tab = (id: string) => screen.getByTestId(`vault-tab-${id}`);
  const selected = () => ["variables", "accounts", "import"].filter((id) => tab(id).getAttribute("aria-selected") === "true");

  it("F1 follows the arrow keys, Home and End; inactive panels are hidden but mounted; typed state survives a tab switch", async () => {
    render(<VaultSection />);
    const tablist = await screen.findByRole("tablist");
    expect(tablist.getAttribute("aria-label")).toBeTruthy();
    expect(selected()).toEqual(["variables"]);
    expect(tab("variables").getAttribute("tabindex")).toBe("0");
    expect(tab("accounts").getAttribute("tabindex")).toBe("-1");
    tab("variables").focus();

    fireEvent.keyDown(tab("variables"), { key: "ArrowRight" });
    expect(selected()).toEqual(["accounts"]);
    expect(document.activeElement).toBe(tab("accounts"));
    fireEvent.keyDown(tab("accounts"), { key: "ArrowRight" });
    expect(selected()).toEqual(["import"]);
    expect(document.activeElement).toBe(tab("import"));
    fireEvent.keyDown(tab("import"), { key: "ArrowRight" });
    expect(selected()).toEqual(["variables"]); // wraps
    fireEvent.keyDown(tab("variables"), { key: "End" });
    expect(selected()).toEqual(["import"]);
    fireEvent.keyDown(tab("import"), { key: "Home" });
    expect(selected()).toEqual(["variables"]);
    expect(document.activeElement).toBe(tab("variables"));
    fireEvent.keyDown(tab("variables"), { key: "ArrowLeft" });
    expect(selected()).toEqual(["import"]);

    for (const [id, panel] of [["variables", "bindings"], ["accounts", "accounts"], ["import", "import"]] as const) {
      const el = screen.getByTestId(`vault-panel-${panel}`);
      expect(el.getAttribute("role")).toBe("tabpanel");
      expect(tab(id).getAttribute("aria-controls")).toBe(el.id);
      expect(el.getAttribute("aria-labelledby")).toBe(tab(id).id);
      expect(el.hasAttribute("hidden")).toBe(id !== "import");
      expect(el.isConnected).toBe(true);
    }

    fireEvent.click(tab("accounts"));
    fireEvent.click(screen.getByTestId("vault-account-new"));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "gemini" } });
    fireEvent.click(tab("variables"));
    expect(screen.getByTestId("vault-panel-accounts").hasAttribute("hidden")).toBe(true);
    fireEvent.click(tab("accounts"));
    expect((screen.getByLabelText("Provider") as HTMLInputElement).value).toBe("gemini");
  });
});

describe("VaultSection — first run (F2)", () => {
  const stubFirstRun = (opts: { accounts?: number; candidates: number }) => {
    const accounts = Array.from({ length: opts.accounts ?? 0 }, (_, i) => ({ id: `a${i}`, provider: "gemini", kind: "key", namespace: "user", label: `k${i}` }));
    stubVaultFetch({
      overview: () => makeOverview({ accounts }),
      handler: (c) =>
        c.url === "/api/vault/import/candidates"
          ? okResponse(Array.from({ length: opts.candidates }, (_, i) => ({ id: `c${i}`, label: `file ${i}`, exists: true })))
          : undefined,
    });
  };
  const isPrimary = (el: HTMLElement) => el.className.includes("accent-solid");

  it("F2 offers Import keys as the primary action when key files were found", async () => {
    stubFirstRun({ candidates: 2 });
    render(<VaultSection />);
    const guide = await screen.findByTestId("vault-empty");
    expect(guide.querySelectorAll("ol > li")).toHaveLength(3);
    expect(isPrimary(within(guide).getByTestId("vault-first-run-import"))).toBe(true);
    expect(isPrimary(within(guide).getByTestId("vault-first-run-add"))).toBe(false);
    expect(guide.textContent).toContain("2 key files found");
  });

  it("F2 offers Add a key as the primary action when none were found; each action opens its tab", async () => {
    stubFirstRun({ candidates: 0 });
    render(<VaultSection />);
    const guide = await screen.findByTestId("vault-empty");
    expect(isPrimary(within(guide).getByTestId("vault-first-run-add"))).toBe(true);
    expect(isPrimary(within(guide).getByTestId("vault-first-run-import"))).toBe(false);
    fireEvent.click(within(guide).getByTestId("vault-first-run-add"));
    expect(screen.getByTestId("vault-tab-accounts").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("vault-account-form")).toBeTruthy();
  });

  it("F2 shows no guide once there is an account: the Variables empty text and New variable instead", async () => {
    stubFirstRun({ accounts: 1, candidates: 2 });
    render(<VaultSection />);
    await screen.findByTestId("vault-variables-empty");
    expect(screen.queryByTestId("vault-empty")).toBeNull();
    expect(screen.getByTestId("vault-variable-new")).toBeTruthy();
  });
});

describe("VaultSection — loading (F3)", () => {
  it("F3 shows a busy skeleton while the first load runs, then the tablist, never an empty page", async () => {
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => { release = r; });
    stubVaultFetch({ handler: (c) => (c.method === "GET" && c.url === "/api/vault" ? pending : undefined) });
    render(<VaultSection />);
    const skeleton = screen.getByTestId("vault-loading");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    release(okResponse(makeOverview({ accounts: [{ id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "personal" }] })));
    await screen.findByRole("tablist");
    expect(screen.queryByTestId("vault-loading")).toBeNull();
  });
});

describe("VaultSection — load failures (X1, X2)", () => {
  it("X1 a 200 HTML reply says the server lacks the vault, offers Restart server and Try again, and shows a refusal in place", async () => {
    const calls = stubVaultFetch({
      handler: (c) => {
        if (c.method === "GET" && c.url === "/api/vault") return html(200);
        if (c.method === "POST" && c.url === "/api/restart") return fail(403, "forbidden", "Restart refused: operator access needed");
        return undefined;
      },
    });
    render(<VaultSection />);
    const callout = await screen.findByTestId("vault-error");
    expect(callout.textContent).toContain("doesn't have the vault yet");
    expect(within(callout).getByRole("button", { name: "Restart server" })).toBeTruthy();
    expect(within(callout).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("HTTP 200");
    fireEvent.click(within(callout).getByRole("button", { name: "Restart server" }));
    await waitFor(() => expect(screen.getByTestId("vault-error").textContent).toContain("Restart refused: operator access needed"));
    expect(callsTo(calls, "POST", "/api/restart")).toHaveLength(1);
    const before = callsTo(calls, "GET", "/api/vault").length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(callsTo(calls, "GET", "/api/vault").length).toBe(before + 1));
  });

  it("X1 an accepted restart says so instead of looping", async () => {
    stubVaultFetch({
      handler: (c) => {
        if (c.method === "GET" && c.url === "/api/vault") return html(200);
        if (c.method === "POST" && c.url === "/api/restart") return okResponse({});
        return undefined;
      },
    });
    render(<VaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Restart server" }));
    await waitFor(() => expect(screen.getByTestId("vault-restarting").textContent).toMatch(/restarting/i));
  });

  it("X2 an unreachable server is named in the error line", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<VaultSection />);
    expect((await screen.findByTestId("vault-error")).textContent).toContain("Can't reach the dashboard server");
  });
});

describe("VaultSection — corrupt vault (X6)", () => {
  it("X6 names the backup and disables every add / rotate / revoke / grant / delete / approve control", async () => {
    const overviewCorrupt = makeOverview({
      status: { state: "corrupt", backup: "/Users/robson/.pi/dashboard/vault.json.corrupt-1760339462" },
      accounts: [{ id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "personal" }],
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" }],
      grants: [{ subject: "repo:github.com/acme/app", bindingName: "GEMINI_API_KEY", state: "ok" }],
      confirmations: [{ deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" }],
      plugins: [{ pluginId: "demo", displayName: "Demo", declared: ["GEMINI_API_KEY", "POLY_PIZZA_KEY"] }],
    });
    stubVaultFetch({
      overview: () => overviewCorrupt,
      handler: (c) => (c.url === "/api/vault/import/candidates" ? okResponse([{ id: "c1", label: "skill .env", exists: true }]) : undefined),
    });
    render(<VaultSection />);
    const banner = await screen.findByTestId("vault-corrupt");
    expect(banner.textContent).toContain("vault.json.corrupt-1760339462");
    for (const id of [
      "vault-account-new", "vault-account-rotate", "vault-account-revoke",
      "vault-variable-new", "vault-variable-delete", "vault-binding-default", "vault-grant-open", "vault-grant-remove",
      "vault-checkout-revoke", "vault-plugin-approve", "vault-import-review", "vault-import-file",
    ]) {
      const controls = screen.getAllByTestId(id) as Array<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>;
      expect(controls.length, id).toBeGreaterThan(0);
      for (const control of controls) expect(control.disabled, id).toBe(true);
    }
  });
});
