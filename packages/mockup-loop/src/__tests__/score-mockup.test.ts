/**
 * L1 — score_mockup when `playwright` cannot be resolved: install guidance + rubric, no throw.
 * Own file: the module mock applies to the whole file.
 * See change: add-mock-site-exact-env (test-plan X8).
 */
import { describe, expect, it, vi } from "vitest";
import frontendMockupLoop from "../extension.js";

vi.mock("playwright", () => { throw new Error("Cannot find module 'playwright'"); });

describe("score_mockup without Playwright (X8)", () => {
  it("returns install guidance and the rubric instead of throwing", async () => {
    const tools = new Map<string, { execute: (id: string, p: unknown) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }> }>();
    frontendMockupLoop({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), registerCommand() {}, on() {} } as never);
    const r = await tools.get("score_mockup")!.execute("t", { url: "http://localhost:1/" });
    expect(r.details).toMatchObject({ playwright: false, widths: [375, 768, 1440] });
    expect(r.content[0].text).toContain("npx playwright install chromium");
    expect(r.content[0].text).toContain("SCORING RUBRIC");
    expect(r.content[0].text).not.toMatch(/canvas\(|dashboard/i);
  });
});
