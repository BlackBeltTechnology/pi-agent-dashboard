/**
 * FolderGoalsSection — sidebar-folder-section claim.
 * Verifies the slot renders `Goals (N)` from the REST count and opens the
 * board route on click (task 3.1), and the `+ Goal` create flow posts +
 * navigates (task 3.2).
 *
 * See change: add-goals-folder-page.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FolderGoalsSection } from "../client/FolderGoalsSection.js";
import { goalsBoardUrl } from "../client/goals-api.js";

const cwd = "/repo/alpha";

function mockFetch(goals: unknown[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, data: { id: "g-new", objective: "x" } }) } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: goals }) } as Response;
  });
}

beforeEach(() => { (globalThis as any).fetch = mockFetch([{ id: "g1" }, { id: "g2" }]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderSlot(hook?: any) {
  return render(
    <Router hook={hook}>
      <FolderGoalsSection folder={{ cwd }} />
    </Router>,
  );
}

describe("FolderGoalsSection", () => {
  it("renders the Goals pill with the fetched count", async () => {
    const { getByTestId } = renderSlot();
    // SlotPill: uppercase "Goals" label + bold count in `folder-goals-count`.
    await waitFor(() => expect(getByTestId("folder-goals-open-board").textContent).toContain("Goals"));
    expect(getByTestId("folder-goals-count").textContent).toBe("2");
  });

  it("opens the goals board on click", async () => {
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = renderSlot(hook);
    await waitFor(() => expect(getByTestId("folder-goals-count").textContent).toBe("2"));
    fireEvent.click(getByTestId("folder-goals-open-board"));
    expect(history[history.length - 1]).toBe(goalsBoardUrl(cwd));
  });

  it("+ Goal opens the shared dialog (no inline panel) and creates on Enter", async () => {
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId, queryByTestId, getByPlaceholderText } = renderSlot(hook);
    fireEvent.click(getByTestId("folder-goal-new-btn"));
    expect(getByTestId("goal-create-dialog")).toBeTruthy();
    expect(queryByTestId("folder-goal-create")).toBeNull();
    const input = getByPlaceholderText("Goal objective…");
    fireEvent.change(input, { target: { value: "Ship goals" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(history[history.length - 1]).toBe(goalsBoardUrl(cwd)));
  });
});
