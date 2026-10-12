/**
 * SessionFlowActions edit-mode gating + New/Edit launcher.
 * The New/Edit button shows only when editMode is on. Selecting a flow (or
 * "+ New flow") opens an intent-capture dialog; submitting it invokes
 * onEditFlow(name|undefined, instruction) so the claim can send
 * `/skill:manage-flows ...`. See change: rework-flows-plugin-for-new-pi-flows.
 */

import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionFlowActions } from "../client/SessionFlowActions.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.confirmDialog, (() => null) as never);
// Stub Dialog primitive used by FlowAuthorPromptDialog: render children + Footer/Cancel.
const Dialog = (({ children }: { children: React.ReactNode }) => <div>{children}</div>) as never;
(Dialog as unknown as { Footer: React.FC<{ children: React.ReactNode }>; Cancel: React.FC<{ onClick: () => void }> }).Footer =
  ({ children }) => <div>{children}</div>;
(Dialog as unknown as { Footer: React.FC; Cancel: React.FC<{ onClick: () => void }> }).Cancel =
  ({ onClick }) => <button onClick={onClick}>Cancel</button>;
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, Dialog);
// Stub SearchableSelectDialog: render each option as a button that selects it.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.searchableSelectDialog,
  (({ options, onSelect }: { options: Array<{ value: string; label: string }>; onSelect: (v: string) => void }) => (
    <div data-testid="picker">
      {options.map((o) => (
        <button key={o.value} onClick={() => onSelect(o.value)}>{o.label}</button>
      ))}
    </div>
  )) as never,
);

const flows: FlowInfo[] = [{ name: "invoice-research" } as FlowInfo];

function renderActions(props: Partial<React.ComponentProps<typeof SessionFlowActions>>) {
  return render(
    <UiPrimitiveProvider value={registry}>
      <SessionFlowActions
        flows={flows}
        editMode={false}
        onFlowAction={() => {}}
        onEditFlow={() => {}}
        {...props}
      />
    </UiPrimitiveProvider>,
  );
}

afterEach(() => cleanup());

describe("SessionFlowActions edit mode", () => {
  it("hides New / Edit when edit mode is off", () => {
    const { queryByTestId } = renderActions({ editMode: false });
    expect(queryByTestId("flows-new-edit-button")).toBeNull();
  });

  it("shows New / Edit when edit mode is on", () => {
    const { getByTestId } = renderActions({ editMode: true });
    expect(getByTestId("flows-new-edit-button")).toBeTruthy();
  });

  it("editing a flow prompts for an instruction, then calls onEditFlow(name, instruction)", () => {
    const onEditFlow = vi.fn();
    const { getByTestId, getByText } = renderActions({ editMode: true, onEditFlow });
    fireEvent.click(getByTestId("flows-new-edit-button"));
    fireEvent.click(getByText("invoice-research"));
    // Intent dialog appears; edit instruction is optional → submit empty.
    const submit = getByTestId("flow-author-submit");
    expect(submit).toBeTruthy();
    fireEvent.click(submit);
    expect(onEditFlow).toHaveBeenCalledWith("invoice-research", "");
  });

  it("new flow requires a description before onEditFlow(undefined, text) fires", () => {
    const onEditFlow = vi.fn();
    const { getByTestId, getByText, getByPlaceholderText } = renderActions({ editMode: true, onEditFlow });
    fireEvent.click(getByTestId("flows-new-edit-button"));
    fireEvent.click(getByText("+ New flow"));
    const submit = getByTestId("flow-author-submit") as HTMLButtonElement;
    // Required: disabled until text entered.
    expect(submit.disabled).toBe(true);
    fireEvent.change(getByPlaceholderText(/Research an invoice/), {
      target: { value: "Summarize PRs" },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onEditFlow).toHaveBeenCalledWith(undefined, "Summarize PRs");
  });
});
