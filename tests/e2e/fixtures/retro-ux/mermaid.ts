import type { Locator, Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { openChat } from "./chat-session.js";
import { hold } from "./stubs.js";

/**
 * Mermaid block states in the chat: `loading` (the mermaid chunk is held), `repaired`,
 * `original` (show original), `error` (unrepairable) and `zoomed` (activated, controls
 * shown). The three diagrams come from the `retro-ux-chat-rendering` scenario, in this
 * order: valid, repairable (R4), unrepairable. The `ai-*` states are not covered: they
 * need `add-mermaid-ai-repair`, which has not landed (task 0.2).
 *
 * See change: retro-ux-chat-rendering.
 */

const MERMAID_CHUNK = "**/assets/mermaid.core-*.js";
const SCENARIO = ["GET /session/:id (scenario transcript)"];

const viewport = (page: Page) => page.getByRole("group", { name: /^Diagram\./ });
const badge = (page: Page) => page.getByTestId("mermaid-repair-badge").first();
const errorCallout = (page: Page) => page.getByTestId("mermaid-error").first();
const zoomControls = (page: Page): Locator => page.getByRole("button", { name: "Zoom in" }).first().locator("xpath=..");

const noop = async () => {};

export const mermaidStates: UiState[] = [
  {
    id: "loading",
    label: "mermaid chunk pending",
    stubs: [`GET ${MERMAID_CHUNK}`],
    install: async (page) => {
      await page.route(MERMAID_CHUNK, () => hold());
    },
    open: async (page) => {
      await openChat(page);
      await page.getByRole("status").filter({ hasText: "Rendering diagram" }).first().waitFor({ state: "visible" });
    },
    root: (page) => page.getByRole("status").filter({ hasText: "Rendering diagram" }).first(),
  },
  {
    id: "repaired",
    label: "auto-fixed badge (R4)",
    stubs: SCENARIO,
    install: noop,
    open: async (page) => {
      await openChat(page);
      await badge(page).waitFor({ state: "visible", timeout: 30_000 });
    },
    root: badge,
  },
  {
    id: "original",
    label: "show original",
    stubs: SCENARIO,
    install: noop,
    open: async (page) => {
      await openChat(page);
      await badge(page).waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("button", { name: "Show original" }).first().click();
      await errorCallout(page).waitFor({ state: "visible" });
    },
    root: errorCallout,
  },
  {
    id: "error",
    label: "unrepairable",
    stubs: SCENARIO,
    install: noop,
    open: async (page) => {
      await openChat(page);
      await errorCallout(page).waitFor({ state: "visible", timeout: 30_000 });
    },
    root: errorCallout,
  },
  {
    id: "zoomed",
    label: "activated, zoom controls shown",
    stubs: SCENARIO,
    install: noop,
    open: async (page) => {
      await openChat(page);
      const vp = viewport(page).first();
      await vp.waitFor({ state: "visible", timeout: 30_000 });
      await vp.click();
      await zoomControls(page).waitFor({ state: "visible" });
    },
    root: zoomControls,
  },
];
