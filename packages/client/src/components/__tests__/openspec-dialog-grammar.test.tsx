/**
 * Grammar-panel wiring in the OpenSpec prose dialogs. The grammar plugin's
 * `composer-panel` slot is mounted over the Explore textarea and the New Change
 * description textarea, but NOT the Propose single-line name input.
 * See change: grammar-llm-only-with-explore (test-plan #F1/#F2/#F3/#X3).
 *
 * `ComposerPanelSlot` is mocked to a probe that records the props it receives
 * and exposes an "apply" button, so the tests assert the draft/onApplyText
 * wiring without standing up the real plugin registry.
 */
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";

const { slotProps } = vi.hoisted(() => ({ slotProps: [] as Array<Record<string, unknown>> }));

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    ComposerPanelSlot: (props: {
      draft: string;
      sessionId?: string;
      onApplyText: (t: string) => void;
    }) => {
      slotProps.push(props);
      return (
        <button
          type="button"
          data-testid="grammar-slot-apply"
          onClick={() => props.onApplyText("CORRECTED")}
        >
          slot draft={props.draft}
        </button>
      );
    },
  };
});

// Imported AFTER the mock is registered.
const { ExploreDialog } = await import("../openspec/ExploreDialog.js");
const { NewChangeDialog } = await import("../openspec/NewChangeDialog.js");
const { ProposeDialog } = await import("../openspec/ProposeDialog.js");

const render = (ui: React.ReactElement) =>
  rtlRender(<RunConfigHarness value={makeRunConfig()}>{ui}</RunConfigHarness>);

afterEach(() => {
  cleanup();
  slotProps.length = 0;
});

describe("Explore dialog grammar wiring (#F1)", () => {
  it("mounts the slot over the prose draft and applies only to the textarea (no send)", () => {
    const onSend = vi.fn();
    render(<ExploreDialog changeName="c1" onSend={onSend} onClose={vi.fn()} />);

    const textarea = screen.getByTestId("explore-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "teh cat" } });

    // The slot receives the live draft and NO sessionId (behaves like the composer).
    const last = slotProps.at(-1)!;
    expect(last.draft).toBe("teh cat");
    expect(last.sessionId).toBeUndefined();

    // Applying a correction rewrites the textarea, and does not send the prompt.
    fireEvent.click(screen.getByTestId("grammar-slot-apply"));
    expect(textarea.value).toBe("CORRECTED");
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("New Change dialog grammar wiring (#F2)", () => {
  it("binds the slot to the description, not the name input", () => {
    render(<NewChangeDialog onSend={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId("new-change-name"), { target: { value: "add-auth" } });
    fireEvent.change(screen.getByTestId("new-change-description"), {
      target: { value: "improive the flow" },
    });

    const last = slotProps.at(-1)!;
    // Draft tracks the DESCRIPTION, never the name.
    expect(last.draft).toBe("improive the flow");
    expect(last.draft).not.toContain("add-auth");

    // Applying rewrites the description textarea.
    fireEvent.click(screen.getByTestId("grammar-slot-apply"));
    expect((screen.getByTestId("new-change-description") as HTMLTextAreaElement).value).toBe(
      "CORRECTED",
    );
    expect((screen.getByTestId("new-change-name") as HTMLInputElement).value).toBe("add-auth");
  });
});

describe("Propose dialog is not grammar-checked (#F3)", () => {
  it("mounts no composer-panel slot", () => {
    render(<ProposeDialog onSend={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId("grammar-slot-apply")).toBeNull();
    expect(slotProps).toHaveLength(0);
  });
});

describe("Enabled-but-no-model surfaces the composer path in dialogs (#X3)", () => {
  it("mounts the slot with no sessionId so it behaves exactly like the chat composer", () => {
    render(<ExploreDialog changeName="c1" onSend={vi.fn()} onClose={vi.fn()} />);
    // No sessionId → the slot's grammar hook takes the same code path as the
    // composer (health + check surface backend_unconfigured when no model is set).
    expect(slotProps.at(-1)!.sessionId).toBeUndefined();
  });
});
