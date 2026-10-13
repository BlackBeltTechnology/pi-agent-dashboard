import type { Locator, Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { ok, stubApi } from "./stubs.js";

/**
 * Model-selector states for the retro-UX review, reached with `page.route`
 * stubs on the REST endpoints the selector's hosts read (never by seeding the
 * server). Three surfaces:
 *
 *  - `picker`  — the dropdown, hosted by Settings ▸ Grammar (its trigger is the
 *    primitive with `allowRoles`; `GET /api/models` and `GET /api/roles` are
 *    plain REST, so every picker state is a stub).
 *  - `hosts`   — the closed trigger (follows a role: assigned / unassigned) and
 *    the Blackhole chain slot summary (role-bound entries with binding statuses).
 *  - `roles`   — Settings ▸ Model roles (pills, editor). The roles list reaches
 *    the browser through a live session, so the spec spawns one first; only the
 *    "Used by" overview is stubbed.
 *
 * Not reachable by REST stubs and therefore covered at L1 only (test-plan E10,
 * E12): the refreshing line and the provider-refresh-errors footer (both are fed
 * by the session's WebSocket `models_list`), and the one-shot composer hosts
 * (`once`, `notice`, `runconfig`) and the automation dialog, which need a live
 * session; the composer is driven in the spec's keyboard test (G6).
 *
 * See change: retro-ux-model-selector (design D1, task 2.1).
 */

const MODELS = [
  { id: "anthropic/claude-opus-4-7", provider: "anthropic" },
  { id: "anthropic/claude-sonnet-4-5", provider: "anthropic" },
  { id: "anthropic/claude-haiku-4-5", provider: "anthropic" },
  { id: "openai/gpt-5", provider: "openai" },
  { id: "openai/gpt-5-mini", provider: "openai" },
  { id: "proxy/gh/gpt-3.5-turbo", provider: "proxy" },
];

const ROLE_ROWS = [
  { role: "fast", assigned: true, model: "anthropic/claude-haiku-4-5", thinkingLevel: "low" },
  { role: "coding", assigned: true, model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" },
  { role: "nightly", assigned: true, model: "openai/gpt-5-mini" },
  { role: "research", assigned: false },
];

const rolesBody = (roles: unknown[]) => ({ object: "list", data: [{ preset: null, active: true, roles }] });

interface GrammarHost {
  models?: unknown[];
  /** `null` → the roles plugin answers 404 (no Roles tab). */
  roles?: unknown[] | null;
  /** Persisted `llm` role for the grammar trigger (`@fast`), or none. */
  role?: string;
}

/** Stub every REST source the grammar-hosted picker reads. */
async function stubGrammarHost(page: Page, host: GrammarHost = {}): Promise<void> {
  const { models = MODELS, roles = ROLE_ROWS, role } = host;
  await stubApi(page, "/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object: "list", data: models }) }), "GET");
  await stubApi(
    page,
    "/api/roles",
    (route) =>
      roles === null
        ? route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rolesBody(roles)) }),
    "GET",
  );
  // The settings panel and the grammar section both read `/api/config`: rewrite
  // the real payload rather than replace it, so the rest of the page stays authentic.
  await page.route(
    (url) => url.pathname === "/api/config",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const res = await route.fetch();
      const body = (await res.json()) as { data?: { plugins?: Record<string, unknown> } };
      body.data = { ...body.data, plugins: { ...(body.data?.plugins ?? {}), grammar: role ? { llm: { role } } : {} } };
      await route.fulfill({ response: res, json: body });
    },
  );
}

const GRAMMAR_PATH = "/settings/plugins/grammar";
const host = (page: Page) => page.getByTestId("grammar-llm-model-selector");
const trigger = (page: Page) => host(page).getByTestId("model-selector-button");
const dropdown = (page: Page) => page.getByTestId("model-dropdown");

async function gotoGrammar(page: Page): Promise<void> {
  await page.goto(GRAMMAR_PATH);
  await trigger(page).waitFor({ state: "visible", timeout: 30_000 });
}

async function openPicker(page: Page): Promise<void> {
  await gotoGrammar(page);
  await trigger(page).click();
  await dropdown(page).waitFor({ state: "visible" });
}

const pickerBase = { root: dropdown };

