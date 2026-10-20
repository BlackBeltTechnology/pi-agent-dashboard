/**
 * ToolApprovalCard — supervised tool approval (test-plan #E18, #E39, #E42 + card behaviour).
 * The card renders directly (card behaviour); the `SelectRenderer` branch (lazy, Suspense) has its own test.
 * See change: add-supervised-tool-approval.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectRenderer } from "../interactive-renderers/SelectRenderer.js";
import { ToolApprovalCard } from "../interactive-renderers/ToolApprovalCard.js";
import type { InteractiveRendererProps } from "../interactive-renderers/types.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const NOW = 1_800_000_000_000;

beforeAll(() => {
  // MarkdownContent (path-gate message) reads the theme.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bash = {
  title: "Run this command?",
  options: ["Allow once", "Deny"],
  allowOther: true,
  kind: "supervised-tool-approval",
  tool: "bash",
  command: "echo hi",
  cwd: "/repo",
  summary: "bash: echo hi",
  deadline: NOW + 120_000,
  toolCallId: "tc-1",
};

function setup(over: Partial<InteractiveRendererProps> & { params?: Record<string, unknown> } = {}) {
  const onRespond = vi.fn();
  const onCancel = vi.fn();
  const { params, ...rest } = over;
  const utils = render(
    <ToolApprovalCard
      requestId="p1"
      method="select"
      status="pending"
      onRespond={onRespond}
      onCancel={onCancel}
      {...rest}
      params={{ ...bash, ...(params ?? {}) }}
    />,
  );
  return { onRespond, onCancel, ...utils };
}

describe("SelectRenderer branch", () => {
  it("renders the (lazy) card only for kind supervised-tool-approval; a plain select is untouched", async () => {
    vi.useRealTimers(); // Suspense resolution needs real timers
    const props = { method: "select" as const, status: "pending" as const, onRespond: vi.fn(), onCancel: vi.fn() };
    const a = render(<SelectRenderer requestId="p1" {...props} params={{ ...bash, deadline: Date.now() + 120_000 }} />);
    expect(await screen.findByTestId("tool-approval-card")).toBeTruthy();
    a.unmount();
    render(<SelectRenderer requestId="p2" {...props} params={{ title: "Pick", options: ["a", "b"] }} />);
    expect(screen.queryByTestId("tool-approval-card")).toBeNull();
    expect(screen.getByText("Pick")).toBeTruthy();
  });
});

describe("pending card content", () => {
  it("bash: verb title, tool chip, command, cwd, countdown; Allow once / Deny / Deny with a reason; NO Cancel", () => {
    setup();
    expect(screen.getByTestId("tool-approval-title").textContent).toBe("Run this command?");
    expect(screen.getByTestId("tool-approval-tool").textContent).toBe("bash");
    expect(screen.getByTestId("tool-approval-command").textContent).toBe("echo hi");
    expect(screen.getByTestId("tool-approval-cwd").textContent).toContain("/repo");
    expect(screen.getByTestId("tool-approval-clock").textContent).toContain("2:00");
    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
    expect(screen.getByText("Deny with a reason…")).toBeTruthy();
    expect(screen.queryByText(/cancel/i)).toBeNull();
  });

  it("falls back to a verb title per tool when the prompt carries none", () => {
    for (const [tool, title] of [
      ["bash", "Run this command?"],
      ["powershell", "Run this command?"],
      ["write", "Create this file?"],
      ["edit", "Edit this file?"],
      ["Agent", "Start a subagent?"],
      ["x_tool", "Allow this tool call?"],
    ] as const) {
      const { unmount } = setup({ params: { title: undefined, tool } });
      expect(screen.getByTestId("tool-approval-title").textContent).toBe(title);
      unmount();
    }
  });

  it("edit: path + +N −M stat; diff collapsed, expand shows the diff, collapse hides it (F9 shape)", () => {
    setup({ params: { tool: "edit", title: "Edit this file?", command: undefined, path: "src/a.ts", diffStat: "+3 −1", diff: "-old\n+new\n+newer" } });
    expect(screen.getByTestId("tool-approval-path").textContent).toBe("src/a.ts");
    expect(screen.getByText("+3").textContent).toBe("+3");
    expect(screen.getByText("−1").textContent).toBe("−1");
    expect(screen.queryByTestId("tool-approval-diff")).toBeNull();
    const toggle = screen.getByTestId("tool-approval-diff-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("tool-approval-diff").textContent).toContain("+newer");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("tool-approval-diff")).toBeNull();
  });

  it("E39: the Agent card states the subagent's own commands and edits are not approved one by one", () => {
    setup({ params: { tool: "Agent", title: "Start a subagent?", command: "Refactor the server" } });
    const note = screen.getByTestId("tool-approval-agent-caveat").textContent ?? "";
    expect(note).toMatch(/subagent's own commands and edits are not approved one by one/i);
    expect(screen.getByTestId("tool-approval-command").textContent).toBe("Refactor the server");
  });

  it("a non-Agent card has no subagent caveat", () => {
    setup();
    expect(screen.queryByTestId("tool-approval-agent-caveat")).toBeNull();
  });

  it("renders agent-controlled text as text, never markup", () => {
    setup({ params: { command: "<img src=x onerror=alert(1)>" } });
    expect(screen.getByTestId("tool-approval-command").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("answers", () => {
  it("Allow once → exactly {value:'Allow once'}; Deny → {value:'Deny'}", () => {
    const a = setup();
    fireEvent.click(screen.getByTestId("tool-approval-approve"));
    expect(a.onRespond).toHaveBeenCalledWith({ value: "Allow once" });
    a.unmount();
    const b = setup();
    fireEvent.click(screen.getByTestId("tool-approval-deny"));
    expect(b.onRespond).toHaveBeenCalledWith({ value: "Deny" });
  });

  it("E18: a reason equal to an option label shows a field error and sends nothing; `nope` is sent", () => {
    const { onRespond } = setup();
    fireEvent.click(screen.getByTestId("tool-approval-deny-reason"));
    const field = screen.getByTestId("tool-approval-reason") as HTMLTextAreaElement;
    for (const label of ["Allow once", "Deny", "  allow once  "]) {
      fireEvent.change(field, { target: { value: label } });
      expect(screen.getByTestId("tool-approval-reason-error")).toBeTruthy();
      expect(field.getAttribute("aria-invalid")).toBe("true");
      fireEvent.click(screen.getByTestId("tool-approval-deny-send"));
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onRespond).not.toHaveBeenCalled();
    }
    fireEvent.change(field, { target: { value: "nope" } });
    expect(screen.queryByTestId("tool-approval-reason-error")).toBeNull();
    fireEvent.click(screen.getByTestId("tool-approval-deny-send"));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ value: "nope" });
  });

  it("an empty / blank reason cannot be sent; Back closes the field without answering", () => {
    const { onRespond } = setup();
    fireEvent.click(screen.getByTestId("tool-approval-deny-reason"));
    const send = screen.getByTestId("tool-approval-deny-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("tool-approval-reason"), { target: { value: "   " } });
    fireEvent.click(send);
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("tool-approval-reason-back"));
    expect(screen.queryByTestId("tool-approval-reason")).toBeNull();
    expect(screen.getByTestId("tool-approval-approve")).toBeTruthy();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason", () => {
    const { onRespond } = setup();
    fireEvent.click(screen.getByTestId("tool-approval-deny-reason"));
    fireEvent.change(screen.getByTestId("tool-approval-reason"), { target: { value: "  use a dry run " } });
    fireEvent.keyDown(screen.getByTestId("tool-approval-reason"), { key: "Enter" });
    expect(onRespond).toHaveBeenCalledWith({ value: "use a dry run" });
  });
});

describe("E42: no preselection, no autofocus", () => {
  it("nothing is checked/selected, focus is outside the card, and Enter on mount sends nothing", () => {
    const { onRespond, onCancel } = setup();
    const card = screen.getByTestId("tool-approval-card");
    expect(card.querySelector('[aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]')).toBeNull();
    expect(card.contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyUp(document.body, { key: "Enter" });
    expect(onRespond).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("opening the reason field is operator-initiated: only then does focus enter the card", () => {
    setup();
    fireEvent.click(screen.getByTestId("tool-approval-deny-reason"));
    expect(document.activeElement).toBe(screen.getByTestId("tool-approval-reason"));
  });
});

describe("countdown (single clock from metadata.deadline)", () => {
  it("ticks down, turns warning at ≤30 s and announces once, never disables the buttons at 0", () => {
    setup({ params: { deadline: NOW + 32_000 } });
    expect(screen.getByTestId("tool-approval-clock").textContent).toContain("0:32");
    expect(screen.getByTestId("tool-approval-announce").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("tool-approval-clock").textContent).toContain("0:29");
    expect(screen.getByTestId("tool-approval-clock").className).toContain("severity-warning");
    expect(screen.getByTestId("tool-approval-announce").textContent).toMatch(/30 seconds/);
    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(screen.getByTestId("tool-approval-clock").textContent).toMatch(/denying/i);
    // Server clock is authoritative: a skewed client keeps the controls until the cancel arrives.
    expect((screen.getByTestId("tool-approval-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("no deadline → no clock, card still answerable", () => {
    setup({ params: { deadline: undefined } });
    expect(screen.queryByTestId("tool-approval-clock")).toBeNull();
    expect(screen.getByTestId("tool-approval-approve")).toBeTruthy();
  });
});

describe("resolved rows — no answerable control remains", () => {
  const noControls = () => {
    expect(screen.queryByTestId("tool-approval-approve")).toBeNull();
    expect(screen.queryByTestId("tool-approval-deny")).toBeNull();
    expect(screen.queryByTestId("tool-approval-deny-reason")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  };

  it("approved → 'Allowed once' naming the Dashboard surface", () => {
    setup({ status: "resolved", result: { value: "Allow once" } });
    const row = screen.getByTestId("tool-approval-resolved");
    expect(row.getAttribute("data-outcome")).toBe("approved");
    expect(row.textContent).toContain("Allowed once");
    expect(screen.getByTestId("tool-approval-surface").textContent).toBe("Dashboard");
    expect(row.textContent).toContain("echo hi");
    noControls();
  });

  it("denied (plain) and denied with the reason sent", () => {
    const a = setup({ status: "resolved", result: { value: "Deny" } });
    expect(screen.getByTestId("tool-approval-resolved").getAttribute("data-outcome")).toBe("denied");
    expect(screen.getByTestId("tool-approval-resolved").textContent).not.toContain("Reason sent");
    a.unmount();
    setup({ status: "resolved", result: { value: "use a dry run" } });
    expect(screen.getByTestId("tool-approval-resolved").textContent).toContain("Reason sent:");
    expect(screen.getByTestId("tool-approval-resolved").textContent).toContain("use a dry run");
    noControls();
  });

  it("dismissed before the deadline → closed without an answer (terminal / other surface)", () => {
    setup({ status: "dismissed" });
    const row = screen.getByTestId("tool-approval-resolved");
    expect(row.getAttribute("data-outcome")).toBe("dismissed");
    expect(screen.getByTestId("tool-approval-surface").textContent).toMatch(/terminal/i);
    noControls();
  });

  it("dismissed/cancelled at the deadline → timeout; no surface claimed", () => {
    vi.setSystemTime(NOW + 120_500);
    setup({ status: "dismissed" });
    expect(screen.getByTestId("tool-approval-resolved").getAttribute("data-outcome")).toBe("timeout");
    expect(screen.queryByTestId("tool-approval-surface")).toBeNull();
    noControls();
  });

  it("status cancelled is also a closed row", () => {
    setup({ status: "cancelled" });
    expect(screen.getByTestId("tool-approval-resolved")).toBeTruthy();
    noControls();
  });
});

describe("enriched agent-path-gate prompt (D14) stays on the plain select card", () => {
  it("renders the supervised stat + fenced diff carried in `message`, with its own option rows", () => {
    render(
      <ThemeProvider>
      <SelectRenderer
        requestId="pg"
        method="select"
        status="pending"
        onRespond={vi.fn()}
        onCancel={vi.fn()}
        params={{
          title: "Agent wants to edit outside its workspace",
          message: "Tool `edit`\n\nChange: +1 −1\n\n```diff\n-  \"telemetry\": true,\n+  \"telemetry\": false,\n```",
          options: ["Allow once", "Deny"],
          kind: "agent-path-gate",
        }}
      />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId("tool-approval-card")).toBeNull();
    expect(screen.getByText(/Change: \+1 −1/)).toBeTruthy();
    expect(document.body.textContent).toContain('+  "telemetry": false,');
    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
  });
});
