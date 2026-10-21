/**
 * SessionFlowMenuClaim edit-mode gating + New/Edit launcher.
 * The New/Edit action shows only when editMode is on. Selecting a flow (or
 * "+ New flow") opens an intent-capture dialog; submitting it makes the claim
 * send `/skill:manage-flows ...`. See change: rework-flows-plugin-for-new-pi-flows,
 * add-session-actions-flyout.
 */

import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer, initPluginConfigs, PluginContextProvider, publishSessionData } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionFlowMenuClaim } from "../client/SessionFlowMenuClaim.js";

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

let n = 0;
function renderActions({ editMode, send = () => {} }: { editMode: boolean; send?: (m: unknown) => void }) {
  const sid = `edit-S-${++n}`;
  publishSessionData(sid, "commandsList", [{ name: "flows" }]);
  publishSessionData(sid, "flowsList", flows);
  initPluginConfigs({ flows: { editFlow: editMode } });
  return {
    sid,
    ...render(
      <PluginContextProvider send={send}>
        <UiPrimitiveProvider value={registry}>
          <CurrentPluginLayer pluginId="flows">
            <SessionFlowMenuClaim session={{ id: sid } as DashboardSession} />
          </CurrentPluginLayer>
        </UiPrimitiveProvider>
      </PluginContextProvider>,
    ),
  };
}
const editButton = () => screen.queryByRole("button", { name: /New \/ Edit/ });
const promptsSent = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([m]) => m as { type: string; text?: string }).filter((m) => m.type === "send_prompt");

afterEach(() => cleanup());

describe("SessionFlowMenuClaim edit mode", () => {
  it("hides New / Edit when edit mode is off", () => {
    renderActions({ editMode: false });
    expect(editButton()).toBeNull();
  });

  it("shows New / Edit when edit mode is on", () => {
    renderActions({ editMode: true });
    expect(editButton()).toBeTruthy();
  });

  it("editing a flow prompts for an instruction, then sends /skill:manage-flows <name>", () => {
    const send = vi.fn();
    const { sid, getByTestId, getByText } = renderActions({ editMode: true, send });
    fireEvent.click(editButton()!);
    fireEvent.click(getByText("invoice-research"));
    // Intent dialog appears; edit instruction is optional → submit empty.
    const submit = getByTestId("flow-author-submit");
    expect(submit).toBeTruthy();
    fireEvent.click(submit);
    expect(promptsSent(send)).toEqual([{ type: "send_prompt", sessionId: sid, text: "/skill:manage-flows invoice-research" }]);
  });

  it("new flow requires a description before /skill:manage-flows <text> is sent", () => {
    const send = vi.fn();
    const { sid, getByTestId, getByText, getByPlaceholderText } = renderActions({ editMode: true, send });
    fireEvent.click(editButton()!);
    fireEvent.click(getByText("+ New flow"));
    const submit = getByTestId("flow-author-submit") as HTMLButtonElement;
    // Required: disabled until text entered.
    expect(submit.disabled).toBe(true);
    fireEvent.change(getByPlaceholderText(/Research an invoice/), {
      target: { value: "Summarize PRs" },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(promptsSent(send)).toEqual([{ type: "send_prompt", sessionId: sid, text: "/skill:manage-flows Summarize PRs" }]);
  });
});
