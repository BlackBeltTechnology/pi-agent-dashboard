// @vitest-environment jsdom
/**
 * Selected tab survives a host remount (test-plan S97, e2e agent-teams-team-view-route).
 * The dashboard shell swaps its layout tree at the mobile breakpoint, which unmounts and
 * remounts the overlay claim; the view must restore the tab for the same team (and a
 * different store/team starts at Members). See change: add-agent-teams-ui.
 */
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionEventsStoreForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamViewClaim } from "../TeamView.js";
import { createTeamsStore } from "../teams-store.js";
import { createServer, flush } from "./team-view-harness.js";
import { member, snap, task } from "./view-fixtures.js";
import { renderHost } from "./view-fixtures.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const selected = (): string[] => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.getAttribute("data-testid") ?? "");

describe("tab selection across a host layout swap (S97)", () => {
  it("restores the selected tab after the claim remounts under a different parent", async () => {
    __resetSessionEventsStoreForTests();
    const { fetch } = createServer(snap({ members: [member("alice", "busy", { sessionId: "S-a" })], tasks: [task("3", "pending")] }));
    const store = createTeamsStore({ fetch });
    const tree = (wide: boolean): ReactElement => {
      const claim = (
        <PluginContextProvider connectionStatus="connected">
          <TeamViewClaim params={{ sessionId: "S-lead" }} store={store} />
        </PluginContextProvider>
      );
      return wide ? <div>{claim}</div> : <section>{claim}</section>;
    };
    const view = renderHost(tree(true));
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: /Tasks/ }));
    expect(selected()).toEqual(["team-tab-tasks"]);

    for (const wide of [false, true]) {
      view.rerender(tree(wide));
      await flush();
      expect(selected()).toEqual(["team-tab-tasks"]);
    }
    store.dispose();
  });
});
