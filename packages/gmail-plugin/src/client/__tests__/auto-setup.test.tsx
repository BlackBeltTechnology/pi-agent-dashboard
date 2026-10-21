// @vitest-environment jsdom
/**
 * L1 tests for "Set up automatically": entry per `autoSetup` (F1), run progress by 1 s
 * polling (F2), busy takeover (F3), hand-off into the manual wizard (F4), i18n parity (F6)
 * and the unverified-app sign-in notice (E11). Fetch is stubbed; only the interval timers
 * are faked so Testing Library's own waiting keeps working.
 * See change: add-gmail-auto-setup (test-plan #E11, #F1–#F4, #F6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiConfirmDialogProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../../i18n.js";
import {
  type AutoSetupState,
  type CheckpointKind,
  DEFAULT_PUBLISH_LINKS,
  type SetupRunState,
  type SetupRunView,
  type SetupStepId,
  WIZARD_STEP_OF,
} from "../../shared/auto-setup.js";
import { CHECKPOINT_KEY, HANDOFF_KEY, handoffKey, LINK_ERROR_KEY, showUnverifiedNotice, startErrorKey, validateLinks } from "../auto-setup.js";
import { GmailSettings } from "../GmailSettings.js";
import { ERROR_EN } from "../wizard.js";

const STATE_URL = "/api/plugins/gmail/state";
const RUN_URL = "/api/plugins/gmail/setup/run";
const VIEW_URL = `${RUN_URL}/r1`;
const FLOW_URL = "/api/provider-auth/flow/f1";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const STEP_IDS: SetupStepId[] = ["project", "api", "branding", "publish", "client", "capture"];

/** A run view; steps before `step` are done, `step` is running (or handoff), the rest pending. */
function view(state: SetupRunState, step: SetupStepId, extra: Partial<SetupRunView> = {}): SetupRunView {
  const at = STEP_IDS.indexOf(step);
  return {
    runId: "r1",
    state,
    step,
    steps: STEP_IDS.map((id, i) => ({
      id,
      status: i < at ? "done" : i === at ? (state === "handoff" ? "handoff" : "running") : "pending",
    })),
    created: { clients: [] },
    ownerEmail: "owner@gmail.com",
    ...extra,
  };
}

const ACCOUNT = { sub: "s1", email: "a@x.com", tier: "send", status: "ok", addedAt: 1 };
const configuredState = (autoSetup?: AutoSetupState, extra: Record<string, unknown> = {}) => ({
  client: { configured: true, clientId: "x.apps.googleusercontent.com" },
  accounts: [],
  ...(autoSetup ? { autoSetup } : {}),
  ...extra,
});
const AVAILABLE: AutoSetupState = { available: true, local: true };

interface Script {
  state?: unknown;
  /** Replies to `GET setup/run/r1`, consumed one per request; the last repeats. */
  views?: SetupRunView[];
  /** Status for `POST setup/run`. */
  start?: { status: number; body: unknown };
  /** Status for `GET setup/run/r1` (e.g. 404). */
  viewStatus?: number;
}

const startReply = (script: Script): Response => (script.start ? json(script.start.body, script.start.status) : json({ runId: "r1" }));
const viewReply = (script: Script, next: () => SetupRunView): Response =>
  script.viewStatus ? json({ error: "not_found" }, script.viewStatus) : json(next());

