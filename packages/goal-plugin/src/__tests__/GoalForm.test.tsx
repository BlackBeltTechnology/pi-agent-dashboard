/**
 * GoalForm (Screen A) — rich authoring form.
 * Verifies a full payload (objective + criteria + budget + judge) reaches
 * onSubmit (task 4.1) and the model picker + cross-model/self-judge badge
 * (task 4.2).
 *
 * See change: sophisticate-goal-authoring-and-control.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GoalForm, type GoalFormPayload } from "../client/GoalForm.js";

beforeEach(() => {
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: { labels: ["anthropic/claude", "openai/gpt-5"] } }),
  }));
});
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); vi.restoreAllMocks(); globalThis.fetch = originalFetch; });

describe("GoalForm", () => {
  it("submits a full payload (objective + criteria + budget + judge)", async () => {
    const onSubmit = vi.fn(async (_p: GoalFormPayload) => {});
    const { getByTestId } = render(<GoalForm onSubmit={onSubmit} />);
    await waitFor(() => expect(getByTestId("goal-form-judge").querySelectorAll("option").length).toBe(3));

    fireEvent.change(getByTestId("goal-form-objective"), { target: { value: "Ship goals" } });
    fireEvent.click(getByTestId("goal-form-add-criterion"));
    fireEvent.change(getByTestId("goal-form-criterion").querySelector("input")!, { target: { value: "Tests pass" } });
    fireEvent.change(getByTestId("goal-form-max-turns"), { target: { value: "30" } });
    fireEvent.change(getByTestId("goal-form-max-spend"), { target: { value: "5" } });
    fireEvent.change(getByTestId("goal-form-judge"), { target: { value: "anthropic/claude" } });
    fireEvent.click(getByTestId("goal-form-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      objective: "Ship goals",
      criteria: [{ text: "Tests pass", done: false }],
      budget: { maxTurns: 30, maxSpendUsd: 5 },
      judge: { provider: "anthropic", modelId: "claude" },
    });
  });

  it("renders model options and a cross-model badge by default", async () => {
    const { getByTestId } = render(<GoalForm onSubmit={async () => {}} />);
    await waitFor(() => expect(getByTestId("goal-form-judge").querySelectorAll("option").length).toBe(3));
    fireEvent.change(getByTestId("goal-form-judge"), { target: { value: "openai/gpt-5" } });
    expect(getByTestId("goal-form-judge-badge").textContent).toBe("cross-model");
  });

  it("shows self-judge badge when the toggle is on", async () => {
    const { getByTestId } = render(<GoalForm onSubmit={async () => {}} />);
    await waitFor(() => expect(getByTestId("goal-form-judge").querySelectorAll("option").length).toBe(3));
    fireEvent.change(getByTestId("goal-form-judge"), { target: { value: "openai/gpt-5" } });
    fireEvent.click(getByTestId("goal-form-self-judge"));
    expect(getByTestId("goal-form-judge-badge").textContent).toBe("self-judge");
  });

  it("omits optional fields when only an objective is given", async () => {
    const onSubmit = vi.fn(async (_p: GoalFormPayload) => {});
    const { getByTestId } = render(<GoalForm onSubmit={onSubmit} />);
    fireEvent.change(getByTestId("goal-form-objective"), { target: { value: "Just objective" } });
    fireEvent.click(getByTestId("goal-form-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual({ objective: "Just objective" });
  });
});
