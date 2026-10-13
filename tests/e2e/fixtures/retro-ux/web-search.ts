import type { Page } from "@playwright/test";
import { RETRO_UX_FETCH_PAYLOAD, RETRO_UX_SEARCH_PAYLOAD } from "../../../../qa/fixtures/faux-scenarios.js";
import type { UiState } from "../../helpers/ui-capture.js";
import { openChat, payloadOk, reveal, stubEntryPayload } from "./chat-session.js";
import { hold } from "./stubs.js";

/**
 * Web-search / web-fetch row states. The collapsed rows come from the scenario
 * transcript; every payload state is reached by answering
 * `GET /api/sessions/:id/entry/:entryId` with a stub.
 *
 * See change: retro-ux-chat-rendering.
 */

const ENDPOINT = "GET /api/sessions/:id/entry/:entryId";
const searchRow = (page: Page) => page.getByTestId("web-search-entry").filter({ hasText: "Web search" }).first();
const fetchRow = (page: Page) => page.getByTestId("web-search-entry").filter({ hasText: "Web fetch" }).first();

type Row = (page: Page) => ReturnType<typeof searchRow>;

function state(id: string, label: string, row: Row, install: UiState["install"], expand: boolean): UiState {
  return {
    id,
    label,
    stubs: [ENDPOINT],
    install,
    open: async (page) => {
      await openChat(page);
      await reveal(page, row(page));
      if (expand) await row(page).getByTestId("web-search-toggle").click();
    },
    root: row,
  };
}

const withPayload = (payload: unknown): UiState["install"] => (page) =>
  stubEntryPayload(page, (route) => payloadOk(route, payload));

/** A search payload whose second result is malformed (counted, not displayed). */
const SKIPPED_PAYLOAD = {
  type: "search",
  queries: [
    {
      query: "mermaid flowchart label quoting",
      provider: "exa",
      results: [{ title: "Flowcharts syntax | Mermaid", url: "https://mermaid.js.org/syntax/flowchart.html", snippet: "" }, null],
    },
  ],
};

export const webSearchStates: UiState[] = [
  state("collapsed", "search row, collapsed", searchRow, async () => {}, false),
  state("expanded", "answer, results, per-query error, no results", searchRow, withPayload(RETRO_UX_SEARCH_PAYLOAD), true),
  state("fetch", "fetch row with one 404", fetchRow, withPayload(RETRO_UX_FETCH_PAYLOAD), true),
  state(
    "loading",
    "payload request pending",
    searchRow,
    (page) => stubEntryPayload(page, () => hold()),
    true,
  ),
  state(
    "evicted",
    "payload evicted (404) → stored body",
    searchRow,
    (page) => stubEntryPayload(page, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" })),
    true,
  ),
  state("skipped", "one malformed result", searchRow, withPayload(SKIPPED_PAYLOAD), true),
];