export const pickerStates: UiState[] = [
  {
    id: "models",
    label: "Models tab, grouped by provider",
    stubs: ["/api/models", "/api/roles"],
    install: (page) => stubGrammarHost(page),
    open: async (page) => {
      await openPicker(page);
      await dropdown(page).getByTestId("model-row").first().waitFor();
    },
    ...pickerBase,
  },
  {
    id: "favs",
    label: "Favorites only, one favorite starred",
    stubs: ["/api/models", "/api/roles"],
    install: (page) => stubGrammarHost(page),
    open: async (page) => {
      await openPicker(page);
      const first = dropdown(page).getByTestId("model-fav-toggle").first();
      if ((await first.getAttribute("aria-pressed")) !== "true") await first.click();
      const only = dropdown(page).getByTestId("favs-only-toggle");
      if ((await only.getAttribute("aria-pressed")) !== "true") await only.click();
      await dropdown(page).getByTestId("model-row").first().waitFor();
    },
    ...pickerBase,
  },
  {
    id: "nomatch",
    label: "filter with no match",
    stubs: ["/api/models", "/api/roles"],
    install: (page) => stubGrammarHost(page),
    open: async (page) => {
      await openPicker(page);
      await dropdown(page).getByTestId("model-filter").fill("zzz-no-such-model");
      await dropdown(page).getByText("No models match").waitFor();
    },
    ...pickerBase,
  },
  {
    id: "empty",
    label: "genuinely empty catalogue",
    stubs: ["/api/models", "/api/roles"],
    install: (page) => stubGrammarHost(page, { models: [] }),
    open: async (page) => {
      await openPicker(page);
      await dropdown(page).getByText("No models available").waitFor();
    },
    ...pickerBase,
  },
  {
    id: "roles",
    label: "Roles tab: assigned, level, custom, unassigned",
    stubs: ["/api/models", "/api/roles"],
    install: (page) => stubGrammarHost(page, { role: "@fast" }),
    open: async (page) => {
      await gotoGrammar(page);
      await trigger(page).click(); // current is a role ref → opens on the Roles tab
      await dropdown(page).getByTestId("role-list").waitFor();
      await dropdown(page).getByTestId("role-unassigned").waitFor();
    },
    ...pickerBase,
  },
  {
    id: "noroles",
    label: "Roles tab with no roles defined",
    stubs: ["/api/models", "/api/roles"],
    install: (page) => stubGrammarHost(page, { roles: [] }),
    open: async (page) => {
      await openPicker(page);
      await dropdown(page).getByTestId("model-tab-role").click();
      await dropdown(page).getByText(/No roles defined yet/).waitFor();
    },
    ...pickerBase,
  },
];

const hostBase = { stubs: ["/api/models", "/api/roles"], root: trigger };

export const hostStates: UiState[] = [
  {
    id: "persistent",
    label: "grammar trigger follows an assigned role",
    ...hostBase,
    install: (page) => stubGrammarHost(page, { role: "@fast" }),
    open: async (page) => {
      await gotoGrammar(page);
      await trigger(page).locator("[data-role-ref-model]").waitFor();
    },
  },
  {
    id: "unassigned",
    label: "grammar trigger follows an unassigned role",
    ...hostBase,
    install: (page) => stubGrammarHost(page, { role: "@research" }),
    open: async (page) => {
      await gotoGrammar(page);
      await trigger(page).getByText("No model assigned").waitFor();
    },
  },
];

// ── Blackhole chain slots ──────────────────────────────────────────────────

const BLACKHOLE_PATH = "/settings/plugins/blackhole";
const model = (id: string, provider = "anthropic") => ({ provider, id });

