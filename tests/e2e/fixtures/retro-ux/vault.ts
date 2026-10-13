import type { Locator, Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { fail, hold, ok, stubApi } from "./stubs.js";

/**
 * Credential-vault states (the board's 27 states over 5 surfaces), reached by
 * stubbing the vault REST routes with `page.route`: `/api/vault`,
 * `/api/vault/projects`, `/api/vault/import/*`, the account / binding writes and
 * `/api/session/:id/vault-bindings`. Data are the board's real nouns
 * (`openspec/changes/retro-ux-credential-vault/mockups/vault.html`). The stubbed
 * overview never carries a stored value, as the real server never sends one.
 *
 * The session-chip states need a live session (the chip lives in its header): the
 * spec fills `vault.sessionId` after spawning one, as chat-rendering does with `chat`.
 *
 * `page-load-error` is not a state here: its callout is owned by
 * `surface-operate-required-remedy` (audit "post-review decisions").
 *
 * See change: retro-ux-credential-vault (test-plan E28).
 */

/** Filled by the spec once the session whose header hosts the chip exists. */
export const vault = { sessionId: "" };

const PATH = "/settings/vault";
const OVERVIEW = "/api/vault";
const CANDIDATES = "/api/vault/import/candidates";
const PROJECTS = "/api/vault/projects";
const PROPOSE = "/api/vault/import/propose";
const CONFIRM_IMPORT = "/api/vault/import/confirm";
const ACCOUNTS_WRITE = "/api/vault/accounts";
const BINDINGS_WRITE = "/api/vault/bindings";

const REPO_DASH = "github.com/blackbelt-technology/pi-agent-dashboard";
const REPO_DECK = "github.com/robson/deck3d";
const DIR_DASH = "/Users/robson/Project/pi-agent-dashboard";
const DIR_DECK = "/Users/robson/Project/deck3d";
const DIR_VIDEO = "/Users/robson/Movies/video-feliratozas";

interface Account {
  id: string;
  provider: string;
  kind: string;
  namespace: string;
  label: string;
}
interface Binding {
  name: string;
  target: string;
  defaultAccountId?: string;
}
interface Grant {
  subject: string;
  bindingName: string;
  accountId?: string;
  state: "ok" | "no-account";
}

const key = (id: string, provider: string, label: string): Account => ({ id, provider, kind: "key", namespace: "default", label });
const ACCOUNTS: Account[] = [key("acc_g1", "gemini", "personal"), key("acc_g2", "gemini", "work"), key("acc_s1", "soniox", "personal"), key("acc_o1", "openai", "work")];
const env = (name: string, defaultAccountId?: string): Binding => ({ name, target: "env", defaultAccountId });
const GEMINI = env("GEMINI_API_KEY", "acc_g1");
const SONIOX = env("SONIOX_API_KEY", "acc_s1");
const OPENAI = env("OPENAI_API_KEY");
const GRANTS: Grant[] = [
  { subject: `repo:${REPO_DASH}`, bindingName: "GEMINI_API_KEY", state: "ok" },
  { subject: `repo:${REPO_DECK}`, bindingName: "GEMINI_API_KEY", accountId: "acc_g2", state: "ok" },
  { subject: `dir:hub:${DIR_VIDEO}`, bindingName: "SONIOX_API_KEY", state: "ok" },
  { subject: `dir:hub:${DIR_VIDEO}`, bindingName: "GEMINI_API_KEY", accountId: "acc_g2", state: "ok" },
];
const CONFIRMS = [
  { deviceId: "hub", dir: DIR_DASH, repoKey: REPO_DASH },
  { deviceId: "hub", dir: `${DIR_DASH}/.worktrees/os-add-credential-vault`, repoKey: REPO_DASH },
];
const PLUGIN = { pluginId: "demo", displayName: "Demo Plugin (fixture)", declared: ["POLY_PIZZA_KEY"] };
const KEY_FILES = [
  { id: "skill-env:nano-banana-imagegen", label: "skill nano-banana-imagegen (.env)", exists: true },
  { id: "skill-env:video-transcription", label: "skill video-transcription (.env)", exists: true },
  { id: "system-one-auth", label: "system-one auth.json", exists: true },
];
const LIVE = [
  { kind: "repo", dir: DIR_DASH, repoKey: REPO_DASH, deviceId: "hub", sessions: 2 },
  { kind: "repo", dir: DIR_DECK, repoKey: REPO_DECK, deviceId: "hub", sessions: 1 },
  { kind: "dir", dir: DIR_VIDEO, deviceId: "hub", sessions: 1 },
  { kind: "dir", dir: "/home/robson/edge-lab", deviceId: "mac-mini-iroda", sessions: 1, blocked: "transport-insecure" },
];
const RECENT = [
  { kind: "repo", dir: "/Users/robson/Project/compsychletter", repoKey: "github.com/robson/compsychletter", deviceId: "hub", lastSeenAt: Date.now() - 3 * 86_400_000 },
  { kind: "dir", dir: "/Users/robson/scratch", deviceId: "hub", lastSeenAt: Date.now() - 9 * 86_400_000 },
];

interface Seed {
  status?: { state: "absent" | "ok" | "corrupt"; backup?: string };
  accounts?: Account[];
  bindings?: Binding[];
  grants?: Grant[];
  confirmations?: typeof CONFIRMS;
  pluginApprovals?: Array<{ pluginId: string; bindingName: string }>;
  plugins?: Array<typeof PLUGIN>;
  candidates?: typeof KEY_FILES;
  projects?: { open: unknown[]; recent: unknown[] };
}

/** The common answers; a state layers its own writes on top. */
const stubs =
  (seed: Seed = {}, extra: (page: Page) => Promise<void> = async () => {}) =>
  async (page: Page): Promise<void> => {
    const overview = {
      status: seed.status ?? { state: "ok" },
      accounts: seed.accounts ?? ACCOUNTS,
      bindings: seed.bindings ?? [GEMINI, SONIOX, OPENAI],
      grants: seed.grants ?? GRANTS,
      confirmations: seed.confirmations ?? CONFIRMS,
      pluginApprovals: seed.pluginApprovals ?? [],
      plugins: seed.plugins ?? [],
    };
    await stubApi(page, OVERVIEW, (route) => ok(route, overview), "GET");
    await stubApi(page, CANDIDATES, (route) => ok(route, seed.candidates ?? KEY_FILES), "GET");
    await stubApi(page, PROJECTS, (route) => ok(route, seed.projects ?? { open: LIVE, recent: RECENT }), "GET");
    await extra(page);
  };

const section = (page: Page): Locator => page.getByTestId("vault-section");
const base = { root: section };

type Tab = "variables" | "accounts" | "import";
async function gotoVault(page: Page, tab: Tab = "variables"): Promise<void> {
  await page.goto(PATH);
  await section(page).waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("vault-tab-variables").waitFor({ state: "visible", timeout: 30_000 });
  if (tab !== "variables") await page.getByTestId(`vault-tab-${tab}`).click();
}

const card = (page: Page, name: string): Locator => page.getByTestId(`vault-binding-${name}`);
const account = (page: Page, id: string): Locator => page.getByTestId(`vault-account-${id}`);

/** The stub ids a state answers (at least one, as `captureStates` requires). */
const READ = [OVERVIEW, CANDIDATES, PROJECTS];

export const shellStates: UiState[] = [
  {
    id: "stale-server",
    label: "server older than the page answers /api/vault with HTML (200)",
    stubs: [OVERVIEW],
    ...base,
    install: stubs({}, (page) =>
      stubApi(page, OVERVIEW, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body>app</body></html>" }), "GET"),
    ),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("vault-error").waitFor({ state: "visible", timeout: 30_000 });
    },
  },
  {
    id: "loading",
    label: "overview request in flight (skeleton)",
    stubs: [OVERVIEW],
    ...base,
    install: stubs({}, (page) => stubApi(page, OVERVIEW, () => hold(), "GET")),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("vault-loading").waitFor({ state: "visible", timeout: 30_000 });
    },
  },
  {
    id: "first-run",
    label: "empty vault, guided first start",
    stubs: READ,
    ...base,
    install: stubs({ accounts: [], bindings: [], grants: [], confirmations: [] }),
    open: async (page) => {
      await gotoVault(page);
      await page.getByTestId("vault-empty").waitFor({ state: "visible" });
    },
  },
  {
    id: "corrupt",
    label: "damaged vault file: writes refused",
    stubs: READ,
    ...base,
    install: stubs({ status: { state: "corrupt", backup: "/Users/robson/.pi/dashboard/vault.json.corrupt-1760339462" } }),
    open: async (page) => {
      await gotoVault(page);
      await page.getByTestId("vault-corrupt").waitFor({ state: "visible" });
    },
  },
];

