/**
 * Tests for the shared InlineMessage primitive (change: redesign-directory-card,
 * inline-message-log-primitives spec). A severity-styled inline surface —
 * accent bar + icon + title + optional sub/body + optional action pills +
 * optional mdiClose dismiss. Colors resolve exclusively from `--severity-*`
 * tokens (never raw `red-500`/`amber-500`). Supports a `compact` one-line
 * variant and an `animate` top accent-bar sweep.
 */
import { mdiAlert } from "@mdi/js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineMessage } from "../InlineMessage.js";

afterEach(() => cleanup());

describe("InlineMessage", () => {
  it("resolves severity colors from --severity-* tokens, never raw literals", () => {
    for (const severity of ["error", "warning", "info"] as const) {
      const { getByTestId, unmount } = render(
        <InlineMessage severity={severity} icon={mdiAlert} title="hi" />,
      );
      const el = getByTestId("inline-message");
      const html = el.outerHTML;
      expect(html).toContain(`--severity-${severity}-bg`);
      expect(html).toContain(`--severity-${severity}-border`);
      expect(html).toContain(`--severity-${severity}-fg`);
      // No raw Tailwind color literals anywhere on the surface.
      expect(html).not.toMatch(/\bred-500\b/);
      expect(html).not.toMatch(/\bamber-500\b/);
      unmount();
    }
  });

  it("renders a severity accent bar", () => {
    const { getByTestId } = render(
      <InlineMessage severity="error" icon={mdiAlert} title="boom" />,
    );
    expect(getByTestId("inline-message-accent")).toBeTruthy();
  });

  it("compact variant renders title + action on one line (no separate body block)", () => {
    const { getByTestId, queryByTestId } = render(
      <InlineMessage
        severity="warning"
        icon={mdiAlert}
        title="rg not found"
        variant="compact"
        actions={<button type="button">Install</button>}
      />,
    );
    expect(getByTestId("inline-message")).toBeTruthy();
    // Compact has no dedicated body/sub region.
    expect(queryByTestId("inline-message-body")).toBeNull();
  });

  it("renders sub/body content and an action row in the default variant", () => {
    const { getByTestId, getByText } = render(
      <InlineMessage
        severity="error"
        icon={mdiAlert}
        title="Pi exited"
        actions={<button type="button">View log</button>}
      >
        <span>spawn pi ENOENT</span>
      </InlineMessage>,
    );
    expect(getByTestId("inline-message-body").textContent).toContain("spawn pi ENOENT");
    expect(getByText("View log")).toBeTruthy();
  });

  it("animate mode renders the top accent-bar sweep", () => {
    const { getByTestId } = render(
      <InlineMessage severity="error" icon={mdiAlert} title="retrying" animate />,
    );
    expect(getByTestId("inline-message-sweep")).toBeTruthy();
  });

  it("dismiss fires ONLY onDismiss (no other side effect)", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <InlineMessage severity="error" icon={mdiAlert} title="boom" onDismiss={onDismiss} />,
    );
    fireEvent.click(getByTestId("inline-message-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("omits the dismiss control when onDismiss is not provided", () => {
    const { queryByTestId } = render(
      <InlineMessage severity="info" icon={mdiAlert} title="fyi" />,
    );
    expect(queryByTestId("inline-message-dismiss")).toBeNull();
  });
});
