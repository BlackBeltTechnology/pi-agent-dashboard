import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * OBS Studio settings states, reached by answering
 * `GET /api/plugins/obs-studio/instances`. See change: retro-ux-plugin-settings-wave-2.
 */

const INSTANCES = "/api/plugins/obs-studio/instances";

const answer = (instances: unknown[]) => (page: Page) =>
  stubApi(page, INSTANCES, (route) => json(route, { instances }), "GET");

export const obsStudioStates: UiState[] = [
  bodyState("obs-studio", {
    id: "none-provisioned",
    label: "no OBS instance provisioned",
    stubs: [INSTANCES],
    install: answer([]),
    ready: (page) => page.getByTestId("obs-settings-none"),
  }),
  bodyState("obs-studio", {
    id: "provisioned-warnings",
    label: "one running, one rejected + exposed + recovery suspended",
    stubs: [INSTANCES],
    install: answer([
      { id: "studio-a", mode: "managed", state: "healthy", live: { obsVersion: "31.0.2", scenes: ["Main"] } },
      {
        id: "studio-b",
        mode: "managed",
        state: "failed",
        exposure: "all-interfaces",
        recoverySuspended: true,
        liveError: "auth-failed",
      },
    ]),
    ready: (page) => page.getByTestId("obs-instance-studio-b"),
  }),
  bodyState("obs-studio", {
    id: "load-error",
    label: "instances request fails",
    stubs: [INSTANCES],
    install: (page) => stubApi(page, INSTANCES, (route) => json(route, { error: "boom" }, 500), "GET"),
    ready: (page) => page.getByTestId("obs-settings-error"),
  }),
];
