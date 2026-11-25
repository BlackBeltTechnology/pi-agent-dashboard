// @vitest-environment jsdom
/**
 * L1 setup-wizard + organisation client form tests: the client-JSON decision table, the guided steps 1–4
 * (project id / owner inputs, copy buttons, console deep links, audience text, step chips), the one-line enable
 * command for every product API, the sign-in error table and console links / gcloud commands.
 * Ported from the gmail plugin. See change: add-google-connect (test-plan #A23 #A35 #A36, #B115).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../../i18n.js";
import { validateClientJson } from "../../shared/client-json.js";
import { GOOGLE_APIS } from "../../shared/setup.js";
import { SetupWizard } from "../SetupWizard.js";
import { knownFlowCode } from "../../shared/flow-codes.js";
import { consoleLinks, ERROR_EN, errorKey, errorStep, gcloudCommands } from "../wizard.js";
import { client, json, mockApi, renderSettings, STATE_URL, state } from "./harness.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = "x.apps.googleusercontent.com";

describe("client JSON validation (decision table)", () => {
  it.each([
    [{ installed: { client_id: ID, client_secret: "s" } }, { ok: true, client: { type: "installed", clientId: ID, clientSecret: "s" } }],
    [{ web: { client_id: ID, client_secret: "s" } }, { ok: true, client: { type: "web", clientId: ID, clientSecret: "s" } }],
    [{ installed: { client_id: ID } }, { ok: false, error: "missing_secret" }],
    [{ installed: { client_id: "x.example.com", client_secret: "s" } }, { ok: false, error: "bad_client_id" }],
    [{ installed: { client_id: ID, client_secret: "s" }, web: { client_id: ID, client_secret: "s" } }, { ok: false, error: "ambiguous_client" }],
    ["{not json", { ok: false, error: "not_json" }],
  ])("%j → %j", (input, expected) => {
    expect(validateClientJson(typeof input === "string" ? input : JSON.stringify(input))).toEqual(expected);
  });
});

/** Open Advanced → Add organisation sign-in on a page with no accounts. */
async function openAddForm(over: Parameters<typeof state>[0] = {}, routes: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ [`GET ${STATE_URL}`]: () => state(over), ...routes });
  renderSettings();
  await screen.findByTestId("google-connect");
  fireEvent.click(screen.getByTestId("google-advanced-toggle"));
  fireEvent.click(screen.getByTestId("google-add-client-open"));
  return api;
}
const upload = (content: string) =>
  fireEvent.change(screen.getByTestId("google-client-upload"), { target: { files: [new File([content], "client_secret_1.json", { type: "application/json" })] } });
const desktop = JSON.stringify({ installed: { client_id: ID, client_secret: "s", project_id: "acme-pi-connect" } });

