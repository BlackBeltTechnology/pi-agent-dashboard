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

/**
 * #F4 (repair-tool-error-surfaces) — the non-zero `exit N` badge is a single-line
 * error surface: it takes the severity accent directly. The success branch is a
 * separate tier and deliberately out of scope, so it is pinned unchanged here.
 */
describe("BashOutputCard exit badge — severity tokens", () => {
  afterEach(cleanup);

  const badgeFor = (exitCode: number) => {
    const { getByText } = render(
      <BashOutputCard command="false" output="" exitCode={exitCode} excludeFromContext={false} />,
    );
    return getByText(`exit ${exitCode}`) as HTMLElement;
  };

  it("#F4 a non-zero exit badge resolves its colour from --severity-error-*", () => {
    const badge = badgeFor(3);
    expect(badge.className).toContain("bg-[var(--severity-error-bg)]");
    expect(badge.className).toContain("text-[var(--severity-error-fg)]");
    expect(badge.className).not.toMatch(/\bred-\d{2,3}\b/);
  });

  it("leaves the success branch on its own tier, untouched by this change", () => {
    expect(badgeFor(0).className).toContain("text-green-400");
  });
});
