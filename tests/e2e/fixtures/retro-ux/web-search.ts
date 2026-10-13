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

/** Test id that proves the expanded body reached the state (not still "Loading details…"). */
type Ready = "web-search-detail" | "web-search-loading" | "web-search-error" | null;

function state(id: string, label: string, row: Row, install: UiState["install"], ready: Ready): UiState {
  return {
    id,
    label,
    stubs: [ENDPOINT],
    install,
    open: async (page) => {
      await openChat(page);
      await reveal(page, row(page));
      if (ready === null) return;
      await row(page).getByTestId("web-search-toggle").click();
      await row(page).getByTestId(ready).waitFor({ state: "visible", timeout: 15_000 });
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
  state("collapsed", "search row, collapsed", searchRow, async () => {}, null),
  state("expanded", "answer, results, per-query error, no results", searchRow, withPayload(RETRO_UX_SEARCH_PAYLOAD), "web-search-detail"),
  state("fetch", "fetch row with one 404", fetchRow, withPayload(RETRO_UX_FETCH_PAYLOAD), "web-search-detail"),
  state(
    "loading",
    "payload request pending",
    searchRow,
    (page) => stubEntryPayload(page, () => hold()),
    "web-search-loading",
  ),
  state(
    "evicted",
    "payload evicted (404) → stored body",
    searchRow,
    (page) => stubEntryPayload(page, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" })),
    "web-search-error",
  ),
  state("skipped", "one malformed result", searchRow, withPayload(SKIPPED_PAYLOAD), "web-search-detail"),
];
