import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { openChat, reveal } from "./chat-session.js";

/**
 * Unclaimed custom-entry fallback states (`kv`, `more`, `plain`). The rows come
 * from the `retro-ux-chat-rendering` scenario; nothing is stubbed on the server,
 * so the declared "stub" is the session transcript request the page replays.
 *
 * See change: retro-ux-chat-rendering.
 */

const card = (page: Page, type: string) =>
  page.getByTestId("custom-entry-card").filter({ hasText: type }).first();

const state = (id: string, label: string, type: string): UiState => ({
  id,
  label,
  stubs: ["GET /session/:id (scenario transcript)"],
  install: async () => {},
  open: async (page) => {
    await openChat(page);
    await reveal(page, card(page, type));
  },
  root: (page) => card(page, type),
});

export const customEntryStates: UiState[] = [
  state("kv", "object body", "e2e:kv"),
  state("more", "object body over the 50-key bound", "e2e:more"),
  state("plain", "string body", "e2e:plain"),
];
