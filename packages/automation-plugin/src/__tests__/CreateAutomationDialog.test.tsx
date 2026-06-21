/**
 * CreateAutomationDialog: writes to the chosen scope, includes the prompt
 * body for prompt actions, and records a per-automation visibility override.
 * api mocked. See change: add-automation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { createAutomation } = vi.hoisted(() => ({
  createAutomation: vi.fn(async (_body: { scope: string; cwd?: string; name: string; config: { action: unknown; model: string; visibility?: string }; promptBody?: string }) => ({ ok: true as const })),
}));
vi.mock("../client/api.js", () => ({ createAutomation }));

import { CreateAutomationDialog } from "../client/CreateAutomationDialog.js";

afterEach(cleanup);
beforeEach(() => createAutomation.mockClear());

describe("CreateAutomationDialog", () => {
  it("creates a global prompt automation with a visibility override", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { getByTestId } = render(
      <CreateAutomationDialog cwd="/repo" onClose={onClose} onCreated={onCreated} />,
    );

    fireEvent.change(getByTestId("create-name"), { target: { value: "weekly-brief" } });
    fireEvent.change(getByTestId("create-scope"), { target: { value: "global" } });
    fireEvent.change(getByTestId("create-prompt"), { target: { value: "Summarize the week." } });
    fireEvent.change(getByTestId("create-model"), { target: { value: "@fast" } });
    fireEvent.change(getByTestId("create-visibility"), { target: { value: "shown" } });
    fireEvent.click(getByTestId("create-submit"));

    await waitFor(() => expect(createAutomation).toHaveBeenCalledTimes(1));
    const body = createAutomation.mock.calls[0]![0]!;
    expect(body.scope).toBe("global");
    expect(body.name).toBe("weekly-brief");
    expect(body.config.action).toEqual({ kind: "prompt", prompt: "./prompt.md" });
    expect(body.promptBody).toBe("Summarize the week.");
    expect(body.config.model).toBe("@fast");
    expect(body.config.visibility).toBe("shown");
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("omits visibility when using the settings default", async () => {
    const { getByTestId } = render(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />);
    fireEvent.change(getByTestId("create-name"), { target: { value: "x" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.visibility).toBeUndefined();
  });

  it("writes folder scope with the repo cwd by default", async () => {
    const { getByTestId } = render(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />);
    fireEvent.change(getByTestId("create-name"), { target: { value: "in-repo" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    const body = createAutomation.mock.calls[0]![0]!;
    expect(body.scope).toBe("folder");
    expect(body.cwd).toBe("/repo");
  });
});
