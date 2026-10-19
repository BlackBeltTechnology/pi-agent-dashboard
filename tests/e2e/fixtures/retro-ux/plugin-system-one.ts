import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Decision models (System 1) settings states. The three reads
 * (`/api/system-one/{config,keys,consumers}`) pass the real answer through;
 * "load error" fails the config read, "changed on disk" fails the Save-bar write
 * with a 409 (`PUT /api/system-one/config`). See change: retro-ux-plugin-settings-wave-2.
 */

const CONFIG = "/api/system-one/config";
const KEYS = "/api/system-one/keys";
const CONSUMERS = "/api/system-one/consumers";

/** Real answer, patched by `patch`. */
const real = (path: string, patch: (body: Record<string, unknown>) => void) => (page: Page) =>
  stubApi(
    page,
    path,
    async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      patch(body);
      await route.fulfill({ response: res, json: body });
    },
    "GET",
  );

const reads = all(
  real(CONFIG, (b) => {
    b.exists = true;
  }),
  real(KEYS, (b) => {
    (b.keys as Record<string, { set: boolean; source: string | null }>).TYPESAFE_API_KEY = { set: true, source: "file" };
  }),
  real(CONSUMERS, () => {}),
);

const ready = (page: Page) => page.getByTestId("system-one-settings");

export const systemOneStates: UiState[] = [
  bodyState("system-one", { id: "populated", label: "real config, key saved", stubs: [CONFIG, KEYS, CONSUMERS], install: reads, ready }),
  bodyState("system-one", {
    id: "load-error",
    label: "system-one.json cannot be parsed",
    stubs: [CONFIG, KEYS, CONSUMERS],
    install: all(reads, (page) => stubApi(page, CONFIG, (route) => json(route, { error: "E_PARSE" }, 500), "GET")),
    ready: (page) => page.getByTestId("system-one-load-error"),
  }),
  bodyState("system-one", {
    id: "changed-on-disk",
    label: "Save refused, file changed on disk",
    stubs: [CONFIG, KEYS, CONSUMERS],
    install: all(reads, (page) => stubApi(page, CONFIG, (route) => json(route, { error: "E_CONFLICT" }, 409), "PUT")),
    ready,
    extra: async (page) => {
      await page.getByTestId("system-one-allow-off-machine").click();
      await page.getByTestId("save-btn").click();
      await page.getByTestId("system-one-conflict").waitFor({ state: "visible" });
    },
  }),
];