function scriptedFetch(script: Script = {}) {
  let n = 0;
  const views = script.views ?? [view("running", "project")];
  const next = (): SetupRunView => views[Math.min(n++, views.length - 1)] as SetupRunView;
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const routes: Record<string, () => Response> = {
    [`GET ${STATE_URL}`]: () => json(script.state ?? configuredState(AVAILABLE)),
    [`POST ${RUN_URL}`]: () => startReply(script),
    [`GET ${VIEW_URL}`]: () => viewReply(script, next),
    [`DELETE ${VIEW_URL}`]: () => json({ ok: true }),
    [`POST ${VIEW_URL}/continue`]: () => json({ ok: true }),
    [`POST ${VIEW_URL}/takeover`]: () => json({ ok: true }),
    "POST /api/plugins/gmail/accounts": () => json({ flowId: "f1" }),
    [`GET ${FLOW_URL}`]: () => json({ flowId: "f1", provider: "gmail", status: "pending", authUrl: "https://accounts.google.com/x" }),
  };
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return routes[`${method} ${url}`]?.() ?? json({ error: "nope" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls, viewGets: () => calls.filter((c) => c.method === "GET" && c.url === VIEW_URL).length };
}

function renderSettings() {
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

/** Open the start form, fill the owner email and press Start. */
async function startRun(owner = "owner@gmail.com") {
  fireEvent.click(await screen.findByTestId("gmail-setup-entry"));
  fireEvent.change(screen.getByTestId("gmail-setup-owner"), { target: { value: owner } });
  fireEvent.click(screen.getByTestId("gmail-setup-start"));
  await screen.findByTestId("gmail-setup-run");
}

/** Advance the fake 1 s poll timer once and let the fetch settle. */
const tick = (ms = 1000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const primaryButtons = () =>
  [...document.querySelectorAll("button")].filter((b) => b.className.includes("bg-[var(--accent-solid)]") && b.getAttribute("role") !== "switch");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("test-plan #F1 — entry point per autoSetup", () => {
  const cases: Array<{
    name: string;
    autoSetup: AutoSetupState | undefined;
    entry: boolean;
    replace: boolean;
    remote: boolean;
  }> = [
    { name: "available", autoSetup: AVAILABLE, entry: true, replace: false, remote: false },
    { name: "available + replace", autoSetup: { ...AVAILABLE, replacesClient: true }, entry: true, replace: true, remote: false },
    { name: "unavailable (no Chrome)", autoSetup: { available: false, reason: "no-chrome", local: true }, entry: false, replace: false, remote: false },
    { name: "unavailable (older server)", autoSetup: undefined, entry: false, replace: false, remote: false },
    {
      name: "remote dashboard",
      autoSetup: { available: false, reason: "remote_dashboard", local: false },
      entry: false,
      replace: false,
      remote: true,
    },
  ];
  it.each(cases)("$name → entry/replace/remote as specified and exactly one primary button", async (c) => {
    scriptedFetch({ state: configuredState(c.autoSetup) });
    renderSettings();
    await screen.findByTestId("gmail-add-account");
    expect(!!screen.queryByTestId("gmail-setup-entry")).toBe(c.entry);
    expect(!!screen.queryByTestId("gmail-setup-replace")).toBe(c.replace);
    expect(!!screen.queryByTestId("gmail-setup-remote")).toBe(c.remote);
    expect(primaryButtons().map((b) => b.dataset.testid)).toEqual(["gmail-add-account"]);
    if (c.entry) {
      const entry = screen.getByTestId("gmail-setup-entry");
      expect(entry.textContent).toBe("Set up automatically");
      expect(entry.className).not.toContain("--accent-solid");
      // The start form keeps the rule: still one primary, every form button secondary.
      fireEvent.click(entry);
      expect(entry.getAttribute("aria-expanded")).toBe("true");
      expect(primaryButtons().map((b) => b.dataset.testid)).toEqual(["gmail-add-account"]);
    }
    if (c.replace) expect(screen.getByTestId("gmail-setup-replace").textContent).toMatch(/replaces it with a new client/);
    if (c.remote) expect(screen.getByTestId("gmail-setup-remote").textContent).toMatch(/computer that runs the dashboard/);
  });

  it("the start form uses labelled settings fields and posts mode, project id and owner email", async () => {
    const h = scriptedFetch({ state: configuredState(AVAILABLE, { setup: { projectId: "pidashboard-510015", ownerAccount: "me@gmail.com" } }) });
    renderSettings();
    fireEvent.click(await screen.findByTestId("gmail-setup-entry"));
    const form = within(screen.getByTestId("gmail-setup-form"));
    const project = form.getByLabelText("Project id") as HTMLInputElement;
    const owner = form.getByLabelText("Google account that owns the project") as HTMLInputElement;
    expect([project.value, owner.value]).toEqual(["pidashboard-510015", "me@gmail.com"]); // prefilled from the saved setup
    expect((screen.getByTestId("gmail-setup-mode-existing") as HTMLInputElement).checked).toBe(true);
    // An invalid owner blocks the request and says why.
    fireEvent.change(owner, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByTestId("gmail-setup-start"));
    expect((await screen.findByTestId("gmail-setup-owner-error")).textContent).toMatch(/full email address/);
    expect(h.calls.some((c) => c.url === RUN_URL)).toBe(false);
    fireEvent.change(owner, { target: { value: "  Me@Gmail.com " } });
    fireEvent.click(screen.getByTestId("gmail-setup-start"));
    await screen.findByTestId("gmail-setup-run");
    expect(h.calls.find((c) => c.url === RUN_URL)?.body).toEqual({ mode: "existing", ownerEmail: "me@gmail.com", projectId: "pidashboard-510015" });
  });

  it("existing mode needs a valid project id; new mode may leave it empty", async () => {
    const h = scriptedFetch();
    renderSettings();
    fireEvent.click(await screen.findByTestId("gmail-setup-entry"));
    fireEvent.change(screen.getByTestId("gmail-setup-owner"), { target: { value: "me@gmail.com" } });
    fireEvent.click(screen.getByTestId("gmail-setup-mode-existing"));
    fireEvent.change(screen.getByTestId("gmail-setup-project-id"), { target: { value: "PiDashboard" } });
    fireEvent.click(screen.getByTestId("gmail-setup-start"));
    expect((await screen.findByTestId("gmail-setup-project-error")).textContent).toMatch(/project name/);
    expect(h.calls.some((c) => c.url === RUN_URL)).toBe(false);
    fireEvent.change(screen.getByTestId("gmail-setup-project-id"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("gmail-setup-mode-new"));
    fireEvent.click(screen.getByTestId("gmail-setup-start"));
    await screen.findByTestId("gmail-setup-run");
    expect(h.calls.find((c) => c.url === RUN_URL)?.body).toEqual({ mode: "new", ownerEmail: "me@gmail.com" });
  });

  it.each([
    [409, "run_active", /already running/],
    [403, "remote_dashboard", /only starts from the computer/],
    [400, { error: "invalid_project_id", message: "project id must be 6-30 characters" }, /project id must be 6-30 characters/],
  ])("a refused start (%i %j) is shown as a sentence and starts no run", async (status, error, text) => {
    scriptedFetch({ start: { status: status as number, body: typeof error === "string" ? { error } : error } });
    renderSettings();
    fireEvent.click(await screen.findByTestId("gmail-setup-entry"));
    fireEvent.change(screen.getByTestId("gmail-setup-owner"), { target: { value: "me@gmail.com" } });
    fireEvent.click(screen.getByTestId("gmail-setup-start"));
    expect((await screen.findByTestId("gmail-setup-start-error")).textContent).toMatch(text);
    expect(screen.queryByTestId("gmail-setup-run")).toBeNull();
  });
});

describe("test-plan #F2 — run progress by 1 s polling", () => {
  const owned = { ownerEmail: "owner@gmail.com" };
  const sequence: SetupRunView[] = [
    view("running", "project"),
    view("running", "api"),
    view("waiting_user", "branding", { checkpoint: { kind: "policy" } }),
    view("waiting_decision", "branding", { decision: { kind: "audience", detected: "internal", org: "blackbelt.hu" } }),
    view("busy", "publish", { busy: { holder: "agent session 7" } }),
    view("done", "capture", { ...owned, clientId: "x.apps.googleusercontent.com", steps: STEP_IDS.map((id) => ({ id, status: "done" as const })) }),
  ];

  it("chips track step, prompts follow the state, and Add account is prefilled when done", async () => {
    const h = scriptedFetch({ views: sequence });
    renderSettings();
    await startRun();
    const chip = (id: SetupStepId) => screen.getByTestId(`gmail-setup-step-${id}`);
    const current = () => [...document.querySelectorAll('[data-testid^="gmail-setup-step-"][aria-current="step"]')].map((e) => (e as HTMLElement).dataset.testid);

    // 1: running at project
    await waitFor(() => expect(current()).toEqual(["gmail-setup-step-project"]));
    expect(screen.getByTestId("gmail-setup-working")).toBeTruthy();
    expect(h.viewGets()).toBe(1);
    // Poll cadence: nothing before 1 s, one request at 1 s.
    await tick(999);
    expect(h.viewGets()).toBe(1);
    await tick(1);
    await waitFor(() => expect(h.viewGets()).toBe(2));
    // 2: running at api, project done
    await waitFor(() => expect(current()).toEqual(["gmail-setup-step-api"]));
    expect(chip("project").dataset.status).toBe("done");
    expect(chip("project").textContent).toContain("done"); // never colour alone: sr-only status word
    // 3: waiting_user policy → plain-language prompt, run's own tab never ticks it
    await tick();
    const cp = await screen.findByTestId("gmail-setup-checkpoint");
    expect(cp.textContent).toMatch(/Tick .*User Data Policy.* yourself/);
    expect(cp.textContent).toMatch(/never ticks it for you/);
    expect(current()).toEqual(["gmail-setup-step-branding"]);
    // 4: waiting_decision audience → Internal offered (organization), External too
    await tick();
    const aud = await screen.findByTestId("gmail-setup-audience");
    expect(aud.textContent).toContain("blackbelt.hu");
    expect(screen.getByTestId("gmail-setup-audience-internal")).toBeTruthy();
    expect(screen.getByTestId("gmail-setup-audience-external")).toBeTruthy();
    expect(screen.queryByTestId("gmail-setup-checkpoint")).toBeNull();
    // 5: busy → holder + Take over
    await tick();
    expect((await screen.findByTestId("gmail-setup-busy-holder")).textContent).toContain("agent session 7");
    expect(screen.getByTestId("gmail-setup-takeover").textContent).toBe("Take over");
    // 6: done → success, polling stops, Add account prefilled with the owner email
    await tick();
    await screen.findByTestId("gmail-setup-done");
    expect((screen.getByTestId("gmail-add-email") as HTMLInputElement).value).toBe("owner@gmail.com");
    expect((screen.getByTestId("gmail-add-account") as HTMLButtonElement).disabled).toBe(false);
    const gets = h.viewGets();
    await tick(5000);
    expect(h.viewGets()).toBe(gets);
    // The prefilled email is sent as `email` (login_hint).
    fireEvent.click(screen.getByTestId("gmail-add-account"));
    await screen.findByTestId("flow-view");
    expect(h.calls.find((c) => c.url === "/api/plugins/gmail/accounts")?.body).toEqual({ tier: "readonly", email: "owner@gmail.com" });
    expect(primaryButtons().length).toBeLessThanOrEqual(1);
  });

  it("without a run email the add-account email stays empty and is not sent", async () => {
    const h = scriptedFetch();
    renderSettings();
    fireEvent.click(await screen.findByTestId("gmail-add-account"));
    await screen.findByTestId("flow-view");
    expect(h.calls.find((c) => c.url === "/api/plugins/gmail/accounts")?.body).toEqual({ tier: "readonly" });
  });

  it("an invalid add-account email blocks the request", async () => {
    const h = scriptedFetch();
    renderSettings();
    fireEvent.change(await screen.findByTestId("gmail-add-email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("gmail-add-account"));
    expect((await screen.findByTestId("gmail-add-email-error")).textContent).toMatch(/full email address/);
    expect(h.calls.some((c) => c.url === "/api/plugins/gmail/accounts")).toBe(false);
  });

  it("a personal account is offered External only", async () => {
    scriptedFetch({ views: [view("waiting_decision", "branding", { decision: { kind: "audience", detected: "external" } })] });
    renderSettings();
    await startRun();
    await screen.findByTestId("gmail-setup-audience");
    expect(screen.queryByTestId("gmail-setup-audience-internal")).toBeNull();
    expect(screen.getByTestId("gmail-setup-audience-external")).toBeTruthy();
    expect(screen.getByTestId("gmail-setup-audience").textContent).toMatch(/hasn.t verified this app/);
  });

  it.each<[CheckpointKind, RegExp]>([
    ["sign_in", /Sign in to Google in the dedicated browser window/],
    ["console_terms", /accept its terms of service/],
    ["policy", /User Data Policy/],
    ["publish", /Push to production/],
  ])("checkpoint %s has its own prompt; only sign_in offers 'I've signed in'", async (kind, text) => {
    const h = scriptedFetch({ views: [view("waiting_user", "project", { checkpoint: { kind } })] });
    renderSettings();
    await startRun();
    const cp = await screen.findByTestId("gmail-setup-checkpoint");
    expect(cp.textContent).toMatch(text);
    expect(CHECKPOINT_KEY[kind]).toMatch(/^autoCp/);
    const signed = screen.queryByTestId("gmail-setup-signed-in");
    expect(!!signed).toBe(kind === "sign_in");
    if (signed) {
      fireEvent.click(signed);
      await waitFor(() => expect(h.calls.filter((c) => c.url === `${VIEW_URL}/continue`)).toHaveLength(1));
      expect(h.calls.find((c) => c.url === `${VIEW_URL}/continue`)?.body).toEqual({});
    }
  });

  it("audience choice posts it and Internal drops the unverified-app notice (E11)", async () => {
    const h = scriptedFetch({ views: [view("waiting_decision", "branding", { decision: { kind: "audience", detected: "internal", org: "o.com" } })] });
    renderSettings();
    await startRun();
    fireEvent.click(await screen.findByTestId("gmail-setup-audience-internal"));
    await waitFor(() => expect(h.calls.find((c) => c.url === `${VIEW_URL}/continue`)?.body).toEqual({ audience: "internal" }));
  });

  it("links decision: editable defaults, confirm checkbox required, posts links + confirmLinks", async () => {
    const h = scriptedFetch({ views: [view("waiting_decision", "publish", { decision: { kind: "links", links: DEFAULT_PUBLISH_LINKS } })] });
    renderSettings();
    await startRun();
    await screen.findByTestId("gmail-setup-links");
    expect((screen.getByTestId("gmail-setup-link-home") as HTMLInputElement).value).toBe(DEFAULT_PUBLISH_LINKS.homePage);
    expect(screen.getByTestId("gmail-setup-links").textContent).toMatch(/appear on Google's consent screen for every account/);
    const go = screen.getByTestId("gmail-setup-links-continue") as HTMLButtonElement;
    expect(go.disabled).toBe(true); // explicit confirmation first
    fireEvent.click(screen.getByLabelText(/I understand these links appear/));
    expect(go.disabled).toBe(false);
    // A link off the authorized domain is refused locally.
    fireEvent.change(screen.getByTestId("gmail-setup-link-privacy"), { target: { value: "https://evil.example/privacy" } });
    expect(screen.getByTestId("gmail-setup-link-privacy-error").textContent).toMatch(/authorized domain/);
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("gmail-setup-link-privacy"), { target: { value: "https://github.com/me/repo/privacy" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(h.calls.find((c) => c.url === `${VIEW_URL}/continue`)).toBeTruthy());
    expect(h.calls.find((c) => c.url === `${VIEW_URL}/continue`)?.body).toEqual({
      links: { ...DEFAULT_PUBLISH_LINKS, privacyPolicy: "https://github.com/me/repo/privacy" },
      confirmLinks: true,
    });
  });

  it("Cancel setup sends DELETE; a gone run (404) says so and can be dismissed", async () => {
    const h = scriptedFetch();
    renderSettings();
    await startRun();
    fireEvent.click(await screen.findByTestId("gmail-setup-cancel"));
    await waitFor(() => expect(h.calls.some((c) => c.method === "DELETE" && c.url === VIEW_URL)).toBe(true));
    cleanup();
    scriptedFetch({ viewStatus: 404 });
    renderSettings();
    fireEvent.click(await screen.findByTestId("gmail-setup-entry"));
    fireEvent.change(screen.getByTestId("gmail-setup-owner"), { target: { value: "owner@gmail.com" } });
    fireEvent.click(screen.getByTestId("gmail-setup-start"));
    expect((await screen.findByTestId("gmail-setup-lost")).textContent).toMatch(/no longer available/);
    fireEvent.click(screen.getByTestId("gmail-setup-dismiss"));
    expect(screen.queryByTestId("gmail-setup-lost")).toBeNull();
    expect(screen.getByTestId("gmail-setup-entry")).toBeTruthy();
  });

  it("a cancelled run reads as cancelled and offers Dismiss instead of Cancel", async () => {
    scriptedFetch({ views: [view("cancelled", "api")] });
    renderSettings();
    await startRun();
    expect((await screen.findByTestId("gmail-setup-cancelled")).textContent).toMatch(/cancelled/);
    expect(screen.queryByTestId("gmail-setup-cancel")).toBeNull();
    expect(screen.getByTestId("gmail-setup-dismiss")).toBeTruthy();
  });
});

describe("test-plan #F3 — busy dedicated profile: confirmed takeover", () => {
  it("Cancel in the confirm sends nothing; confirming sends exactly one POST takeover", async () => {
    const h = scriptedFetch({ views: [view("busy", "project", { busy: { holder: "agent session 7" } })] });
    renderSettings();
    await startRun();
    const takeoverCalls = () => h.calls.filter((c) => c.url === `${VIEW_URL}/takeover`);
    fireEvent.click(await screen.findByTestId("gmail-setup-takeover"));
    expect(screen.getByTestId("confirm-dialog").textContent).toContain("agent session 7");
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    await tick(10);
    expect(takeoverCalls()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("gmail-setup-takeover"));
    fireEvent.click(screen.getByTestId("confirm-ok"));
    await waitFor(() => expect(takeoverCalls()).toHaveLength(1));
    expect(takeoverCalls()[0]?.method).toBe("POST");
  });

  it("a busy run without a holder label still reads as a sentence", async () => {
    scriptedFetch({ views: [view("busy", "project", { busy: {} })] });
    renderSettings();
    await startRun();
    expect((await screen.findByTestId("gmail-setup-busy-holder")).textContent).toContain("another session");
  });
});

describe("test-plan #F4 — hand-off opens the manual wizard at the failed step", () => {
  const capture = view("handoff", "capture", {
    handoff: { step: "capture", wizardStep: WIZARD_STEP_OF.capture, reason: "secret_capture_failed" },
    projectId: "my-gmail-agent",
    created: { projectId: "my-gmail-agent", clients: ["pi-dashboard-2"] },
    ownerEmail: "owner@gmail.com",
  });

  it("secret_capture_failed: wizard expanded at step 4, project + owner filled, reason, created client and add-secret guidance", async () => {
    // A configured client with an account keeps the group collapsed by default — only the hand-off opens it.
    scriptedFetch({
      state: configuredState({ available: false, reason: "run_active", local: true, runId: "r1" }, { accounts: [ACCOUNT] }),
      views: [capture],
    });
    renderSettings();
    const note = await screen.findByTestId("gmail-setup-handoff");
    const details = screen.getByTestId("gmail-wizard").closest("details") as HTMLDetailsElement;
    await waitFor(() => expect(details.open).toBe(true));
    const current = [...document.querySelectorAll('[aria-current="step"]')].map((e) => (e as HTMLElement).dataset.testid);
    expect(current).toEqual(["gmail-step-4"]);
    expect((screen.getByTestId("gmail-project-id") as HTMLInputElement).value).toBe("my-gmail-agent");
    expect((screen.getByTestId("gmail-owner-account") as HTMLInputElement).value).toBe("owner@gmail.com");
    expect(within(note).getByTestId("gmail-setup-handoff-reason").textContent).toBe(ERROR_EN.handoffSecretCaptureFailed);
    expect(within(note).getByTestId("gmail-setup-created").textContent).toContain("pi-dashboard-2");
    expect(within(note).getByTestId("gmail-setup-created").textContent).toContain("my-gmail-agent");
    const help = within(note).getByTestId("gmail-setup-secret-help").textContent ?? "";
    expect(help).toContain("pi-dashboard-2");
    expect(help).toMatch(/Add secret/);
    expect(primaryButtons().map((b) => b.dataset.testid)).toEqual(["gmail-add-account"]);
  });

  it("a started run that hands off reaches the same state, and Dismiss clears the highlight", async () => {
    scriptedFetch({ state: { client: { configured: false }, accounts: [], autoSetup: AVAILABLE }, views: [view("running", "client"), capture] });
    renderSettings();
    await startRun();
    await tick();
    await screen.findByTestId("gmail-setup-handoff");
    await waitFor(() => expect(document.querySelector('[aria-current="step"]')?.getAttribute("data-testid")).toBe("gmail-step-4"));
    fireEvent.click(screen.getByTestId("gmail-setup-dismiss"));
    expect(screen.queryByTestId("gmail-setup-handoff")).toBeNull();
    // The wizard falls back to "what to do next": step 1 (no client yet).
    await waitFor(() => expect(document.querySelector('[aria-current="step"]')?.getAttribute("data-testid")).toBe("gmail-step-1"));
  });

  it.each(Object.keys(HANDOFF_KEY))("hand-off reason %s renders its own sentence", async (reason) => {
    scriptedFetch({
      state: configuredState({ available: false, reason: "run_active", local: true, runId: "r1" }),
      views: [view("handoff", "project", { handoff: { step: "project", wizardStep: 1, reason: reason as never } })],
    });
    renderSettings();
    const sentence = await screen.findByTestId("gmail-setup-handoff-reason");
    expect(sentence.textContent).toBe(ERROR_EN[handoffKey(reason)]);
    expect(sentence.textContent?.length).toBeGreaterThan(20);
    cleanup();
  });
});

describe("test-plan #E11 — unverified-app notice while a sign-in waits", () => {
  it.each([
    [null, true],
    ["external", true],
    ["internal", false],
  ] as const)("audience %s → notice shown: %s (decision table)", (audience, shown) => {
    expect(showUnverifiedNotice(audience)).toBe(shown);
  });

  async function signInAfterAudience(choice: "internal" | "external" | null) {
    const h = scriptedFetch({
      state: configuredState(AVAILABLE),
      views: [view("waiting_decision", "branding", { decision: { kind: "audience", detected: "internal", org: "o.com" } })],
    });
    renderSettings();
    if (choice) {
      await startRun();
      fireEvent.click(await screen.findByTestId(`gmail-setup-audience-${choice}`));
      await waitFor(() => expect(h.calls.some((c) => c.url === `${VIEW_URL}/continue`)).toBe(true));
    }
    fireEvent.click(await screen.findByTestId("gmail-add-account"));
    await screen.findByTestId("flow-view");
  }

  it("unknown audience (no run seen) shows the sentence", async () => {
    await signInAfterAudience(null);
    const hint = screen.getByTestId("gmail-unverified-hint").textContent ?? "";
    expect(hint).toMatch(/hasn.t verified this app/);
    expect(hint).toMatch(/Advanced/);
  });

  it("External shows the sentence", async () => {
    await signInAfterAudience("external");
    expect(screen.getByTestId("gmail-unverified-hint")).toBeTruthy();
  });

  it("Internal hides it", async () => {
    await signInAfterAudience("internal");
    expect(screen.queryByTestId("gmail-unverified-hint")).toBeNull();
    expect(screen.getByTestId("gmail-consent-hint")).toBeTruthy(); // the existing hint is untouched
  });
});

describe("publishing links rule (design D7)", () => {
  it("accepts the defaults and subdomains; rejects http, other hosts, bad domains and non-URLs", () => {
    expect(validateLinks(DEFAULT_PUBLISH_LINKS)).toEqual({});
    expect(validateLinks({ homePage: "https://www.github.com/x", privacyPolicy: "https://github.com/p", authorizedDomain: "GitHub.com" })).toEqual({});
    expect(validateLinks({ ...DEFAULT_PUBLISH_LINKS, homePage: "http://github.com/x" })).toEqual({ homePage: "not_https" });
    expect(validateLinks({ ...DEFAULT_PUBLISH_LINKS, privacyPolicy: "https://notgithub.com/x" })).toEqual({ privacyPolicy: "outside_domain" });
    expect(validateLinks({ ...DEFAULT_PUBLISH_LINKS, homePage: "github.com" })).toEqual({ homePage: "invalid_url" });
    expect(validateLinks({ ...DEFAULT_PUBLISH_LINKS, authorizedDomain: "nodot" }).authorizedDomain).toBe("invalid_domain");
  });
  it("start errors map run_active / remote_dashboard to keys and nothing else", () => {
    expect([startErrorKey("run_active"), startErrorKey("remote_dashboard"), startErrorKey("x")]).toEqual(["autoErrRunActive", "autoErrRemote", null]);
  });
});

describe("test-plan #F6 — i18n parity for the automatic setup", () => {
  const HANDOFF_REASONS = [
    "unexpected_page",
    "locale",
    "domain_blocked",
    "publish_cancelled",
    "timeout",
    "secret_capture_failed",
    "client_in_use",
    "browser_closed",
    "disabled",
    "unloaded",
    "no-chrome",
    "no-display",
    "owned-by-other-server",
    "profile-in-use",
    "launch-failed",
  ];

  it("zh-CN and hu carry the identical key set", () => {
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
  });

  it("every handoff reason has a key, an ERROR_EN sentence and zh-CN + hu translations", () => {
    expect(Object.keys(HANDOFF_KEY).sort()).toEqual([...HANDOFF_REASONS].sort());
    for (const reason of HANDOFF_REASONS) {
      const key = handoffKey(reason);
      expect(key, reason).not.toBe("handoffGeneric");
      expect(ERROR_EN[key]?.trim(), `${reason} ERROR_EN`).toBeTruthy();
      expect(catalog["zh-CN"], key).toHaveProperty(key);
      expect(catalog.hu, key).toHaveProperty(key);
    }
    expect(handoffKey("brand-new-reason")).toBe("handoffGeneric");
    expect(ERROR_EN.handoffGeneric?.trim()).toBeTruthy();
  });

  it("every dynamic and literal key the new UI uses exists in both catalogs; dynamic ones have English fallbacks", () => {
    const dir = join(__dirname, "..");
    const src = ["AutoSetup.tsx", "GmailSettings.tsx"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    const literal = [...src.matchAll(/"((?:auto|handoff|unverified|addEmail|errLink)[A-Z][A-Za-z]*|unverifiedHint|addEmail)"/g)].map((m) => m[1] as string);
    const tables = [...Object.values(HANDOFF_KEY), ...Object.values(CHECKPOINT_KEY), ...Object.values(LINK_ERROR_KEY), "autoErrRunActive", "autoErrRemote", "autoErrGeneric"];
    const keys = new Set([...literal, ...tables]);
    expect(keys.size).toBeGreaterThan(60);
    for (const k of keys) {
      expect(catalog["zh-CN"], k).toHaveProperty(k);
      expect(catalog.hu, k).toHaveProperty(k);
    }
    for (const k of [...Object.values(LINK_ERROR_KEY), "autoErrRunActive", "autoErrRemote", "autoErrGeneric"]) {
      expect(ERROR_EN[k]?.trim(), k).toBeTruthy();
    }
  });
});
