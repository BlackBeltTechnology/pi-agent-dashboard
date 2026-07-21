/**
 * See change: render-skill-invocations-collapsibly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { SkillInvocationCard } from "../chat/SkillInvocationCard.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { SkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

beforeAll(() => {
  // jsdom doesn't implement matchMedia (needed by ThemeProvider).
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

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const RAW_CONTENT =
  `<skill name="openspec-explore" location="/abs/path/SKILL.md">\nReferences are relative to /abs/path.\n\nFirst body line\nSecond body line\n</skill>\n\ncontinue with X`;

const SKILL: SkillBlock = {
  name: "openspec-explore",
  location: "/abs/path/SKILL.md",
  body: "First body line\nSecond body line",
  args: "continue with X",
  condensed: "/skill:openspec-explore continue with X",
};

const SKILL_NO_ARGS: SkillBlock = {
  name: "openspec-explore",
  location: "/abs/path/SKILL.md",
  body: "First body line",
  args: undefined,
  condensed: "/skill:openspec-explore",
};

// Stub the clipboard API for jsdom (CopyButton calls navigator.clipboard.writeText).
beforeEach(() => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

describe("SkillInvocationCard", () => {
  it("renders the full /skill:name args slash form in the header", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    expect(container.textContent).toContain("/skill:openspec-explore continue with X");
  });

  it("renders the bare /skill:name when args is undefined", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL_NO_ARGS} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    expect(container.textContent).toContain("/skill:openspec-explore");
    // The display block for args (the "args" label section) is not visible when collapsed,
    // and would still not appear when expanded if args is undefined — see expand test below.
  });

  it("is collapsed by default — body text is not in the document", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    expect(container.textContent).not.toContain("First body line");
    expect(container.textContent).not.toContain("Second body line");
  });

  it("clicking the header expands the body", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const headerBtn = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(headerBtn.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      fireEvent.click(headerBtn);
    });
    expect(headerBtn.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("First body line");
    expect(container.textContent).toContain("Second body line");
  });

  it("expanded view shows args section when args is set", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const headerBtn = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    act(() => {
      fireEvent.click(headerBtn);
    });
    // The "args" label appears in the expanded section
    const expanded = container.textContent || "";
    expect(expanded.toLowerCase()).toContain("args");
    expect(expanded).toContain("continue with X");
  });

  it("expanded view does NOT show args section when args is undefined", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL_NO_ARGS} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const headerBtn = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    act(() => {
      fireEvent.click(headerBtn);
    });
    // First body line shows up; "args" label section should not.
    const allText = container.textContent || "";
    expect(allText).toContain("First body line");
    // Match "args" as the standalone label (the uppercase tracking-wider element)
    const argsLabels = Array.from(container.querySelectorAll("div"))
      .map((d) => d.textContent?.trim())
      .filter((t) => t === "args" || t === "ARGS");
    expect(argsLabels.length).toBe(0);
  });

  it("renders four copy buttons when args is set", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const copyMd = container.querySelector('[title="Copy as Markdown"]');
    const copyPlain = container.querySelector('[title="Copy as plain text"]');
    const copyCmd = container.querySelector('[title="Copy as /skill: command"]');
    const copyMsg = container.querySelector('[title="Copy as message"]');
    expect(copyMd).not.toBeNull();
    expect(copyPlain).not.toBeNull();
    expect(copyCmd).not.toBeNull();
    expect(copyMsg).not.toBeNull();
  });

  it("hides the Copy as message button when args is undefined", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL_NO_ARGS} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    expect(container.querySelector('[title="Copy as message"]')).toBeNull();
    // Other three still present
    expect(container.querySelector('[title="Copy as Markdown"]')).not.toBeNull();
    expect(container.querySelector('[title="Copy as plain text"]')).not.toBeNull();
    expect(container.querySelector('[title="Copy as /skill: command"]')).not.toBeNull();
  });

  it('"Copy as /skill: command" button copies the condensed slash form', async () => {
    const writeText = (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>);
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const copyCmd = container.querySelector('[title="Copy as /skill: command"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyCmd);
    });
    expect(writeText).toHaveBeenCalledWith("/skill:openspec-explore continue with X");
  });

  it('"Copy as message" button copies skill.args verbatim', async () => {
    const writeText = (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>);
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const copyMsg = container.querySelector('[title="Copy as message"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyMsg);
    });
    expect(writeText).toHaveBeenCalledWith("continue with X");
  });

  it('"Copy as message" preserves multi-line args', async () => {
    const writeText = (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>);
    const multilineSkill: SkillBlock = {
      ...SKILL,
      args: "line one\nline two\nline three",
      condensed: "/skill:openspec-explore line one\nline two\nline three",
    };
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={multilineSkill} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const copyMsg = container.querySelector('[title="Copy as message"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyMsg);
    });
    expect(writeText).toHaveBeenCalledWith("line one\nline two\nline three");
  });

  it("only the chevron button toggles expansion (header text is not a button)", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    // The condensed slash text is in a plain <span>, not a button.
    const allButtons = Array.from(container.querySelectorAll("button"));
    // The only button with aria-expanded is the chevron toggle.
    const togglers = allButtons.filter((b) => b.hasAttribute("aria-expanded"));
    expect(togglers.length).toBe(1);
    // Toggling button SHOULD NOT contain the condensed slash text — only the icon.
    const toggler = togglers[0];
    expect(toggler.textContent || "").not.toContain("/skill:openspec-explore");
    // Click the chevron to expand
    act(() => {
      fireEvent.click(toggler);
    });
    expect(toggler.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("First body line");
  });

  it('"Copy as Markdown" button copies the raw <skill> wrapper content', async () => {
    const writeText = (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>);
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const copyMd = container.querySelector('[title="Copy as Markdown"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyMd);
    });
    expect(writeText).toHaveBeenCalledWith(RAW_CONTENT);
  });

  it("fork button only renders when entryId AND onFork are provided", () => {
    const onFork = vi.fn();
    const r1 = renderWithTheme(<SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />);
    expect(r1.container.querySelector('[title="Fork from here"]')).toBeNull();

    const r2 = renderWithTheme(
      <SkillInvocationCard
        skill={SKILL}
        rawContent={RAW_CONTENT}
        timestamp={1}
        entryId="entry-1"
        onFork={onFork}
      />,
    );
    const forkBtn = r2.container.querySelector('[title="Fork from here"]') as HTMLButtonElement;
    expect(forkBtn).not.toBeNull();
    fireEvent.click(forkBtn);
    expect(onFork).toHaveBeenCalledWith("entry-1");
  });

  it("uses the purple-tinted styling distinct from regular user bubble", () => {
    const { container } = renderWithTheme(
      <SkillInvocationCard skill={SKILL} rawContent={RAW_CONTENT} timestamp={1} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/purple/);
    // sanity: not blue (the user bubble uses border-l-blue-400)
    expect(root.className).not.toMatch(/border-l-blue/);
  });
});