const pickerFor = (projects: { open: unknown[]; recent: unknown[] }): Pick<UiState, "install" | "open"> => ({
  install: stubs({ projects }),
  open: async (page) => {
    await gotoVault(page);
    await card(page, "SONIOX_API_KEY").getByTestId("vault-grant-open").click();
    await page.getByTestId("vault-picker-open").waitFor({ state: "visible" });
  },
});

export const variablesStates: UiState[] = [
  {
    id: "populated",
    label: "cards with projects, status pills and confirmed checkouts",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await gotoVault(page);
      await card(page, "GEMINI_API_KEY").waitFor({ state: "visible" });
      await card(page, "GEMINI_API_KEY").locator("details summary").first().click(); // open the checkouts
      await card(page, "GEMINI_API_KEY").getByTestId("vault-confirmation-row").first().waitFor({ state: "visible" });
    },
  },
  {
    id: "repair",
    label: "revoked override account and a variable with no default",
    stubs: READ,
    ...base,
    install: stubs({
      bindings: [GEMINI, OPENAI],
      grants: [
        { subject: `repo:${REPO_DECK}`, bindingName: "GEMINI_API_KEY", accountId: "acc_gone", state: "no-account" },
        { subject: `repo:${REPO_DASH}`, bindingName: "GEMINI_API_KEY", state: "ok" },
      ],
    }),
    open: async (page) => {
      await gotoVault(page);
      await page.getByTestId("vault-binding-repair").first().waitFor({ state: "visible" });
      await page.getByTestId("vault-grant-no-account").first().waitFor({ state: "visible" });
    },
  },
  {
    id: "grant-picker-live",
    label: "project picker: open sessions only (rejected option A, no remembered projects)",
    stubs: READ,
    ...base,
    ...pickerFor({ open: LIVE, recent: [] }),
  },
  {
    id: "grant-picker-recent",
    label: "project picker: open sessions plus remembered projects (approved option B)",
    stubs: READ,
    ...base,
    ...pickerFor({ open: LIVE, recent: RECENT }),
    open: async (page) => {
      await gotoVault(page);
      await card(page, "SONIOX_API_KEY").getByTestId("vault-grant-open").click();
      await page.getByTestId("vault-picker-recent").waitFor({ state: "visible" });
    },
  },
  {
    id: "grant-manual",
    label: "project picker: manual folder entry for a never-opened project",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await gotoVault(page);
      await card(page, "SONIOX_API_KEY").getByTestId("vault-grant-open").click();
      await page.getByRole("button", { name: /Not listed\?/ }).click();
      await page.getByRole("button", { name: "Folder", exact: true }).click();
      await page.getByLabel("Folder path").waitFor({ state: "visible" });
    },
  },
  {
    id: "plugin-request",
    label: "plugin declares POLY_PIZZA_KEY and no such variable exists",
    stubs: READ,
    ...base,
    install: stubs({ bindings: [], grants: [], confirmations: [], plugins: [PLUGIN] }),
    open: async (page) => {
      await gotoVault(page);
      await page.getByTestId("vault-plugin-request").waitFor({ state: "visible" });
    },
  },
  {
    id: "plugin-approve",
    label: "plugin approval switch on the variable it reads",
    stubs: READ,
    ...base,
    install: stubs({
      bindings: [env("POLY_PIZZA_KEY", "acc_o1")],
      grants: [],
      confirmations: [],
      plugins: [PLUGIN],
      pluginApprovals: [{ pluginId: "demo", bindingName: "POLY_PIZZA_KEY" }],
    }),
    open: async (page) => {
      await gotoVault(page);
      await page.getByTestId("vault-plugin-demo-POLY_PIZZA_KEY").waitFor({ state: "visible" });
    },
  },
  {
    id: "bad-name",
    label: "reserved variable name: inline field error",
    stubs: READ,
    ...base,
    install: stubs({ bindings: [GEMINI] }),
    open: async (page) => {
      await gotoVault(page);
      await page.getByTestId("vault-variable-new").click();
      await page.getByLabel("Variable name").fill("PATH");
      await page.getByTestId("vault-variable-create").click();
      await page.getByText(/is reserved by the system/).waitFor({ state: "visible" });
    },
  },
  {
    id: "delete-confirm",
    label: "delete variable: two-step confirm with its impact",
    stubs: READ,
    ...base,
    install: stubs({ bindings: [GEMINI] }),
    open: async (page) => {
      await gotoVault(page);
      await card(page, "GEMINI_API_KEY").getByTestId("vault-variable-delete").click();
      await page.locator('[data-testid="vault-confirm-impact"][aria-busy="false"]').waitFor({ state: "visible" });
    },
  },
];

