import type { Locator, Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { stubApi } from "./stubs.js";

/**
 * Shared helpers for the wave-2 plugin settings fixtures (`plugin-<id>.ts`).
 * A plugin page is `/settings/plugins/<id>`; the host mounts the body in
 * `plugin-page-body-<id>` and the chrome card in `plugin-page-chrome`.
 * Config-backed states patch the REAL `GET /api/config` answer
 * (`data.plugins.<id>`), so the client seeds the plugin config the way it does
 * on a fresh load; plugin REST states stub the plugin's own routes.
 *
 * See change: retro-ux-plugin-settings-wave-2.
 */

export const pluginPath = (id: string) => `/settings/plugins/${id}`;
export const bodyOf = (id: string) => (page: Page) => page.getByTestId(`plugin-page-body-${id}`);
export const chromeOf = (page: Page) => page.getByTestId("plugin-page-chrome");

export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Patch `data.plugins.<id>` for each entry in the real `GET /api/config` answer (merged over what is stored). */
export const patchConfigs = (patches: Record<string, Record<string, unknown>>) => (page: Page) =>
  stubApi(
    page,
    "/api/config",
    async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { data?: { plugins?: Record<string, Record<string, unknown>> } };
      const data = body.data ?? {};
      const plugins = { ...(data.plugins ?? {}) };
      for (const [id, patch] of Object.entries(patches)) plugins[id] = { ...(plugins[id] ?? {}), ...patch };
      await route.fulfill({ response: res, json: { ...body, data: { ...data, plugins } } });
    },
    "GET",
  );

export const patchConfig = (id: string, patch: Record<string, unknown>) => patchConfigs({ [id]: patch });

type Row = { id: string; status?: Record<string, unknown> | null } & Record<string, unknown>;

/** Patch one row of the real `GET /api/plugins` answer (the host chrome reads status from it). */
export const patchRow = (id: string, patch: (row: Row) => void) => (page: Page) =>
  stubApi(
    page,
    "/api/plugins",
    async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { plugins?: Row[] };
      for (const row of body.plugins ?? []) if (row.id === id) patch(row);
      await route.fulfill({ response: res, json: body });
    },
    "GET",
  );

/**
 * Report plugin `id` enabled in the real `GET /api/health` answer. The client's slot registry
 * takes its enabled set from `health.plugins[]` (`usePluginEnabledSet`), so a plugin that is
 * `defaultEnabled: false` renders no body until health says so.
 */
export const enableInHealth = (id: string) => (page: Page) =>
  stubApi(
    page,
    "/api/health",
    async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { plugins?: Array<{ id: string; enabled?: boolean }> };
      const plugins = body.plugins ?? [];
      const known = plugins.find((p) => p.id === id);
      if (known) known.enabled = true;
      else plugins.push({ id, enabled: true });
      await route.fulfill({ response: res, json: { ...body, plugins } });
    },
    "GET",
  );

/** Run several `install` steps in order. */
export const all =
  (...steps: Array<(page: Page) => Promise<void>>) =>
  async (page: Page) => {
    for (const step of steps) await step(page);
  };

/** Make the page's first-render settle: every `<details>` under `scope` open so every field is probed. */
export const openAll = (scope: Locator) =>
  scope.evaluate((el) => {
    for (const d of el.querySelectorAll("details")) d.open = true;
  });

/**
 * Open a plugin page and wait for `ready`. Skips the navigation when the page is
 * already there (the matrix reloads in the theme first), then opens every group.
 */
export const openPlugin =
  (id: string, ready: (page: Page) => Locator, extra?: (page: Page) => Promise<void>) => async (page: Page) => {
    if (new URL(page.url()).pathname !== pluginPath(id)) await page.goto(pluginPath(id));
    await ready(page).waitFor({ state: "visible", timeout: 30_000 });
    await openAll(bodyOf(id)(page));
    if (extra) await extra(page);
  };

/** A plugin-body state: probes `plugin-page-body-<id>`. */
export function bodyState(
  id: string,
  state: { id: string; label: string; stubs: string[]; install: UiState["install"]; ready: (page: Page) => Locator; extra?: (page: Page) => Promise<void> },
): UiState {
  return {
    id: state.id,
    label: state.label,
    stubs: state.stubs,
    install: state.install,
    open: openPlugin(id, state.ready, state.extra),
    root: bodyOf(id),
  };
}