/** A `pi-blackhole` config whose observer chain holds role-bound slots in each binding status. */
function blackholeConfig() {
  const defaults: Record<string, unknown> = {
    compaction: "auto",
    compactionEngine: "blackhole",
    tailBehavior: "minimal",
    midRunCompaction: "off",
    memory: true,
    sessionFallback: true,
    debug: false,
    debugLog: false,
    observeAfterTokens: 15000,
    reflectAfterTokens: 25000,
    compactAfterTokens: 81000,
    observationsPoolMaxTokens: 20000,
    observationsPoolTargetTokens: 10000,
    observerChunkMaxTokens: 40000,
    observerPreambleMaxTokens: 0,
    reflectorInputMaxTokens: 80000,
    dropperInputMaxTokens: 80000,
    dropperPressureThreshold: 0.7,
    agentMaxTurns: 16,
    model: model("claude-opus-4-7"),
    observerModel: { ...model("claude-sonnet-4-5"), thinking: "high" },
    reflectorModel: model("claude-haiku-4-5"),
    dropperModel: model("claude-haiku-4-5"),
    observerFallbackModels: [model("claude-haiku-4-5"), model("claude-opus-4-7")],
  };
  const fields: Record<string, { value: unknown; default: unknown; isDefault: boolean }> = {};
  for (const [key, value] of Object.entries(defaults)) fields[key] = { value, default: value, isDefault: false };
  return {
    status: "ok",
    filePath: "/home/pi/.pi/agent/pi-blackhole/pi-blackhole-config.json",
    exists: true,
    unmanagedKeys: [],
    fields,
    roleBindings: [
      { field: "observerModel", ref: "@coding", status: "detached" },
      { field: "observerFallbackModels[0]", ref: "@research", status: "dangling" },
      { field: "observerFallbackModels[1]", ref: "@fast", status: "ok" },
    ],
  };
}

async function stubBlackhole(page: Page): Promise<void> {
  await page.route("**/api/plugins/blackhole/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ installed: true }) }),
  );
  await page.route("**/api/plugins", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { plugins?: { id: string; status?: unknown }[] };
    for (const row of body.plugins ?? []) {
      if (row.id === "blackhole") row.status = { ...(row.status as object), missingRequirements: [] };
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.route("**/api/plugins/blackhole/config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(blackholeConfig()) }),
  );
  await page.route("**/api/models*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object: "list", data: MODELS.map((m) => ({ ...m, reasoning: true })) }) }),
  );
  await stubApi(page, "/api/roles", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rolesBody(ROLE_ROWS)) }), "GET");
}

const chain = (page: Page) => page.getByTestId("blackhole-chain-observer");

export const chainStates: UiState[] = [
  {
    id: "chain",
    label: "Blackhole observer chain: detached, dangling and ok role slots",
    stubs: ["/api/roles"],
    install: stubBlackhole,
    open: async (page) => {
      await page.goto(BLACKHOLE_PATH);
      await chain(page).waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("blackhole-chain-observer-entry-0-role-status").waitFor();
    },
    root: chain,
  },
];

// ── Roles settings ─────────────────────────────────────────────────────────

const ROLES_PATH = "/settings/plugins/roles";
const rolesRoot = (page: Page): Locator => page.getByTestId("roles-settings");

/** `Used by` rows covering ok / detached / dangling, so the status pills are probed. */
const stubUsedBy = (page: Page) =>
  stubApi(
    page,
    "/api/roles/used-by",
    (route) =>
      ok(route, null, {
        usedBy: {
          fast: [
            { kind: "binding", owner: "blackhole", label: "observerModel", status: "detached" },
            { kind: "binding", owner: "blackhole", label: "reflectorModel", status: "dangling" },
            { kind: "usage", owner: "grammar", label: "grammar model" },
          ],
        },
      }),
    "GET",
  );

async function gotoRoles(page: Page): Promise<void> {
  await page.goto(ROLES_PATH);
  await rolesRoot(page).waitFor({ state: "visible", timeout: 30_000 });
}

export const rolesStates: UiState[] = [
  {
    id: "pills",
    label: "role pills and the Used by overview with binding statuses",
    stubs: ["/api/roles/used-by"],
    install: stubUsedBy,
    open: async (page) => {
      await gotoRoles(page);
      await page.getByTestId("roles-used-by").waitFor();
    },
    root: rolesRoot,
  },
  {
    id: "editor",
    label: "role editor open on the first pill",
    stubs: ["/api/roles/used-by"],
    install: stubUsedBy,
    open: async (page) => {
      await gotoRoles(page);
      await page.locator("[data-testid^='roles-row-']:not([data-testid$='-dirty']):not([data-testid$='-remove'])").first().click();
      await page.getByTestId("roles-model-picker").waitFor();
    },
    root: rolesRoot,
  },
];

export { dropdown as pickerDropdown, gotoGrammar, stubGrammarHost, trigger as grammarTrigger };
