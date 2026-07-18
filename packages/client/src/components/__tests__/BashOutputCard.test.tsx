/**
 * Tests for BashOutputCard's "ran locally — LLM not invoked" footer.
 * The footer renders only for executable-mode slash templates
 * (source === "slash-exec"); `!` / `!!` output shows no footer.
 *
 * See change: add-dashboard-slash-commands.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BashOutputCard } from "../chat/BashOutputCard.js";

describe("BashOutputCard footer", () => {
  afterEach(cleanup);

  it("renders the 'ran locally' footer for source slash-exec", () => {
    const { getByText } = render(
      <BashOutputCard command="curl health" output="ok" exitCode={0} excludeFromContext source="slash-exec" />,
    );
    expect(getByText(/ran locally — LLM not invoked/)).toBeTruthy();
  });

  it("does not render the footer for a `!` command (no source)", () => {
    const { queryByText } = render(
      <BashOutputCard command="ls" output="file.txt" exitCode={0} excludeFromContext={false} />,
    );
    expect(queryByText(/ran locally/)).toBeNull();
  });

  it("does not render the footer for a `!!` command (no source)", () => {
    const { queryByText } = render(
      <BashOutputCard command="ls" output="file.txt" exitCode={0} excludeFromContext />,
    );
    expect(queryByText(/ran locally/)).toBeNull();
  });
});