describe("Add organisation sign-in form", () => {
  it("a valid Desktop client is uploaded with its name and normalised domain", async () => {
    const api = await openAddForm({}, { "PUT /api/plugins/google/clients": () => ({ ok: true, created: true }) });
    fireEvent.change(screen.getByTestId("google-org-name"), { target: { value: "BlackBelt" } });
    fireEvent.change(screen.getByTestId("google-org-domain"), { target: { value: " @BlackBelt.HU " } });
    upload(desktop);
    await screen.findByText("client_secret_1.json");
    fireEvent.click(screen.getByTestId("google-add-client-submit"));
    await waitFor(() => expect(api.calls("PUT /api/plugins/google/clients")).toHaveLength(1));
    expect(api.calls("PUT /api/plugins/google/clients")[0]).toEqual({
      json: { installed: { client_id: ID, client_secret: "s", project_id: "acme-pi-connect" } },
      label: "BlackBelt",
      domains: ["blackbelt.hu"],
    });
    await waitFor(() => expect(screen.queryByTestId("google-add-client")).toBeNull());
  });

  it("a Web client is accepted (the dashboard now supports both types)", async () => {
    const api = await openAddForm({}, { "PUT /api/plugins/google/clients": () => ({ ok: true, created: true }) });
    upload(JSON.stringify({ web: { client_id: ID, client_secret: "s" } }));
    await screen.findByText("client_secret_1.json");
    fireEvent.click(screen.getByTestId("google-add-client-submit"));
    await waitFor(() => expect(api.calls("PUT /api/plugins/google/clients")).toHaveLength(1));
  });

  it("invalid JSON is rejected locally with a message and nothing is sent", async () => {
    const api = await openAddForm();
    upload("{nope");
    expect((await screen.findByTestId("google-upload-error")).textContent).toMatch(/not valid JSON/);
    fireEvent.click(screen.getByTestId("google-add-client-submit"));
    expect(api.fn.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toHaveLength(0);
  });

  it("#B115 a full store names the fix for an own-client add", async () => {
    await openAddForm({}, { "PUT /api/plugins/google/clients": () => json({ error: "too_many_keys" }, 409) });
    upload(desktop);
    await screen.findByText("client_secret_1.json");
    fireEvent.click(screen.getByTestId("google-add-client-submit"));
    expect((await screen.findByTestId("google-add-client-error")).textContent).toMatch(/remove unused accounts or clients/);
  });

  it("a domain another organisation already uses is reported on the domain field", async () => {
    await openAddForm({}, { "PUT /api/plugins/google/clients": () => json({ error: "domain_taken" }, 409) });
    fireEvent.change(screen.getByTestId("google-org-domain"), { target: { value: "blackbelt.hu" } });
    upload(desktop);
    await screen.findByText("client_secret_1.json");
    fireEvent.click(screen.getByTestId("google-add-client-submit"));
    expect((await screen.findByTestId("google-org-domain-error")).textContent).toMatch(/already uses this domain/);
  });
});

describe("#A23 redirect URI of a Web client", () => {
  it("shows the exact callback URL for the public base to register; a Desktop client shows none", async () => {
    mockApi({
      [`GET ${STATE_URL}`]: () =>
        state({
          webRedirectUri: "https://dash.example.com/api/plugins/google/oauth/callback",
          clients: [client({ id: "w", label: "Web one", type: "web" }), client({ id: "d", label: "Desktop one", type: "installed" })],
        }),
    });
    renderSettings();
    await screen.findByTestId("google-connect");
    fireEvent.click(screen.getByTestId("google-advanced-toggle"));
    const [web, desk] = screen.getAllByTestId("google-client-row") as [HTMLElement, HTMLElement];
    expect(within(web).getByTestId("google-client-redirect").textContent).toBe("https://dash.example.com/api/plugins/google/oauth/callback");
    expect(within(desk).queryByTestId("google-client-redirect")).toBeNull();
    expect(within(desk).queryByTestId("google-client-redirect-block")).toBeNull();
  });
});

describe("guided setup wizard (#A35 / #A36)", () => {
  it("#A35 the enable command enables exactly the product APIs for the project", () => {
    render(<SetupWizard highlight={null} initial={{ projectId: "acme-pi" }} />);
    const cmd = screen.getByText(/gcloud services enable/).textContent ?? "";
    const services = cmd.replace("gcloud services enable ", "").replace(/ --project acme-pi.*/, "").split(" ");
    expect(services).toEqual(["gmail", "calendar-json", "drive", "docs", "sheets", "slides", "tasks", "people"].map((s) => `${s}.googleapis.com`));
    expect(services).toEqual([...GOOGLE_APIS]);
    expect(cmd).toContain("--project acme-pi");
  });

  it("#A36 project-id and owner inputs, copy buttons, console links, audience text and numbered step chips are present", () => {
    render(<SetupWizard highlight={null} initial={{ projectId: "acme-pi-connect", owner: "owner@example.com" }} />);
    expect(screen.getByTestId("google-project-id")).toBeTruthy();
    expect(screen.getByTestId("google-owner-account")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^(Copy|Copied|Copy failed)$/ }).length).toBeGreaterThanOrEqual(3);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("https://console.cloud.google.com/flows/enableapi") && h.includes("project=acme-pi-connect"))).toBe(true);
    expect(hrefs.some((h) => h.includes("/auth/branding"))).toBe(true);
    expect(hrefs.some((h) => h.includes("/auth/audience"))).toBe(true);
    expect(hrefs.some((h) => h.includes("/auth/clients/create"))).toBe(true);
    for (const n of [1, 2, 3, 4]) expect(screen.getByTestId(`google-step-${n}`)).toBeTruthy();
    expect(screen.getByTestId("google-step-1").querySelector("span")?.textContent).toBe("1");
    const audience = screen.getByTestId("google-step-3").textContent ?? "";
    expect(audience).toMatch(/Internal/);
    expect(audience).toMatch(/External/);
    expect(audience).toMatch(/test user/);
    expect(audience).toMatch(/Workspace organization/);
  });

  it("an id that is the project NAME shows guidance and no project links", () => {
    render(<SetupWizard highlight={null} />);
    fireEvent.change(screen.getByTestId("google-project-id"), { target: { value: "Pi Dashboard" } });
    fireEvent.blur(screen.getByTestId("google-project-id"));
    expect(screen.getByTestId("google-project-error").textContent).toMatch(/looks like the project name/);
    expect(screen.getAllByTestId(/google-need-project-id/).length).toBeGreaterThan(0);
  });
});