const savedAccount = (provider: string, label: string) => (page: Page) =>
  stubApi(page, ACCOUNTS_WRITE, (route) => ok(route, key("acc_new", provider, label)), "POST");

/** Open the add-key form on the Accounts tab and fill provider, label and a key of `value`. */
async function fillAddKey(page: Page, provider: string, label: string, value: string): Promise<void> {
  await gotoVault(page, "accounts");
  await page.getByTestId("vault-account-new").click();
  const form = page.getByTestId("vault-account-form");
  await form.getByLabel("Provider", { exact: true }).fill(provider);
  await form.getByLabel("Label", { exact: true }).fill(label);
  await form.getByLabel("Key", { exact: true }).fill(value);
}

export const accountsStates: UiState[] = [
  {
    id: "list",
    label: "accounts with a usage line each",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await gotoVault(page, "accounts");
      await page.getByTestId("vault-accounts-list").waitFor({ state: "visible" });
    },
  },
  {
    id: "add",
    label: "add-key form offering the matching variable",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await fillAddKey(page, "assemblyai", "work", "aai-key-0123456789");
      await page.getByTestId("vault-account-variable").waitFor({ state: "visible" });
    },
  },
  {
    id: "add-too-short",
    label: "add-key: key shorter than 8 characters, inline validation",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await fillAddKey(page, "assemblyai", "work", "abc");
      await page.getByTestId("vault-account-submit").click();
      await page.getByText(/A key needs at least 8 characters/).waitFor({ state: "visible" });
    },
  },
  {
    id: "add-partial",
    label: "account saved, variable step failed: reported with Retry",
    stubs: [...READ, ACCOUNTS_WRITE, BINDINGS_WRITE],
    ...base,
    install: stubs({}, async (page) => {
      await savedAccount("assemblyai", "work")(page);
      await stubApi(page, BINDINGS_WRITE, (route) => fail(route, "Binding already exists"), "POST");
    }),
    open: async (page) => {
      await fillAddKey(page, "assemblyai", "work", "aai-key-0123456789");
      await page.getByTestId("vault-account-submit").click();
      await page.getByTestId("vault-account-partial").waitFor({ state: "visible" });
    },
  },
  {
    id: "rotate",
    label: "rotate row with the running-process note",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await gotoVault(page, "accounts");
      await account(page, "acc_g1").getByTestId("vault-account-rotate").click();
      await account(page, "acc_g1").locator('input[type="password"]').waitFor({ state: "visible" });
    },
  },
  {
    id: "revoke-confirm",
    label: "revoke: two-step confirm with its impact",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await gotoVault(page, "accounts");
      await account(page, "acc_g2").getByTestId("vault-account-revoke").click();
      await page.locator('[data-testid="vault-confirm-impact"][aria-busy="false"]').waitFor({ state: "visible" });
    },
  },
  {
    id: "future-slots",
    label: "sign-in accounts, services and another kind each get their place",
    stubs: READ,
    ...base,
    install: stubs({
      accounts: [
        ...ACCOUNTS,
        { id: "acc_oa", provider: "google", kind: "oauth", namespace: "oauth", label: "anna@blackbelt.hu" },
        { id: "acc_sv", provider: "zrok", kind: "key", namespace: "service:zrok", label: "tunnel token" },
        { id: "acc_x1", provider: "custom", kind: "token", namespace: "other", label: "one" },
        { id: "acc_x2", provider: "custom", kind: "token", namespace: "other", label: "two" },
      ],
    }),
    open: async (page) => {
      await gotoVault(page, "accounts");
      await page.getByTestId("vault-accounts-signin").waitFor({ state: "visible" });
      await page.getByTestId("vault-accounts-services").waitFor({ state: "visible" });
      await page.getByTestId("vault-accounts-other").waitFor({ state: "visible" });
    },
  },
];

