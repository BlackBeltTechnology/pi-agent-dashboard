/**
 * Tests for the shared LogBlock primitive (change: redesign-directory-card,
 * inline-message-log-primitives spec). One monospace inset panel with a
 * labelled header, a copy control (always copies the FULL text), and — when
 * `collapsible` — a collapse/expand toggle. A `preview` mode shows only the
 * last N lines while copy still yields the full log.
 */
import { mdiContentCopy } from "@mdi/js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogBlock } from "../LogBlock.js";

afterEach(() => cleanup());

const FULL = ["line-1", "line-2", "line-3", "line-4", "line-5"].join("\n");

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

describe("LogBlock", () => {
  it("renders the label and the monospace body text", () => {
    const { getByTestId } = render(<LogBlock label="Pi stderr" text={FULL} />);
    expect(getByTestId("log-block").textContent).toContain("Pi stderr");
    const body = getByTestId("log-block-body");
    expect(body.textContent).toContain("line-1");
    expect(body.className).toMatch(/font-mono/);
  });

  it("renders nothing for empty / whitespace-only text", () => {
    const { container } = render(<LogBlock label="Pi stderr" text={"   \n  "} />);
    expect(container.firstChild).toBeNull();
  });

  it("is closed by default when collapsible and expands on toggle", () => {
    const { getByTestId, queryByTestId } = render(
      <LogBlock label="Pi stderr" text={FULL} collapsible />,
    );
    // Closed: no body rendered.
    expect(queryByTestId("log-block-body")).toBeNull();
    fireEvent.click(getByTestId("log-block-toggle"));
    expect(getByTestId("log-block-body").textContent).toContain("line-1");
  });

  it("preview mode shows only the last N lines but the header is present", () => {
    const { getByTestId } = render(
      <LogBlock label="Program log" text={FULL} preview previewLines={3} />,
    );
    const body = getByTestId("log-block-body");
    // Last 3 lines visible; the earlier ones are not.
    expect(body.textContent).toContain("line-5");
    expect(body.textContent).toContain("line-3");
    expect(body.textContent).not.toContain("line-1");
    expect(body.textContent).not.toContain("line-2");
  });

  it("copy writes the FULL text even in preview mode", async () => {
    const writeText = mockClipboard();
    const { getByTestId } = render(
      <LogBlock label="Program log" text={FULL} preview previewLines={2} />,
    );
    fireEvent.click(getByTestId("log-block-copy"));
    expect(writeText).toHaveBeenCalledWith(FULL);
  });

  it("copy writes the FULL text even when collapsed", async () => {
    const writeText = mockClipboard();
    const { getByTestId } = render(<LogBlock label="Pi stderr" text={FULL} collapsible />);
    // Still collapsed (body absent) — copy must yield the whole log.
    fireEvent.click(getByTestId("log-block-copy"));
    expect(writeText).toHaveBeenCalledWith(FULL);
  });

  it("accepts a custom copy icon without breaking copy", () => {
    const writeText = mockClipboard();
    const { getByTestId } = render(
      <LogBlock label="Pi stderr" text={FULL} copyIcon={mdiContentCopy} />,
    );
    fireEvent.click(getByTestId("log-block-copy"));
    expect(writeText).toHaveBeenCalledWith(FULL);
  });
});