describe("E2 — sign-in error → wizard step", () => {
  it.each([
    ["access_denied", 3],
    ["org_internal", 3],
    ["redirect_uri_mismatch", 4],
    ["invalid_client", 5],
  ])("%s → step %i", (code, step) => {
    expect(errorStep(code)).toBe(step);
  });
  it("unknown codes map to no step", () => {
    expect(errorStep("state_mismatch")).toBeNull();
  });
  // test-plan #E3 (improve-gmail-settings-ux): the fix is in the account's Admin console, not a wizard step.
  it("admin_policy_enforced maps to no step", () => {
    expect(errorStep("admin_policy_enforced")).toBeNull();
  });
});

/** Every code design D2 lists (a flow can terminate with each). See change: improve-gmail-settings-ux. */
const D2_CODES = [
  "org_internal",
  "access_denied",
  "admin_policy_enforced",
  "redirect_uri_mismatch",
  "invalid_client",
  "scope_missing",
  "account_mismatch",
  "client_mismatch",
  "too_many_keys",
  "missing_refresh",
  "email_unverified",
  "invalid_redirect",
  "state_mismatch",
  "callback_failed",
  "token_exchange_failed",
  "id_token_invalid",
  "authorization_failed",
  "timeout",
  "start_timeout",
  "login_failed",
  "aborted",
];

describe("test-plan #E1 — every sign-in error code has a human sentence", () => {
  it.each(D2_CODES)("%s → own key + English sentence", (code) => {
    const key = errorKey(code);
    expect(key).not.toBe("errGeneric");
    expect(ERROR_EN[key]?.trim()).toBeTruthy();
    expect(knownFlowCode(code)).toBe(code);
  });
  it.each(["Cancelled", "CANCELLED", "cancelled"])("%s → the cancelled key", (code) => {
    expect(errorKey(code)).toBe("errCancelled");
  });
  it("every key errorKey can return has a zh-CN and hu translation", () => {
    const keys = new Set([...D2_CODES, "Cancelled", "unknown"].map(errorKey));
    for (const k of keys) {
      expect(catalog["zh-CN"]).toHaveProperty(k);
      expect(catalog.hu).toHaveProperty(k);
    }
  });
});

describe("test-plan #E2 — unknown inputs get the generic sentence", () => {
  it.each(["fetch failed", "", "Org_Internal ", "a".repeat(65), "__proto__", "toString"])("%j → errGeneric", (code) => {
    expect(errorKey(code)).toBe("errGeneric");
  });
  it("null/undefined → errGeneric", () => {
    expect(errorKey(null)).toBe("errGeneric");
    expect(errorKey(undefined)).toBe("errGeneric");
    expect(ERROR_EN.errGeneric?.trim()).toBeTruthy();
  });
});