const PROPOSAL = {
  id: "p1",
  items: [{ name: "GEMINI_API_KEY" }, { name: "SONIOX_API_KEY" }, { name: "ASSEMBLYAI_API_KEY" }],
  skipped: [
    { name: "PATH", reason: "not a valid variable name" },
    { name: "DEBUG_TOKEN", reason: "value shorter than 8 characters" },
  ],
};

const proposeStub = (page: Page) => stubApi(page, PROPOSE, (route) => ok(route, PROPOSAL), "POST");

async function openReview(page: Page): Promise<void> {
  await gotoVault(page, "import");
  await page.getByTestId("vault-import-review").first().click();
  await page.getByTestId("vault-import-proposal").waitFor({ state: "visible" });
}

export const importStates: UiState[] = [
  {
    id: "candidates",
    label: "key files found on this dashboard",
    stubs: READ,
    ...base,
    install: stubs(),
    open: async (page) => {
      await gotoVault(page, "import");
      await page.getByTestId("vault-import-candidates").waitFor({ state: "visible" });
    },
  },
  {
    id: "review",
    label: "review: names only, skipped reasons, optional variables",
    stubs: [...READ, PROPOSE],
    ...base,
    install: stubs({}, proposeStub),
    open: openReview,
  },
  {
    id: "done",
    label: "imported: variables created, next step offered",
    stubs: [...READ, PROPOSE, CONFIRM_IMPORT, BINDINGS_WRITE],
    ...base,
    install: stubs({}, async (page) => {
      await proposeStub(page);
      await stubApi(
        page,
        CONFIRM_IMPORT,
        (route) => ok(route, { created: PROPOSAL.items.map((i, n) => ({ ...key(`acc_i${n}`, "imported", i.name), label: i.name })) }),
        "POST",
      );
      await stubApi(page, BINDINGS_WRITE, (route) => ok(route, env("ASSEMBLYAI_API_KEY", "acc_i2")), "POST");
    }),
    open: async (page) => {
      await openReview(page);
      await page.getByTestId("vault-import-confirm").click();
      await page.getByTestId("vault-import-done").waitFor({ state: "visible" });
    },
  },
];

