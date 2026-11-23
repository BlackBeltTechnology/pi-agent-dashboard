/**
 * Provider scope: only the dashboard transcript pre-confirms links (change: rich-chat-links, test-plan #F5;
 * design D1). Pattern: ChatView.copy-fidelity.test.tsx.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const toolContext: ToolContext = { cwd: "/repo", sessionId: "S" };
let batchBodies: { cwd: string; items: { mention: string }[] }[] = [];

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});
beforeEach(() => {
  batchBodies = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const reply = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(input).endsWith("/api/file/resolve-mentions")) {
      const body = JSON.parse(String(init?.body));
      batchBodies.push(body);
      return reply({ results: body.items.map(() => ({ state: "missing" })) });
    }
    if (String(input).endsWith("/api/file/resolve-mention")) return reply({ resolved: "/repo/docs/README.md", kind: "relative" });
    return reply({ type: "file", content: "# Doc\n\nsee `src/inner.ts` in the overlay" });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function transcript(transcriptLinks: boolean) {
  const state = createInitialState();
  state.messages.push({ id: "a1", role: "assistant", content: "see `src/foo.ts` for details", timestamp: Date.now() });
  return render(
    <ThemeProvider>
      <ChatView state={state} toolContext={toolContext} transcriptLinks={transcriptLinks} />
    </ThemeProvider>,
  );
}

describe("ChatView — transcriptLinks scope (F5)", () => {
  it("with the prop: file links get a state, an icon slot and ONE batch request", async () => {
    const { container } = transcript(true);
    const link = container.querySelector("button[data-link-state]");
    expect(link).toBeTruthy();
    expect(link?.querySelector("[data-link-icon]")).toBeTruthy();
    await waitFor(() => expect(batchBodies).toHaveLength(1), { timeout: 3000 });
    expect(batchBodies[0]).toMatchObject({ cwd: "/repo", items: [{ mention: "src/foo.ts" }] });
    await waitFor(() => expect(container.querySelector("button[data-link-state='missing']")).toBeTruthy());
  });

  it("streaming text is never pre-confirmed, even in view", async () => {
    const state = createInitialState();
    state.streamingText = "working on `src/live.ts` now";
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={toolContext} transcriptLinks />
      </ThemeProvider>,
    );
    expect(container.querySelector("button[data-link-state]")).toBeTruthy(); // linkified + icon slot…
    await new Promise((r) => setTimeout(r, 1400));
    expect(batchBodies).toHaveLength(0); // …but not requested while it can still change
  });

  it("the preview overlay (FilePreviewHost) stays outside the provider: its content renders pre-change and requests nothing", async () => {
    const state = createInitialState();
    state.messages.push({ id: "a1", role: "assistant", content: "open `docs/README.md`", timestamp: Date.now() });
    // No sessionId: a click routes to the hoisted preview overlay instead of the editor pane.
    const { container, findByTestId } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={{ cwd: "/repo" }} transcriptLinks />
      </ThemeProvider>,
    );
    fireEvent.click(container.querySelector("button[data-link-state]") as Element);
    const overlay = await findByTestId("file-preview-overlay");
    await waitFor(() => expect(overlay.textContent).toContain("src/inner.ts"));
    expect(overlay.querySelector("[data-link-state], [data-link-icon]")).toBeNull();
    await new Promise((r) => setTimeout(r, 1400));
    expect(batchBodies).toHaveLength(0);
  });

  it("without the prop: no request and the pre-change DOM (no icon, no state attribute)", async () => {
    const { container } = transcript(false);
    const link = container.querySelector("button");
    expect(link?.textContent).toBe("src/foo.ts");
    expect(link?.hasAttribute("data-link-state")).toBe(false);
    expect(link?.querySelector("[data-link-icon]")).toBeNull();
    await new Promise((r) => setTimeout(r, 1400));
    expect(batchBodies).toHaveLength(0);
  });

  it("only the dashboard App opts in; the plugin ui:chat-view primitive does not", () => {
    const src = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
    expect(src("../../App.tsx")).toMatch(/<ChatView[^>]*\btranscriptLinks\b/);
    expect(src("../../lib/plugins/chat-view-primitive.tsx")).not.toContain("transcriptLinks");
  });
});
