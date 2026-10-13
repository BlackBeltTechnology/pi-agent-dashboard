import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { RETRO_UX_CHAT_TAIL } from "../../../../qa/fixtures/faux-scenarios.js";
import { BASE_URL } from "../../lifecycle.js";

/**
 * Shared pieces of the chat-rendering state fixtures: the one live session the
 * `retro-ux-chat-rendering` faux scenario fills, a way to bring a row into view
 * (rows can sit inside a collapsed tool burst), and the entry-payload stub.
 *
 * See change: retro-ux-chat-rendering (design D1, D7).
 */

/** Filled by the spec once the scenario's session exists. */
export const chat = { sessionId: "" };

/** Open the scenario session and wait for its last message. */
export async function openChat(page: Page): Promise<void> {
  if (!chat.sessionId) throw new Error("chat.sessionId is empty — the spec must spawn the scenario session first");
  await page.goto(`/session/${chat.sessionId}`);
  await expect(page.getByText(RETRO_UX_CHAT_TAIL).first()).toBeVisible({ timeout: 60_000 });
}

/** Make `row` visible, expanding tool bursts one by one while it is not (a burst renders collapsed). */
export async function reveal(page: Page, row: Locator): Promise<void> {
  const headers = page.getByTestId("tool-burst-header");
  const n = await headers.count();
  for (let i = 0; i < n && !(await row.first().isVisible()); i++) await headers.nth(i).click();
  await expect(row.first()).toBeVisible({ timeout: 15_000 });
}

const sameOrigin = (url: URL) => url.origin === new URL(BASE_URL).origin;
const ENTRY = /^\/api\/sessions\/[^/]+\/entry\/[^/]+$/;

/** Answer every payload request (`GET /api/sessions/:id/entry/:entryId`) with `handler`. */
export async function stubEntryPayload(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route((url) => sameOrigin(url) && ENTRY.test(url.pathname), handler);
}

export const payloadOk = (route: Route, payload: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { payload } }) });
