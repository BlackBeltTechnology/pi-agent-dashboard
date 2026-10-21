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

const state = (client: Record<string, unknown>, accounts: unknown[], setup?: Record<string, unknown>) => (page: Page) =>
  stubApi(page, STATE, (route) => json(route, { client, accounts, ...(setup ? { setup } : {}) }), "GET");

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
];