const VALID_ID = "pidashboard-510015";
const VALID_OWNER = "csakany.robert@gmail.com";
const IDS: Array<[string, string]> = [["valid", VALID_ID], ["name", "PiDashboard"], ["empty", ""]];
const OWNERS: Array<[string, string]> = [["valid", VALID_OWNER], ["invalid", "robson@"], ["empty", ""]];

describe("test-plan #E3 (improve-gmail-plugin-setup-ux) — console links", () => {
  describe.each(IDS)("project id %s", (idKind, id) => {
    it.each(OWNERS)(`× owner %s`, (ownerKind, owner) => {
      const l = consoleLinks(id, owner);
      // project-scoped links exist only for a valid id; create/list always exist and are never project-scoped
      const scoped = [l.enableApis, l.branding, l.audience, l.clientCreate];
      for (const u of scoped) {
        if (idKind === "valid") expect(u).toContain(`project=${VALID_ID}`);
        else expect(u).toBeNull();
      }
      expect(l.projectCreate).toContain("https://console.cloud.google.com/projectcreate");
      expect(l.projectList).toContain("https://console.cloud.google.com/cloud-resource-manager");
      for (const u of [l.projectCreate, l.projectList]) expect(u).not.toContain("project=");
      // authuser (URL-encoded) on every non-null link, only for a valid owner
      for (const u of [l.projectCreate, l.projectList, ...scoped]) {
        if (u === null) continue;
        if (ownerKind === "valid") expect(u).toContain("authuser=csakany.robert%40gmail.com");
        else expect(u).not.toContain("authuser");
      }
      // a display name never becomes a project parameter
      for (const u of [l.projectCreate, l.projectList, ...scoped]) expect(u ?? "").not.toContain("project=PiDashboard");
    });
  });

  it("builds the exact deep links for a valid id and owner", () => {
    const l = consoleLinks(` ${VALID_ID} `, ` ${VALID_OWNER.toUpperCase()} `);
    expect(l.branding).toBe(`https://console.cloud.google.com/auth/branding?project=${VALID_ID}&authuser=csakany.robert%40gmail.com`);
  });
});

describe("test-plan #E4 (improve-gmail-plugin-setup-ux) — gcloud commands", () => {
  describe.each(IDS)("project id %s", (idKind, id) => {
    it.each(OWNERS)(`× owner %s`, (ownerKind, owner) => {
      const c = gcloudCommands(id, owner);
      const acct = ownerKind === "valid" ? ` --account ${VALID_OWNER}` : "";
      expect(c.projectsList).toBe(`gcloud projects list${acct}`);
      if (idKind === "valid") {
        expect(c.create).toBe(`gcloud projects create ${VALID_ID}${acct}`);
        expect(c.enable).toBe(`gcloud services enable ${GOOGLE_APIS.join(" ")} --project ${VALID_ID}${acct}`);
      } else {
        expect(c.create).toBeNull();
        expect(c.enable).toBeNull();
      }
      expect(c.authLogin).toBe(ownerKind === "valid" ? `gcloud auth login ${VALID_OWNER}` : null);
      expect(JSON.stringify(c)).not.toContain("<project-id>");
    });
  });
});

describe("owner account is shell-quoted in the copyable commands", () => {
  it("leaves an ordinary address bare", () => {
    expect(gcloudCommands(VALID_ID, "a.b+c_d-e@x-y.co").projectsList).toBe("gcloud projects list --account a.b+c_d-e@x-y.co");
  });

  it.each([
    ["a;touch@b.co", "'a;touch@b.co'"],
    ["$(id)@b.co", "'$(id)@b.co'"],
    ["a`id`@b.co", "'a`id`@b.co'"],
    ["a'b@c.co", "'a'\\''b@c.co'"],
    ["a|b&c@d.co", "'a|b&c@d.co'"],
  ])("%j is wrapped in single quotes", (owner, quoted) => {
    // These pass isEmail (no whitespace, one @, dotted domain), so they reach the command text.
    const c = gcloudCommands(VALID_ID, owner);
    expect(c.authLogin).toBe(`gcloud auth login ${quoted.toLowerCase()}`);
    expect(c.projectsList).toBe(`gcloud projects list --account ${quoted.toLowerCase()}`);
  });
});
