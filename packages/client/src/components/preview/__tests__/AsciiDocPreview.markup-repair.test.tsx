/**
 * AsciiDoc preview markup-repair banner + lazy "view original rendering".
 * See change: add-md-adoc-markup-repair (test-plan F6).
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../MermaidBlock.js", () => ({ MermaidBlock: () => <div data-testid="mmd-block" /> }));

import { AsciiDocPreview } from "../AsciiDocPreview.js";

const REPAIRED_HTML = '<div class="sect1"><h2>Next</h2></div>';
const ORIGINAL_HTML = '<div class="listingblock"><pre>== Next</pre></div>';

const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

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

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      const original = String(url).includes("repair=0");
      return jsonRes({
        success: true,
        data: {
          html: original ? ORIGINAL_HTML : REPAIRED_HTML,
          repairs: original ? [] : [{ rule: "A2", line: 3 }],
          warnings: [],
          mtime: 7,
        },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AsciiDocPreview markup repair", () => {
  it("F6: banner lists the line; view original fetches repair=0 exactly once and caches", async () => {
    const { container, getByTestId } = render(
      <ThemeProvider>
        <AsciiDocPreview target={{ kind: "file", cwd: "/proj", path: "guide.adoc" }} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId("markup-repair-banner")).toBeTruthy());
    expect(getByTestId("markup-repair-banner").textContent).toMatch(/line 3/);
    expect(container.querySelector("h2")?.textContent).toBe("Next");
    expect(urls).toHaveLength(1);
    // no file identity (not a live-session cwd) → no apply action
    expect(container.querySelector('[data-testid="markup-repair-apply"]')).toBeNull();

    fireEvent.click(getByTestId("markup-repair-view-original")); // on
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("== Next"));
    expect(getByTestId("markup-repair-view-original").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("h2")).toBeNull();
    expect(urls.filter((u) => u.includes("repair=0"))).toHaveLength(1);
    // banner is still there while viewing the original, still listing the repair
    expect(getByTestId("markup-repair-banner").textContent).toMatch(/line 3/);

    fireEvent.click(getByTestId("markup-repair-view-original")); // off
    await waitFor(() => expect(container.querySelector("h2")?.textContent).toBe("Next"));
    fireEvent.click(getByTestId("markup-repair-view-original")); // on again → cached
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("== Next"));
    expect(urls.filter((u) => u.includes("repair=0"))).toHaveLength(1);
  });
});
