/**
 * MarkdownPreviewView renders on-disk content with no file identity: the markup-repair
 * banner shows, but without the apply action. See change: add-md-adoc-markup-repair (F7).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownPreviewView } from "../preview/MarkdownPreviewView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => cleanup());

describe("MarkdownPreviewView — markup repair (F7)", () => {
  it("shows the banner, no apply action (no MermaidSourceContext)", () => {
    const { container } = render(
      <ThemeProvider>
        <MarkdownPreviewView content={"```sh\necho\n\n# Heading\nbody\n"} onBack={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("markup-repair-banner").textContent).toMatch(/line 1/);
    expect(container.querySelector('[data-testid="markup-repair-apply"]')).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
  });
});
