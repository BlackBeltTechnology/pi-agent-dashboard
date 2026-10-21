// @vitest-environment jsdom
/**
 * L1 accounts-panel tests (task 4.2): rows, badges, honest level help, level
 * change, revoke outcome, flow error → wizard step. See change: add-gmail-plugin.
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiConfirmDialogProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailSettings } from "../GmailSettings.js";

const renderPanel = () => renderWithConfirm();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATE = {
  client: { configured: true, clientId: "x.apps.googleusercontent.com" },
  accounts: [
    { sub: "s1", email: "a@x.com", alias: "work", tier: "send", status: "ok", addedAt: 1 },
    { sub: "s2", email: "b@y.com", tier: "readonly", status: "reauth_required", testingHint: true, addedAt: 2 },
  ],
};

function mockFetch(routes: Record<string, (init?: RequestInit) => unknown>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
    return new Response(JSON.stringify(handler(init)), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("accounts panel", () => {
  it("lists accounts with status badges, testing hint and the honest scope-limit help", async () => {
    mockFetch({ "GET /api/plugins/gmail/state": () => STATE });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    expect(rows.map((r) => r.dataset.email)).toEqual(["a@x.com", "b@y.com"]);
    expect(within(rows[0] as HTMLElement).getByTestId("gmail-account-status").dataset.status).toBe("ok");
    expect(within(rows[1] as HTMLElement).getByTestId("gmail-account-status").textContent).toBe("Re-auth needed");
    expect(rows[1]?.textContent).toContain("testing: 7-day");
    expect(screen.getByTestId("gmail-level-help").textContent).toMatch(/not by Google/);
  });

  it("lowering a level posts the new tier and refreshes without a flow", async () => {
    const fetchMock = mockFetch({
      "GET /api/plugins/gmail/state": () => STATE,
      "POST /api/plugins/gmail/accounts/s1/level": () => ({ applied: true }),
    });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    fireEvent.change(within(rows[0] as HTMLElement).getByTestId("gmail-account-level"), { target: { value: "draft" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/plugins/gmail/accounts/s1/level",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ tier: "draft" }) }),
      ),
    );
  });

  it("revoke with Google unreachable says to revoke manually", async () => {
    mockFetch({
      "GET /api/plugins/gmail/state": () => STATE,
      "DELETE /api/plugins/gmail/accounts/s1": () => ({ removed: true, remoteRevoked: false }),
    });
    renderWithConfirm();
    const rows = await screen.findAllByTestId("gmail-account-row");
    fireEvent.click(within(rows[0] as HTMLElement).getByTestId("gmail-account-revoke"));
    fireEvent.click(screen.getByTestId("confirm-ok"));
    expect((await screen.findByTestId("gmail-revoke-result")).textContent).toMatch(/myaccount\.google\.com\/permissions/);
  });

  it("a start failure maps to its wizard step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.endsWith("/state")
          ? new Response(JSON.stringify(STATE), { status: 200 })
          : init?.method === "POST"
            ? new Response(JSON.stringify({ error: "invalid_client" }), { status: 502 })
            : new Response("{}", { status: 404 }),
      ),
    );
    renderPanel();
    fireEvent.click(await screen.findByTestId("gmail-add-account"));
    const err = await screen.findByTestId("gmail-flow-error");
    expect(err.dataset.step).toBe("5");
  });
});

describe("CodeRabbit — flow status failure surfaces", () => {
  it("a level raise whose flow status fails shows the error instead of hanging", async () => {
    mockFetch({
      "GET /api/plugins/gmail/state": () => STATE,
      "POST /api/plugins/gmail/accounts/s2/level": () => ({ flowId: "gone" }),
    });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    fireEvent.change(within(rows[1] as HTMLElement).getByTestId("gmail-account-level"), { target: { value: "send" } });
    expect((await screen.findByTestId("gmail-flow-error")).textContent).toMatch(/Sign-in failed/);
  });
});

// ── improve-gmail-settings-ux ────────────────────────────────────────────────

const FLOW_URL = "/api/provider-auth/flow/f1";
const pendingStatus = { flowId: "f1", provider: "gmail", status: "pending", authUrl: "https://accounts.google.com/x" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

/**
 * Fetch fake with a scriptable flow-status endpoint. `statusReplies` are
 * consumed in order (the last one repeats); each may be a promise.
 */
