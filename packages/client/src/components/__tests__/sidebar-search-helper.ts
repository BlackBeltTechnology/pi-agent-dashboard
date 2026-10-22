/**
 * Test helpers for the sidebar's scoped search box + filter funnel.
 * See change: declutter-sidebar-header (design D7).
 */
import { fireEvent, screen } from "@testing-library/react";

type SidebarSearchScope = "sessions" | "folders";

const INPUT_TESTID: Record<SidebarSearchScope, string> = {
  sessions: "session-search-input",
  folders: "workspace-filter-input",
};

/** Switch the scoped box to `scope`, then type `text` into it. */
export function setSidebarSearch(scope: SidebarSearchScope, text: string): HTMLInputElement {
  if (!screen.queryByTestId(INPUT_TESTID[scope])) fireEvent.click(screen.getByTestId(`search-scope-${scope}`));
  const input = screen.getByTestId(INPUT_TESTID[scope]) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  return input;
}

/** Open the filter funnel popover (idempotent). */
export function openFilterFunnel(): HTMLElement {
  if (!screen.queryByTestId("filter-funnel-panel")) fireEvent.click(screen.getByTestId("filter-funnel-btn"));
  return screen.getByTestId("filter-funnel-panel");
}
