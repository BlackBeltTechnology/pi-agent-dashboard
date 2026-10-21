import type { Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { hold, stubApi } from "./stubs.js";

/**
 * Settings ▸ Plugins ▸ Gmail states, reached by stubbing the plugin's own
 * `GET /api/plugins/gmail/state`, its account/alias routes and the provider-auth
 * flow endpoint. See change: retro-ux-plugin-settings-forms.
 */

const STATE = "/api/plugins/gmail/state";
const ACCOUNTS = "/api/plugins/gmail/accounts";
const FLOW = "/api/provider-auth/flow/f1";
const PATH = "/settings/plugins/gmail";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const CLIENT = { configured: true, clientId: "603-abc.apps.googleusercontent.com", projectId: "blackbelt-gmail-agent" };
const ACCTS = [
  { sub: "s1", email: "anna@blackbelt.hu", alias: "work", tier: "send", status: "ok", addedAt: 1 },
  { sub: "s2", email: "bence@gmail.com", tier: "readonly", status: "reauth_required", addedAt: 2 },
  { sub: "s3", email: "dora@gmail.com", tier: "draft", status: "ok", testingHint: true, addedAt: 3 },
];

const state =
  (client: Record<string, unknown>, accounts: unknown[], setup?: Record<string, unknown>, autoSetup?: Record<string, unknown>) =>
  (page: Page) =>
    stubApi(
      page,
      STATE,
      (route) => json(route, { client, accounts, ...(setup ? { setup } : {}), ...(autoSetup ? { autoSetup } : {}) }),
      "GET",
    );

const root = (page: Page) => page.getByTestId("gmail-settings");
const goto = async (page: Page) => {
  await page.goto(PATH);
  await root(page).waitFor({ state: "visible", timeout: 30_000 });
};

const waitingFlow = { flowId: "f1", provider: "gmail", status: "pending", authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x" };

/** Click "Add account" with the flow endpoints stubbed. */
const startFlow = (reply: Record<string, unknown>) => async (page: Page) => {
  await state(CLIENT, [ACCTS[0]])(page);
  await stubApi(page, ACCOUNTS, (route) => json(route, { flowId: "f1" }), "POST");
  await stubApi(page, FLOW, (route) => json(route, reply), "GET");
};

// ── add-gmail-auto-setup: "Set up automatically" entry, form, run progress, decisions, hand-off ──

const RUN = "/api/plugins/gmail/setup/run";
const RUN_VIEW = `${RUN}/r1`;
const AUTO = { available: true, local: true };
const STEP_IDS = ["project", "api", "branding", "publish", "client", "capture"] as const;

/** A secret-free run view with the steps before `step` done and `step` running (or handed off). */
const runView = (state: string, step: (typeof STEP_IDS)[number], extra: Record<string, unknown> = {}) => ({
  runId: "r1",
  state,
  step,
  steps: STEP_IDS.map((id, i) => ({
    id,
    status: i < STEP_IDS.indexOf(step) ? "done" : i === STEP_IDS.indexOf(step) ? (state === "handoff" ? "handoff" : "running") : "pending",
  })),
  created: { clients: [] },
  ownerEmail: "anna@gmail.com",
  ...extra,
});

/** Stub the run endpoints so a started run answers `view` forever. */
const withRun = (view: Record<string, unknown>) => async (page: Page) => {
  await state({ configured: false }, [], undefined, AUTO)(page);
  await stubApi(page, RUN, (route) => json(route, { runId: "r1" }), "POST");
  await stubApi(page, RUN_VIEW, (route) => json(route, view), "GET");
};

/** Open settings, start a run through the form and wait for `testId` of the run panel. */
const startRunAndWait = (testId: string) => async (page: Page) => {
  await goto(page);
  await page.getByTestId("gmail-setup-entry").click();
  await page.getByTestId("gmail-setup-owner").fill("anna@gmail.com");
  await page.getByTestId("gmail-setup-start").click();
  await page.getByTestId(testId).waitFor({ state: "visible", timeout: 10_000 });
};

const RUN_STUBS = [STATE, RUN, RUN_VIEW];

const autoSetupStates: UiState[] = [
  {
    id: "auto-entry",
    label: "automatic setup offered (secondary entry beside the manual wizard)",
    stubs: [STATE],
    install: state({ configured: false }, [], undefined, AUTO),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-setup-entry").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "auto-replace",
    label: "automatic setup offered; a client without accounts would be replaced",
    stubs: [STATE],
    install: state(CLIENT, [], undefined, { ...AUTO, replacesClient: true }),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-setup-replace").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "auto-remote",
    label: "remote dashboard: automatic setup explained, not offered",
    stubs: [STATE],
    install: state({ configured: false }, [], undefined, { available: false, reason: "remote_dashboard", local: false }),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-setup-remote").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "auto-form",
    label: "start form (new/existing project, project id, owner email)",
    stubs: [STATE],
    install: state({ configured: false }, [], { projectId: "pidashboard-510015", ownerAccount: "anna@gmail.com" }, AUTO),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-setup-entry").click();
      await page.getByTestId("gmail-setup-form").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "auto-start-error",
    label: "start refused (a run is already active)",
    stubs: [STATE, RUN],
    install: async (page) => {
      await state({ configured: false }, [], undefined, AUTO)(page);
      await stubApi(page, RUN, (route) => json(route, { error: "run_active" }, 409), "POST");
    },
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-setup-entry").click();
      await page.getByTestId("gmail-setup-owner").fill("anna@gmail.com");
      await page.getByTestId("gmail-setup-start").click();
      await page.getByTestId("gmail-setup-start-error").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "auto-running",
    label: "run in progress (step chips)",
    stubs: RUN_STUBS,
    install: withRun(runView("running", "api")),
    open: startRunAndWait("gmail-setup-working"),
    root,
  },
  {
    id: "auto-sign-in",
    label: "waiting for the user to sign in to the dedicated browser",
    stubs: RUN_STUBS,
    install: withRun(runView("waiting_user", "project", { checkpoint: { kind: "sign_in" } })),
    open: startRunAndWait("gmail-setup-checkpoint"),
    root,
  },
  {
    id: "auto-policy",
    label: "waiting for the user to tick the User Data Policy box",
    stubs: RUN_STUBS,
    install: withRun(runView("waiting_user", "branding", { checkpoint: { kind: "policy" } })),
    open: startRunAndWait("gmail-setup-checkpoint"),
    root,
  },
  {
    id: "auto-audience",
    label: "audience decision (Internal offered for a Workspace organization)",
    stubs: RUN_STUBS,
    install: withRun(runView("waiting_decision", "branding", { decision: { kind: "audience", detected: "internal", org: "blackbelt.hu" } })),
    open: startRunAndWait("gmail-setup-audience"),
    root,
  },
  {
    id: "auto-links",
    label: "publishing links decision with explicit confirmation",
    stubs: RUN_STUBS,
    install: withRun(
      runView("waiting_decision", "publish", {
        decision: {
          kind: "links",
          links: {
            homePage: "https://github.com/BlackBeltTechnology/pi-agent-dashboard",
            privacyPolicy: "https://github.com/BlackBeltTechnology/pi-agent-dashboard",
            authorizedDomain: "github.com",
          },
        },
      }),
    ),
    open: async (page) => {
      await startRunAndWait("gmail-setup-links")(page);
      await page.getByTestId("gmail-setup-links-confirm").check();
    },
    root,
  },
  {
    id: "auto-busy",
    label: "dedicated browser held by an agent session (Take over)",
    stubs: RUN_STUBS,
    install: withRun(runView("busy", "project", { busy: { holder: "agent session 7" } })),
    open: startRunAndWait("gmail-setup-busy"),
    root,
  },
  {
    id: "auto-done",
    label: "run finished; Add account prefilled with the owner email",
    stubs: RUN_STUBS,
    install: withRun(runView("done", "capture", { clientId: "603-abc.apps.googleusercontent.com", steps: STEP_IDS.map((id) => ({ id, status: "done" })) })),
    open: startRunAndWait("gmail-setup-done"),
    root,
  },
  {
    id: "auto-handoff",
    label: "hand-off at the capture step: wizard step 4, created client named",
    stubs: RUN_STUBS,
    install: withRun(
      runView("handoff", "capture", {
        handoff: { step: "capture", wizardStep: 4, reason: "secret_capture_failed" },
        projectId: "pidashboard-510015",
        created: { projectId: "pidashboard-510015", clients: ["pi-dashboard-2"] },
      }),
    ),
    open: startRunAndWait("gmail-setup-handoff"),
    root,
  },
];

export const gmailStates: UiState[] = [
  {
    id: "loading",
    label: "state request pending",
    stubs: [STATE],
    install: (page) => stubApi(page, STATE, hold, "GET"),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("gmail-loading").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: (page) => page.getByTestId("gmail-loading"),
  },
  {
    id: "load-error",
    label: "state request fails",
    stubs: [STATE],
    install: (page) => stubApi(page, STATE, (route) => json(route, { error: "gmail unavailable" }, 500), "GET"),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("gmail-load-error").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: (page) => page.getByTestId("gmail-load-error"),
  },
  { id: "not-configured", label: "no OAuth client (wizard step 1)", stubs: [STATE], install: state({ configured: false }, []), open: goto, root },
  {
    id: "configured",
    label: "ok, re-auth needed and testing-mode accounts",
    stubs: [STATE],
    install: state(CLIENT, ACCTS),
    open: goto,
    root,
  },
  {
    id: "upload-error",
    label: "a Web client uploaded instead of Desktop",
    stubs: [STATE],
    install: state({ configured: false }, []),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-client-upload").setInputFiles({
        name: "client_secret_web.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ web: { client_id: "x.apps.googleusercontent.com", client_secret: "s" } })),
      });
      await page.getByTestId("gmail-upload-error").waitFor({ state: "visible" });
    },
    root,
  },
  {
    // improve-gmail-plugin-setup-ux (test-plan F1): the display name typed instead of the id.
    id: "invalid-project-id",
    label: "project display name typed into the project id field",
    stubs: [STATE],
    install: state({ configured: false }, []),
    open: async (page) => {
      await goto(page);
      const input = page.getByTestId("gmail-project-id");
      await input.fill("PiDashboard");
      await input.blur();
      await page.getByTestId("gmail-project-error").waitFor({ state: "visible" });
    },
    root,
  },
  {
    // improve-gmail-plugin-setup-ux (test-plan F1): uploaded client belongs to another project.
    id: "project-mismatch",
    label: "uploaded client's project differs from the saved project id",
    stubs: [STATE, "/api/plugins/gmail/client"],
    install: async (page) => {
      await state({ configured: false }, [], { projectId: "pidashboard-510015" })(page);
      await stubApi(page, "/api/plugins/gmail/client", (route) => json(route, { ok: true, projectId: "other-project-123" }), "PUT");
    },
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-client-upload").setInputFiles({
        name: "client_secret_other.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({ installed: { client_id: "x.apps.googleusercontent.com", client_secret: "s", project_id: "other-project-123" } }),
        ),
      });
      await page.getByTestId("gmail-project-mismatch").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "flow-waiting",
    label: "sign-in waiting on Google",
    stubs: [STATE, ACCOUNTS, FLOW],
    install: startFlow(waitingFlow),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-add-account").click();
      await page.getByTestId("gmail-consent-hint").waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "flow-error",
    label: "sign-in denied (access_denied)",
    stubs: [STATE, ACCOUNTS, FLOW],
    install: startFlow({ flowId: "f1", provider: "gmail", status: "error", error: "access_denied" }),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("gmail-add-account").click();
      await page.getByTestId("gmail-flow-error").waitFor({ state: "visible", timeout: 10_000 });
    },
    root,
  },
  {
    id: "alias-error",
    label: "alias already used",
    stubs: [STATE, "/api/plugins/gmail/accounts/s1"],
    install: async (page) => {
      await state(CLIENT, ACCTS)(page);
      await stubApi(page, "/api/plugins/gmail/accounts/s1", (route) => json(route, { error: "alias_taken" }, 409), "PATCH");
    },
    open: async (page) => {
      await goto(page);
      const alias = page.getByTestId("gmail-account-alias").first();
      await alias.fill("bence");
      await alias.blur();
      await page.getByTestId("gmail-alias-feedback").waitFor({ state: "visible" });
    },
    root,
  },
  ...autoSetupStates,
];