function flowFetch(opts: {
  state?: unknown;
  statusReplies?: Array<unknown | Promise<unknown>>;
  extra?: (url: string, method: string, init?: RequestInit) => Response | undefined;
} = {}) {
  const calls = { status: 0, cancel: 0 };
  let replies = opts.statusReplies ?? [pendingStatus];
  const flowRoute = async (method: string) => {
    if (method === "DELETE") {
      calls.cancel++;
      return json({});
    }
    const i = Math.min(calls.status, replies.length - 1);
    calls.status++;
    return json(await replies[i]);
  };
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const extra = opts.extra?.(url, method, init);
    if (extra) return extra;
    if (url === "/api/plugins/gmail/state") return json(opts.state ?? STATE);
    if (url === "/api/plugins/gmail/accounts" && method === "POST") return json({ flowId: "f1" });
    if (url === FLOW_URL) return flowRoute(method);
    return json({ error: "nope" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return {
    fn,
    calls,
    setReplies: (r: Array<unknown | Promise<unknown>>) => {
      replies = r;
      calls.status = 0;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Render with a confirm-dialog fake that exposes Confirm/Cancel buttons. */
function renderWithConfirm() {
  return render(
    withUiPrimitiveProvider(
      {
        "ui:oauth-flow": () => <div data-testid="flow-view" />,
        "ui:confirm-dialog": ({ message, confirmLabel, onConfirm, onCancel }: UiConfirmDialogProps) => (
          <div data-testid="confirm-dialog">
            <p>{message}</p>
            <button type="button" data-testid="confirm-ok" onClick={onConfirm}>
              {confirmLabel}
            </button>
            <button type="button" data-testid="confirm-cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        ),
      },
      <GmailSettings />,
    ),
  );
}

async function startWaitingFlow() {
  fireEvent.click(await screen.findByTestId("gmail-add-account"));
  await screen.findByTestId("flow-view");
}

const wizardDetails = () => screen.getByTestId("gmail-wizard").closest("details") as HTMLDetailsElement;

describe("test-plan #F1–#F5 — report the error Google showed", () => {
  it("#F1 choosing org_internal cancels once, explains the fix and opens the audience step", async () => {
    const h = flowFetch({ state: { ...STATE, accounts: [STATE.accounts[0]] } });
    renderPanel();
    await startWaitingFlow();
    expect(wizardDetails().open).toBe(false);
    fireEvent.click(screen.getByTestId("gmail-report-org_internal"));
    const err = await screen.findByTestId("gmail-flow-error");
    await waitFor(() => expect(h.calls.cancel).toBe(1));
    expect(err.dataset.step).toBe("3");
    expect(err.textContent).toMatch(/External/);
    expect(err.textContent).toMatch(/test user/);
    expect(wizardDetails().open).toBe(true);
    expect(screen.queryByTestId("flow-view")).toBeNull();
  });

  it("#F2 the cancelled flow settling as Cancelled does not overwrite the reported code", async () => {
    const h = flowFetch();
    renderPanel();
    await startWaitingFlow();
    h.setReplies([{ flowId: "f1", provider: "gmail", status: "error", error: "Cancelled" }]);
    fireEvent.click(screen.getByTestId("gmail-report-org_internal"));
    await sleep(1100);
    const err = screen.getByTestId("gmail-flow-error");
    expect(err.dataset.step).toBe("3");
    expect(err.textContent).toMatch(/External/);
    expect(document.body.textContent).not.toMatch(/Cancelled/);
  });

  it("#F3 a pending poll resolving after the click never re-mounts the flow view", async () => {
    const late = deferred<unknown>();
    const h = flowFetch({ statusReplies: [pendingStatus, late.promise] });
    renderPanel();
    await startWaitingFlow();
    await waitFor(() => expect(h.calls.status).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    fireEvent.click(screen.getByTestId("gmail-report-org_internal"));
    late.resolve(pendingStatus);
    await sleep(1100);
    const count = h.calls.status;
    await sleep(1100);
    expect(screen.queryByTestId("flow-view")).toBeNull();
    expect(h.calls.status).toBe(count);
    expect(screen.getByTestId("gmail-flow-error").dataset.step).toBe("3");
  });

  it("#F4 admin_policy_enforced names the client id an admin must trust, no wizard step", async () => {
    flowFetch({ state: { ...STATE, client: { configured: true, clientId: "603-abc.apps.googleusercontent.com" } } });
    renderPanel();
    await startWaitingFlow();
    fireEvent.click(screen.getByTestId("gmail-report-admin_policy_enforced"));
    const err = await screen.findByTestId("gmail-flow-error");
    expect(err.textContent).toContain("603-abc.apps.googleusercontent.com");
    expect(err.dataset.step).toBe("");
  });

  it("#F5 the latch resets when a new flow starts", async () => {
    const h = flowFetch();
    renderPanel();
    await startWaitingFlow();
    fireEvent.click(screen.getByTestId("gmail-report-org_internal"));
    await screen.findByTestId("gmail-flow-error");
    h.setReplies([pendingStatus, { flowId: "f1", provider: "gmail", status: "error", error: "access_denied" }]);
    fireEvent.click(screen.getByTestId("gmail-add-account"));
    await waitFor(() => expect(screen.getByTestId("gmail-flow-error").textContent).toMatch(/test user/), { timeout: 3000 });
    const err = screen.getByTestId("gmail-flow-error");
    expect(err.textContent).toContain("access_denied");
    expect(err.dataset.step).toBe("3");
  });
});

describe("test-plan #X6 / #E13 — flow errors read as sentences", () => {
  it("#X6 a withheld host message shows the generic sentence; raw text only in the support span", async () => {
    const withheld = "Sign-in failed (details withheld: the error echoed submitted input)";
    flowFetch({ statusReplies: [pendingStatus, { flowId: "f1", provider: "gmail", status: "error", error: withheld }] });
    renderPanel();
    await startWaitingFlow();
    const err = await screen.findByTestId("gmail-flow-error", undefined, { timeout: 2000 });
    const raw = within(err).getByTestId("gmail-flow-error-code");
    expect(raw.textContent).toContain(withheld);
    expect(err.textContent?.replace(raw.textContent ?? "", "")).toMatch(/Sign-in failed/);
    expect(err.textContent?.replace(raw.textContent ?? "", "")).not.toContain("withheld");
  });

  it("#E13 scope_missing says the Gmail permission was not granted, no wizard step", async () => {
    flowFetch({ statusReplies: [pendingStatus, { flowId: "f1", provider: "gmail", status: "error", error: "scope_missing" }] });
    renderPanel();
    await startWaitingFlow();
    const err = await screen.findByTestId("gmail-flow-error", undefined, { timeout: 2000 });
    expect(err.textContent).toMatch(/Gmail permission/);
    expect(err.textContent).toMatch(/second screen/);
    expect(err.textContent).toMatch(/myaccount\.google\.com\/connections/);
    expect(err.dataset.step).toBe("");
  });
});

describe("test-plan #E12 — consent hint", () => {
  it("shows the consent hint (checkbox or second screen) only while a sign-in is waiting", async () => {
    flowFetch();
    renderPanel();
    await screen.findByTestId("gmail-add-account");
    expect(screen.queryByTestId("gmail-consent-hint")).toBeNull();
    await startWaitingFlow();
    const hint = screen.getByTestId("gmail-consent-hint");
    expect(hint.textContent).toMatch(/checkbox/);
    expect(hint.textContent).toMatch(/wants additional access/);
  });
});

describe("test-plan #F6 — revoke needs confirmation", () => {
  it("Cancel sends nothing; Confirm sends exactly one DELETE", async () => {
    const h = flowFetch({
      extra: (url, method) =>
        url === "/api/plugins/gmail/accounts/s1" && method === "DELETE" ? json({ removed: true, remoteRevoked: true }) : undefined,
    });
    renderWithConfirm();
    const rows = await screen.findAllByTestId("gmail-account-row");
    fireEvent.click(within(rows[0] as HTMLElement).getByTestId("gmail-account-revoke"));
    expect(screen.getByTestId("confirm-dialog").textContent).toContain("a@x.com");
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    const deletes = () => h.fn.mock.calls.filter(([u, i]) => u === "/api/plugins/gmail/accounts/s1" && i?.method === "DELETE");
    expect(deletes()).toHaveLength(0);
    expect(screen.getAllByTestId("gmail-account-row")).toHaveLength(2);
    fireEvent.click(within(screen.getAllByTestId("gmail-account-row")[0] as HTMLElement).getByTestId("gmail-account-revoke"));
    fireEvent.click(screen.getByTestId("confirm-ok"));
    await screen.findByTestId("gmail-revoke-result");
    expect(deletes()).toHaveLength(1);
  });
});

describe("test-plan #F7 — alias save feedback", () => {
  it.each([
    [200, { account: {} }, /Saved/],
    [409, { error: "alias_taken" }, /already used/],
  ])("PATCH %i → feedback", async (status, body, expected) => {
    flowFetch({
      extra: (url, method) => (url === "/api/plugins/gmail/accounts/s1" && method === "PATCH" ? json(body, status) : undefined),
    });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    const input = within(rows[0] as HTMLElement).getByTestId("gmail-account-alias");
    fireEvent.change(input, { target: { value: "home" } });
    fireEvent.blur(input);
    const fb = await within(rows[0] as HTMLElement).findByTestId("gmail-alias-feedback");
    expect(fb.textContent).toMatch(expected);
    if (status === 200) expect(fb.getAttribute("role")).toBe("status");
  });
});

describe("test-plan #E5 — collapsed wizard summary", () => {
  it.each([
    [{ configured: true, projectId: "p-1", clientId: "c.apps.googleusercontent.com" }, "p-1", null],
    [{ configured: true, clientId: "c.apps.googleusercontent.com" }, "c.apps.googleusercontent.com", "undefined"],
    [{ configured: false }, "not configured", null],
  ])("%j → %s", async (client, expected, absent) => {
    flowFetch({ state: { client, accounts: STATE.accounts } });
    renderPanel();
    const summary = await screen.findByTestId("gmail-setup-summary");
    expect(summary.textContent).toContain(expected);
    if (absent) expect(summary.textContent).not.toContain(absent);
  });
});

describe("test-plan #E9 — visible focus on every control", () => {
  it("every button, select, input, summary and link carries focus-ring", async () => {
    flowFetch({ state: { ...STATE, accounts: [STATE.accounts[0]] } });
    renderPanel();
    await startWaitingFlow();
    const section = screen.getByTestId("gmail-settings");
    const controls = [...section.querySelectorAll("button, select, input, summary, a")];
    expect(controls.length).toBeGreaterThan(10);
    for (const el of controls) expect(el.classList.contains("focus-ring"), el.outerHTML.slice(0, 120)).toBe(true);
  });
});

describe("test-plan #E10 / #E11 — level descriptions and add-account guidance", () => {
  it("#E10 help keeps the scope-limit statements; every level option describes itself", async () => {
    flowFetch();
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    const help = screen.getByTestId("gmail-level-help").textContent ?? "";
    expect(help).toMatch(/not by Google/);
    expect(help).toMatch(/any session on this dashboard can use every account within its level/i);
    const opts = [...within(rows[0] as HTMLElement).getByTestId("gmail-account-level").querySelectorAll("option")];
    for (const o of opts) expect(o.textContent).toMatch(/^(readonly|draft|send) — \S.+/);
  });

  it("#E11 the add-account level select has a visible label and a cross-org hint", async () => {
    flowFetch();
    renderPanel();
    const select = (await screen.findByTestId("gmail-new-level")) as HTMLSelectElement;
    expect(select.labels?.length).toBeGreaterThan(0);
    expect(select.labels?.[0]?.textContent).toMatch(/Level for the new account/);
    const hint = screen.getByTestId("gmail-cross-org-hint").textContent ?? "";
    expect(hint).toMatch(/External/);
    expect(hint).toMatch(/organization/);
  });
});

// ── retro-ux-plugin-settings-forms ───────────────────────────────────────────

describe("retro-ux — account status, names and the primary action", () => {
  it("#E17 status pills read Connected / Re-auth needed and keep data-status", async () => {
    flowFetch();
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    const ok = within(rows[0] as HTMLElement).getByTestId("gmail-account-status");
    const re = within(rows[1] as HTMLElement).getByTestId("gmail-account-status");
    expect([ok.textContent, ok.dataset.status]).toEqual(["Connected", "ok"]);
    expect([re.textContent, re.dataset.status]).toEqual(["Re-auth needed", "reauth_required"]);
  });

  it("#E18 disabled Add account links a visible reason; per-account names; cross-org hint kept", async () => {
    flowFetch({ state: { client: { configured: false }, accounts: [] } });
    renderPanel();
    const add = (await screen.findByTestId("gmail-add-account")) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const reason = document.getElementById(add.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toMatch(/Upload the OAuth client JSON/);
    expect(add.className).toContain("--accent-solid");
    cleanup();
    flowFetch();
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    const row = within(rows[0] as HTMLElement);
    expect(row.getByRole("textbox", { name: "Alias for a@x.com" })).toBeTruthy();
    expect(row.getByRole("combobox", { name: "Level for a@x.com" })).toBeTruthy();
    expect(row.getByRole("button", { name: "Revoke a@x.com" })).toBeTruthy();
    expect(screen.getByTestId("gmail-cross-org-hint")).toBeTruthy();
  });

  it.each([
    ["not configured", { configured: false }, [], "1"],
    ["org_internal reported", { configured: true, clientId: "c.apps.googleusercontent.com" }, [STATE.accounts[0]], "3"],
  ])("#E19 %s → aria-current on step %s", async (name, client, accounts, expected) => {
    flowFetch({ state: { client, accounts } });
    renderPanel();
    await screen.findByTestId("gmail-wizard");
    if (name === "org_internal reported") {
      await startWaitingFlow();
      fireEvent.click(screen.getByTestId("gmail-report-org_internal"));
      await screen.findByTestId("gmail-flow-error");
    }
    const current = [...document.querySelectorAll('[aria-current="step"]')].map((el) => (el as HTMLElement).dataset.testid);
    expect(current).toEqual([`gmail-step-${expected}`]);
    if (name === "not configured") expect(document.querySelectorAll("[data-done]").length).toBe(0);
  });

  it("#X3 a failed sign-in renders inside an error notice naming the step and the code", async () => {
    flowFetch({ statusReplies: [pendingStatus, { flowId: "f1", provider: "gmail", status: "error", error: "access_denied" }] });
    renderPanel();
    await startWaitingFlow();
    const err = await screen.findByTestId("gmail-flow-error", undefined, { timeout: 2000 });
    expect(err.dataset.step).toBe("3");
    expect(err.textContent).toMatch(/step 3/);
    expect(err.textContent).toContain("access_denied");
    expect(err.closest('[data-tone="error"]')).toBeTruthy();
  });

  it("#X4 an upload error is linked by describedby and marks the input invalid", async () => {
    flowFetch({ state: { client: { configured: false }, accounts: [] } });
    renderPanel();
    const input = (await screen.findByTestId("gmail-client-upload")) as HTMLInputElement;
    const file = new File([JSON.stringify({ web: { client_id: "x.apps.googleusercontent.com", client_secret: "s" } })], "c.json", {
      type: "application/json",
    });
    fireEvent.change(input, { target: { files: [file] } });
    const err = await screen.findByTestId("gmail-upload-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(err.id);
  });
});

// See change: audit-plugin-bundles-non-secure-context (test-plan #F5–#F7).
describe("gcloud Copyable", () => {
  const UNCONFIGURED = { client: { configured: false }, accounts: [], setup: { projectId: "pidashboard-510015" } };
  const stubExec = (ok: boolean) => {
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => ok);
  };
  const open = async () => {
    mockFetch({ "GET /api/plugins/gmail/state": () => UNCONFIGURED });
    renderPanel();
    const step = await screen.findByTestId("gmail-step-1");
    return within(step).getAllByRole("button", { name: /^Copy$/ })[0] as HTMLElement;
  };
  const status = (b: HTMLElement) => b.querySelector('[role="status"]')?.textContent;

  it("F5 failure shows 'Copy failed' (never 'Copied') and reverts after 1500 ms", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    stubExec(false);
    const b = await open();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(b);
      await vi.waitFor(() => expect(status(b)).toBe("Copy failed"));
      expect(b.textContent).not.toMatch(/Copied/);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(status(b)).toBe("Copy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("F6 execCommand fallback shows 'Copied' and reverts", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    stubExec(true);
    const b = await open();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(b);
      await vi.waitFor(() => expect(status(b)).toBe("Copied"));
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(status(b)).toBe("Copy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("F7 latest click wins over a late earlier failure", async () => {
    stubExec(false);
    let rejectA!: (e: unknown) => void;
    let resolveB!: () => void;
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_, rej) => (rejectA = rej)))
      .mockImplementationOnce(() => new Promise<void>((res) => (resolveB = res)));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const b = await open();
    fireEvent.click(b);
    fireEvent.click(b);
    await act(async () => resolveB());
    await waitFor(() => expect(status(b)).toBe("Copied"));
    await act(async () => rejectA(new Error("late")));
    expect(status(b)).toBe("Copied");
  });
});

// ── improve-gmail-plugin-setup-ux ────────────────────────────────────────────

const ID_OK = "pidashboard-510015";
const OWNER_OK = "csakany.robert@gmail.com";
const UNCONFIGURED_STATE = { client: { configured: false }, accounts: [] as unknown[] };

interface Recorded {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

/** Fetch fake for step-1 tests: records every call; PUT /client answers with `clientReply`. */
function setupFetch(
  state: unknown,
  opts: { clientReply?: { status: number; body: unknown }; extra?: (r: Recorded) => unknown } = {},
) {
  const calls: Recorded[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const rec: Recorded = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(rec);
    const extra = opts.extra?.(rec);
    if (extra !== undefined) return json(extra);
    if (url === "/api/plugins/gmail/state") return json(state);
    if (url === "/api/plugins/gmail/setup" && rec.method === "PUT") return json({ ok: true });
    if (url === "/api/plugins/gmail/client" && rec.method === "PUT") {
      const r = opts.clientReply ?? { status: 200, body: { ok: true } };
      return json(r.body, r.status);
    }
    return json({ error: "nope" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, puts: (path: string) => calls.filter((c) => c.method === "PUT" && c.url === `/api/plugins/gmail${path}`) };
}

const projectInput = () => screen.getByTestId("gmail-project-id") as HTMLInputElement;
const ownerInput = () => screen.getByTestId("gmail-owner-account") as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const leave = (el: HTMLElement) => fireEvent.focusOut(el);
const hrefs = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

async function uploadClient(projectId: string | undefined) {
  const content = JSON.stringify({
    installed: { client_id: "x.apps.googleusercontent.com", client_secret: "s", ...(projectId ? { project_id: projectId } : {}) },
  });
  const input = (await screen.findByTestId("gmail-client-upload")) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([content], "client_secret_1.json", { type: "application/json" })] } });
}

describe("test-plan #E7 — saved setup is restored", () => {
  it("fields show the saved values and the mode defaults to existing", async () => {
    setupFetch({ ...UNCONFIGURED_STATE, setup: { projectId: ID_OK, ownerAccount: OWNER_OK } });
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    expect(projectInput().value).toBe(ID_OK);
    expect(ownerInput().value).toBe(OWNER_OK);
    expect((screen.getByTestId("gmail-project-mode-existing") as HTMLInputElement).checked).toBe(true);
  });

  it("with nothing saved the mode defaults to new", async () => {
    setupFetch(UNCONFIGURED_STATE);
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    expect((screen.getByTestId("gmail-project-mode-new") as HTMLInputElement).checked).toBe(true);
  });
});

describe("test-plan #E8 — a display name is explained, not used", () => {
  it("shows no error while typing; after blur names the id/name difference with a project-list link", async () => {
    const h = setupFetch(UNCONFIGURED_STATE);
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    type(projectInput(), "PiDashboard");
    expect(screen.queryByTestId("gmail-project-error")).toBeNull();
    expect(screen.getByTestId("gmail-need-project-id")).toBeTruthy();
    leave(projectInput());
    const err = await screen.findByTestId("gmail-project-error");
    expect(err.textContent).toMatch(/project name/i);
    expect(err.textContent).toMatch(/project id/i);
    expect(projectInput().getAttribute("aria-invalid")).toBe("true");
    expect(projectInput().getAttribute("aria-describedby")?.split(" ")).toContain(err.id);
    const hint = document.getElementById(`${err.id.replace(/-error$/, "")}-hint`) as HTMLElement;
    expect(within(hint).getByRole("link").getAttribute("href")).toContain("cloud-resource-manager");
    expect(h.puts("/setup")).toHaveLength(0);
    expect(hrefs().some((x) => x.includes("project=PiDashboard"))).toBe(false);
    expect(document.body.textContent).not.toContain("<project-id>");
  });
});

describe("test-plan #E9 — the error clears on the valid keystroke", () => {
  it("clears when the value turns valid; the next blur saves once", async () => {
    const h = setupFetch(UNCONFIGURED_STATE);
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    type(projectInput(), "pid");
    leave(projectInput());
    await screen.findByTestId("gmail-project-error");
    expect(h.puts("/setup")).toHaveLength(0);
    type(projectInput(), ID_OK);
    expect(screen.queryByTestId("gmail-project-error")).toBeNull();
    leave(projectInput());
    await waitFor(() => expect(h.puts("/setup")).toHaveLength(1));
    expect(h.puts("/setup")[0]?.body).toEqual({ projectId: ID_OK });
  });
});

describe("test-plan #E10 — new vs existing project path", () => {
  it("create link + command only in new; project list + gcloud projects list only in existing; enable in both", async () => {
    setupFetch({ ...UNCONFIGURED_STATE, setup: { projectId: ID_OK } });
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    const text = () => document.body.textContent ?? "";
    // existing (default: a project id is saved)
    expect(text()).toContain("gcloud projects list");
    expect(hrefs().some((x) => x.includes("cloud-resource-manager"))).toBe(true);
    expect(text()).not.toContain(`gcloud projects create ${ID_OK}`);
    expect(hrefs().some((x) => x.includes("/projectcreate"))).toBe(false);
    expect(text()).toContain(`gcloud services enable gmail.googleapis.com --project ${ID_OK}`);
    fireEvent.click(screen.getByTestId("gmail-project-mode-new"));
    expect(text()).toContain(`gcloud projects create ${ID_OK}`);
    expect(hrefs().some((x) => x.includes("/projectcreate"))).toBe(true);
    expect(text()).not.toContain("gcloud projects list");
    expect(text()).toContain(`gcloud services enable gmail.googleapis.com --project ${ID_OK}`);
  });
});

describe("test-plan #E11 — owner account", () => {
  it("a valid owner adds the auth-login command with its note; an invalid one is flagged and not applied", async () => {
    setupFetch({ ...UNCONFIGURED_STATE, setup: { projectId: ID_OK } });
    renderPanel();
    await screen.findByTestId("gmail-owner-account");
    type(ownerInput(), OWNER_OK);
    expect(screen.getByTestId("gmail-auth-login-note").textContent).toMatch(/once first|first/i);
    expect(document.body.textContent).toContain(`gcloud auth login ${OWNER_OK}`);
    expect(document.body.textContent).toContain(`--account ${OWNER_OK}`);
    expect(hrefs().some((x) => x.includes("authuser=csakany.robert%40gmail.com"))).toBe(true);
    type(ownerInput(), "robson@");
    leave(ownerInput());
    expect(await screen.findByTestId("gmail-owner-error")).toBeTruthy();
    expect(screen.queryByTestId("gmail-auth-login-note")).toBeNull();
    expect(document.body.textContent).not.toContain("--account");
    expect(hrefs().some((x) => x.includes("authuser"))).toBe(false);
  });
});

describe("test-plan #E12 — uploaded client vs saved project id", () => {
  it("different ids → mismatch naming both, with a one-click replace", async () => {
    const h = setupFetch({ ...UNCONFIGURED_STATE, setup: { projectId: ID_OK } }, { clientReply: { status: 200, body: { ok: true, projectId: "other-project-123" } } });
    renderPanel();
    await uploadClient("other-project-123");
    const notice = await screen.findByTestId("gmail-project-mismatch");
    expect(notice.textContent).toContain(ID_OK);
    expect(notice.textContent).toContain("other-project-123");
    expect(h.puts("/setup")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Use other-project-123" }));
    await waitFor(() => expect(h.puts("/setup")).toHaveLength(1));
    expect(h.puts("/setup")[0]?.body).toEqual({ projectId: "other-project-123" });
    expect(screen.queryByTestId("gmail-project-mismatch")).toBeNull();
  });

  it("nothing saved → the client's id is adopted, no notice", async () => {
    const h = setupFetch(UNCONFIGURED_STATE, { clientReply: { status: 200, body: { ok: true, projectId: ID_OK } } });
    renderPanel();
    await uploadClient(ID_OK);
    await waitFor(() => expect(h.puts("/setup")).toHaveLength(1));
    expect(h.puts("/setup")[0]?.body).toEqual({ projectId: ID_OK });
    expect(screen.queryByTestId("gmail-project-mismatch")).toBeNull();
    expect(projectInput().value).toBe(ID_OK);
  });

  it.each([
    ["the JSON has no usable project id", undefined],
    ["the JSON id equals the saved id", ID_OK],
  ])("%s → no PUT /setup, no notice", async (_label, jsonId) => {
    const h = setupFetch({ ...UNCONFIGURED_STATE, setup: { projectId: ID_OK } }, { clientReply: { status: 200, body: { ok: true, ...(jsonId ? { projectId: jsonId } : {}) } } });
    renderPanel();
    await uploadClient(jsonId);
    await waitFor(() => expect(h.puts("/client")).toHaveLength(1));
    await sleep(20);
    expect(h.puts("/setup")).toHaveLength(0);
    expect(screen.queryByTestId("gmail-project-mismatch")).toBeNull();
  });
});

describe("test-plan #E13 — a typed id is saved before the upload is compared", () => {
  it("PUT /setup precedes PUT /client and the notice names both ids", async () => {
    const h = setupFetch(UNCONFIGURED_STATE, { clientReply: { status: 200, body: { ok: true, projectId: "other-project-123" } } });
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    type(projectInput(), ID_OK); // typed, never blurred
    await uploadClient("other-project-123");
    const notice = await screen.findByTestId("gmail-project-mismatch");
    const order = h.calls.filter((c) => c.method === "PUT").map((c) => c.url);
    expect(order.indexOf("/api/plugins/gmail/setup")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("/api/plugins/gmail/setup")).toBeLessThan(order.indexOf("/api/plugins/gmail/client"));
    expect(notice.textContent).toContain(ID_OK);
    expect(notice.textContent).toContain("other-project-123");
  });

  it("a failed flush aborts the upload", async () => {
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") puts.push(url);
        if (url.endsWith("/state")) return json(UNCONFIGURED_STATE);
        if (url.endsWith("/setup")) return json({ error: "boom" }, 500);
        return json({ ok: true });
      }),
    );
    renderPanel();
    await screen.findByTestId("gmail-project-id");
    type(projectInput(), ID_OK);
    await uploadClient(ID_OK);
    const err = await screen.findByTestId("gmail-upload-error");
    expect(err.dataset.step).toBe("1");
    expect(puts.some((u) => u.endsWith("/client"))).toBe(false);
  });
});

describe("test-plan #E14 — client_in_use keeps its own path", () => {
  it("shows the in-use error at step 5, no mismatch, and no compare PUT /setup", async () => {
    const h = setupFetch(
      { client: { configured: true, clientId: "x.apps.googleusercontent.com" }, accounts: [STATE.accounts[0]], setup: { projectId: ID_OK } },
      { clientReply: { status: 409, body: { error: "client_in_use", step: 5 } } },
    );
    renderPanel();
    await uploadClient("other-project-123");
    const err = await screen.findByTestId("gmail-upload-error");
    expect(err.dataset.step).toBe("5");
    expect(screen.queryByTestId("gmail-project-mismatch")).toBeNull();
    expect(h.puts("/setup")).toHaveLength(0);
  });
});

describe("test-plan #E15 — step-1 fields carry a real hint", () => {
  it.each([["gmail-project-id"], ["gmail-owner-account"]])("%s has a non-empty hint referenced by aria-describedby", async (testId) => {
    setupFetch(UNCONFIGURED_STATE);
    renderPanel();
    const input = (await screen.findByTestId(testId)) as HTMLInputElement;
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    const hint = document.getElementById(ids[0] as string) as HTMLElement;
    expect(hint.textContent?.trim().length).toBeGreaterThan(10);
  });
});

describe("test-plan #E31 — filters control", () => {
  const FILTER_STATE = {
    client: { configured: true, clientId: "x.apps.googleusercontent.com" },
    accounts: [{ sub: "s9", email: "anna@blackbelt.hu", tier: "send", status: "ok", addedAt: 1 }],
  };

  it("is named after the account, toggles on then off through POST, and shows no flow on off", async () => {
    const h = setupFetch(FILTER_STATE, {
      extra: (r) => (r.url.endsWith("/accounts/s9/filters") ? { applied: true } : undefined),
    });
    renderPanel();
    const box = (await screen.findByRole("checkbox", { name: "Filters for anna@blackbelt.hu" })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(true));
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
    const posts = h.calls.filter((c) => c.method === "POST" && c.url.endsWith("/accounts/s9/filters"));
    expect(posts.map((p) => p.body)).toEqual([{ enabled: true }, { enabled: false }]);
    expect(screen.queryByTestId("flow-view")).toBeNull();
  });

  it("turning on that needs consent starts the sign-in flow", async () => {
    setupFetch(FILTER_STATE, { extra: (r) => (r.url.endsWith("/accounts/s9/filters") ? { flowId: "f1" } : undefined) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/state")) return json(FILTER_STATE);
        if (url.endsWith("/accounts/s9/filters")) return json({ flowId: "f1" });
        if (url === FLOW_URL) return json(pendingStatus);
        return json({}, 404);
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Filters for anna@blackbelt.hu" }));
    expect(await screen.findByTestId("flow-view")).toBeTruthy();
  });
});
