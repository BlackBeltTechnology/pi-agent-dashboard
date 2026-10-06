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
    expect(within(rows[1] as HTMLElement).getByTestId("gmail-account-status").textContent).toBe("re-auth needed");
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
    expect(err.textContent).toMatch(/every permission/);
    expect(err.dataset.step).toBe("");
  });
});

describe("test-plan #E12 — consent hint", () => {
  it("shows the tick-every-permission hint only while a sign-in is waiting", async () => {
    flowFetch();
    renderPanel();
    await screen.findByTestId("gmail-add-account");
    expect(screen.queryByTestId("gmail-consent-hint")).toBeNull();
    await startWaitingFlow();
    const hint = screen.getByTestId("gmail-consent-hint");
    expect(hint.textContent).toMatch(/tick every permission/);
    expect(hint.textContent).toMatch(/Select all/);
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