/** `GET /api/session/:id/vault-bindings` for the spawned session. */
const bindingsPath = () => `/api/session/${vault.sessionId}/vault-bindings`;
const SESSION_DASH = { deviceId: "hub", dir: DIR_DASH, repoKey: REPO_DASH };
const LAST_CONTACT = Date.UTC(2030, 0, 2, 8, 31, 2);

const chipStub = (state: { bindings: Array<{ name: string; state: string }>; project?: typeof SESSION_DASH; ungranted?: string[] }) => (page: Page) =>
  stubApi(page, bindingsPath(), (route) => ok(route, { lastContactAt: LAST_CONTACT, project: SESSION_DASH, ...state }), "GET");

const DELIVERED = [
  { name: "GEMINI_API_KEY", state: "delivered" },
  { name: "SONIOX_API_KEY", state: "local-override" },
];

/** Open the session whose header hosts the chip. */
async function gotoSession(page: Page): Promise<void> {
  if (!vault.sessionId) throw new Error("vault.sessionId is empty — the spec must spawn a session first");
  await page.goto(`/session/${vault.sessionId}`);
  await page.getByTestId("vault-chip").waitFor({ state: "visible", timeout: 60_000 });
}

async function openDialog(page: Page): Promise<void> {
  await gotoSession(page);
  await page.getByTestId("vault-chip").click();
  await page.getByTestId("vault-bindings-dialog").waitFor({ state: "visible" });
}

const dialog = (page: Page): Locator => page.getByTestId("vault-bindings-dialog");
const dialogState = (id: string, label: string, install: UiState["install"]): UiState => ({
  id,
  label,
  stubs: ["/api/session/:id/vault-bindings"],
  install,
  open: openDialog,
  root: dialog,
});

export const chipStates: UiState[] = [
  dialogState("delivered", "delivered and local-value-kept rows, explained", (page) => chipStub({ bindings: DELIVERED })(page)),
  dialogState("pending-confirmation", "checkout confirmation callout with a primary action", (page) =>
    chipStub({ bindings: [{ name: "GEMINI_API_KEY", state: "pending-confirmation" }], project: { deviceId: "hub", dir: DIR_DECK, repoKey: REPO_DECK } })(page),
  ),
  dialogState("mixed", "revoked, no-account, blocked-name and inherited rows, each explained", (page) =>
    chipStub({
      bindings: [
        { name: "GEMINI_API_KEY", state: "revoked" },
        { name: "OPENAI_API_KEY", state: "no-account" },
        { name: "PATH", state: "blocked-name" },
        { name: "SONIOX_API_KEY", state: "inherited" },
      ],
    })(page),
  ),
  dialogState("grant-from-session", "variables not yet granted to this project, grantable by an operator", (page) =>
    chipStub({ bindings: DELIVERED, ungranted: ["OPENAI_API_KEY"] })(page),
  ),
];

/** The closed chip in the session header (delivering, and awaiting confirmation). */
const triggerState = (id: string, label: string, bindings: Array<{ name: string; state: string }>): UiState => ({
  id,
  label,
  stubs: ["/api/session/:id/vault-bindings"],
  install: (page) => chipStub({ bindings })(page),
  open: gotoSession,
  root: (page) => page.getByTestId("vault-chip"),
});

export const chipTriggerStates: UiState[] = [
  triggerState("trigger-delivered", "closed chip, keys delivered", DELIVERED),
  triggerState("trigger-pending", "closed chip, confirmation pending", [{ name: "GEMINI_API_KEY", state: "pending-confirmation" }]),
];
