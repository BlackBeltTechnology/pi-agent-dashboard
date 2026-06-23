/**
 * CreateGoalDialog — shared goal create modal.
 * Verifies the dialog renders the `GoalForm`, closes via backdrop + ✕, and
 * that submitting posts through `createGoal` then fires `onCreated` + closes.
 *
 * See change: redesign-goal-create-dialog (task 3.1).
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CreateGoalDialog } from "../client/CreateGoalDialog.js";

const cwd = "/repo/alpha";

let posts: { url: string; body: any }[];
function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, json: async () => ({ success: true, data: { id: "g-new", cwd, objective: "Ship goals" } }) } as Response;
    }
    // GET /api/favorite-models (useJudgeModels) and any other GET
    return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
  });
}

beforeEach(() => { posts = []; (globalThis as any).fetch = mockFetch(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("CreateGoalDialog", () => {
  it("renders the dialog with GoalForm inside", () => {
    const { getByTestId } = render(<CreateGoalDialog cwd={cwd} onClose={() => {}} />);
    expect(getByTestId("goal-create-dialog")).toBeTruthy();
    expect(getByTestId("goal-create-dialog-title").textContent).toContain("alpha");
    expect(getByTestId("goal-form")).toBeTruthy();
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<CreateGoalDialog cwd={cwd} onClose={onClose} />);
    fireEvent.click(getByTestId("goal-create-dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the card", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<CreateGoalDialog cwd={cwd} onClose={onClose} />);
    fireEvent.click(getByTestId("goal-form"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on ✕", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<CreateGoalDialog cwd={cwd} onClose={onClose} />);
    fireEvent.click(getByTestId("goal-create-dialog-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits through createGoal then fires onCreated + onClose", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { getByTestId } = render(<CreateGoalDialog cwd={cwd} onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(getByTestId("goal-form-objective"), { target: { value: "Ship goals" } });
    fireEvent.click(getByTestId("goal-form-submit"));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toContain("/api/folders/goals");
    expect(posts[0].body.objective).toBe("Ship goals");
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
