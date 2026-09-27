/**
 * SessionContentGate (change: fix-browser-live-view-subscribe-and-reopen, D6):
 * the content-view gate re-evaluates claim predicates on a slot-claims bump,
 * even when the selected session itself does not change (idle session).
 */
import {
  __resetSlotClaimsVersionForTests,
  bumpSlotClaimsVersion,
  createSlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionContentGate } from "../SessionContentGate.js";

const SESSION = { id: "s1" } as DashboardSession;

afterEach(() => {
  cleanup();
  __resetSlotClaimsVersionForTests();
});

describe("SessionContentGate", () => {
  it("renders the content-view claim after a bump flips its predicate on an idle session", () => {
    let active = false;
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "p",
      priority: 100,
      slot: "content-view",
      Component: () => null,
      predicate: () => active,
    });
    const { queryByTestId } = render(
      <SessionContentGate
        registry={registry}
        session={SESSION}
        renderContentView={() => <div data-testid="content-view" />}
        renderDetail={() => <div data-testid="chat" />}
      />,
    );
    expect(queryByTestId("chat")).not.toBeNull();
    expect(queryByTestId("content-view")).toBeNull();

    active = true;
    act(() => bumpSlotClaimsVersion());
    expect(queryByTestId("content-view")).not.toBeNull();
    expect(queryByTestId("chat")).toBeNull();
  });

  it("renders the detail when no session is selected", () => {
    const registry = createSlotRegistry();
    const { queryByTestId } = render(
      <SessionContentGate
        registry={registry}
        session={undefined}
        renderContentView={() => <div data-testid="content-view" />}
        renderDetail={() => <div data-testid="chat" />}
      />,
    );
    expect(queryByTestId("chat")).not.toBeNull();
  });
});
