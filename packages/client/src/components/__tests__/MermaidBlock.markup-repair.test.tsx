/**
 * Per-diagram "Apply fix to file" waits for the document's markup repair to be applied.
 * See change: add-md-adoc-markup-repair (test-plan F10).
 */
import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MermaidSourceInfo } from "../../lib/preview/mermaid-source-context.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
const mockRender = vi.fn();
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: mockRender } }));

import { MarkdownContent } from "../preview/MarkdownContent.js";
import { _outcomeCache } from "../preview/MermaidBlock.js";

const REPAIRABLE = "graph TD\nA -->|(x)| B"; // rule R4 → auto-fixed badge
const SVG = '<svg viewBox="0 0 1000 400"><text>fixed</text></svg>';
const MERMAID = `\`\`\`mermaid\n${REPAIRABLE}\n\`\`\`\n\n`;
// An unterminated sh fence after the diagram → M3 markup repair.
const WITH_MARKUP_REPAIR = `${MERMAID}\`\`\`sh\necho\n\n# Heading\n`;
const CLEAN = `${MERMAID}\`\`\`sh\necho\n\`\`\`\n\n# Heading\n`;

const src: MermaidSourceInfo = { cwd: "/proj", path: "a.md", kind: "md", reload: () => {} };
const mount = (content: string) =>
  render(
    <ThemeProvider>
      <MarkdownContent content={content} mermaidSource={src} staticSource />
    </ThemeProvider>,
  );

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  _outcomeCache.clear();
  localStorage.clear();
  __resetEscapeStack();
  mockRender.mockImplementation(async (_id: string, code: string) => {
    if (code === REPAIRABLE) throw new Error("E1");
    return { svg: SVG };
  });
});
afterEach(cleanup);

describe("F10 per-diagram apply vs markup repair", () => {
  it("is disabled with an explanation while a markup repair is displayed, enabled once the document is clean", async () => {
    const first = mount(WITH_MARKUP_REPAIR);
    await waitFor(() => expect(screen.getByTestId("mermaid-repair-badge")).toBeTruthy(), { timeout: 8000 });
    const btn = screen.getByTestId("mermaid-apply-fix-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("mermaid-apply-fix").textContent).toMatch(/apply the markup fix first/i);
    first.unmount();

    // After "apply + reload" the file content no longer needs repair.
    mount(CLEAN);
    await waitFor(() => expect(screen.getByTestId("mermaid-repair-badge")).toBeTruthy(), { timeout: 8000 });
    expect((screen.getByTestId("mermaid-apply-fix-button") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("markup-repair-banner")).toBeNull();
  });
});
