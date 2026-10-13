/**
 * L1 — the web-access `custom-entry-renderer` component (change:
 * render-unclaimed-custom-entries; test-plan F9–F15, X3, X4).
 */
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSearchEntryCard } from "../WebSearchEntryCard.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const searchBody = JSON.stringify(
  {
    id: "x",
    type: "search",
    queries: [
      { query: "a", results: [{}, {}, {}, {}, {}] },
      { query: "b", results: [{}, {}, {}] },
    ],
  },
  null,
  2,
);

function props(overrides: Partial<CustomEntryRendererProps> = {}): CustomEntryRendererProps {
  return {
    customType: "web-search-results",
    body: searchBody,
    timestamp: 1756300000000,
    entryId: "e1",
    expanded: false,
    onToggle: () => {},
    payloadLoading: false,
    ...overrides,
  };
}

const res = (title: string, url: string, snippet = "") => ({ title, url, snippet });

describe("WebSearchEntryCard — collapsed", () => {
  it("F9: 50 collapsed rows render summaries with zero fetches", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fetchPayload = vi.fn();
    render(
      <div>
        {Array.from({ length: 50 }, (_, i) => (
          <WebSearchEntryCard key={i} {...props({ entryId: `e${i}`, ...({ fetchPayload } as object) })} />
        ))}
      </div>,
    );
    const summaries = screen.getAllByTestId("web-search-summary");
    expect(summaries).toHaveLength(50);
    for (const s of summaries) expect(s.textContent).toBe("2 queries · 8 results");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchPayload).not.toHaveBeenCalled();
  });

  it("collapsed fetch row shows the URL count", () => {
    render(<WebSearchEntryCard {...props({ body: JSON.stringify({ type: "fetch", urlMetadata: [{}, {}, {}, {}] }) })} />);
    expect(screen.getByTestId("web-search-summary").textContent).toBe("4 URLs");
    expect(screen.getByTestId("web-search-label").textContent).toBe("Web fetch");
  });

  it("F14: a row without an entryId has no expand affordance", () => {
    const onToggle = vi.fn();
    const { container } = render(<WebSearchEntryCard {...props({ entryId: undefined, onToggle })} />);
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    fireEvent.click(screen.getByTestId("web-search-header"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("F15: icons are decorative and a text label is present", () => {
    for (const type of ["search", "fetch"]) {
      const { container, unmount } = render(
        <WebSearchEntryCard {...props({ body: JSON.stringify({ type, queries: [], urls: [] }) })} />,
      );
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
      for (const svg of svgs) expect(svg.closest("[aria-hidden='true']") ?? svg.getAttribute("aria-hidden")).toBeTruthy();
      expect(screen.getByTestId("web-search-label").textContent?.length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe("WebSearchEntryCard — expanded", () => {
  it("F10: search detail shows query, provider, answer, result and error", () => {
    const payload = {
      type: "search",
      queries: [
        { query: "first query", provider: "exa", answer: "the answer", results: [res("Result Title", "https://example.com/a", "a snippet")] },
        { query: "second query", error: "rate limited", results: [] },
      ],
    };
    render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    const text = screen.getByTestId("web-search-body").textContent ?? "";
    for (const s of ["first query", "exa", "the answer", "Result Title", "a snippet", "second query", "rate limited"]) {
      expect(text).toContain(s);
    }
  });

  it("F11: only safe http(s) URLs become links", () => {
    const payload = {
      type: "search",
      queries: [
        {
          query: "q",
          results: [
            res("A", "https://example.com/a"),
            res("B", "javascript:alert(1)"),
            res("C", "https://t.com@evil.example/"),
          ],
        },
      ],
    };
    const { container } = render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("https://example.com/a");
    expect(anchors[0].getAttribute("target")).toBe("_blank");
    expect(anchors[0].getAttribute("rel")).toBe("noopener noreferrer");
    // Visible text is the original URL; the screen-reader suffix is sr-only (retro-ux E13).
    expect(anchors[0].firstElementChild!.textContent).toBe("https://example.com/a");
    expect(container.textContent).toContain("javascript:alert(1)");
    expect(container.textContent).toContain("https://t.com@evil.example/");
  });

  it("F12: a markdown answer stays literal text", () => {
    const payload = { type: "search", queries: [{ query: "q", answer: "# Heading\n[x](https://evil)", results: [] }] };
    const { container } = render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByTestId("web-search-answer").textContent).toBe("# Heading\n[x](https://evil)");
  });

  it("fetch detail lists url, title, size and error", () => {
    const payload = {
      type: "fetch",
      urlMetadata: [
        { url: "https://example.com/p", title: "Page", contentLength: 12, error: null },
        { url: "https://example.org/q", title: "Other", contentLength: 0, error: "HTTP 404" },
      ],
    };
    render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    const items = screen.getAllByTestId("web-search-fetch-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("12 chars");
    expect(items[1].textContent).toContain("HTTP 404");
  });

  it("F13: a research payload renders as one plain-text block without links", () => {
    const payload = { type: "research", summary: "a research summary", sources: [{ url: "https://example.com" }] };
    const { container } = render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    const blocks = container.querySelectorAll("[data-testid=web-search-plain-payload]");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toContain("a research summary");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("X3: a failed payload degrades to the stored body plus the reason", () => {
    render(<WebSearchEntryCard {...props({ expanded: true, payloadError: "entry not found" })} />);
    expect(screen.getByTestId("web-search-error").textContent).toContain("entry not found");
    expect(screen.getByTestId("web-search-fallback-body").textContent).toBe(searchBody);
    expect(screen.queryByTestId("web-search-detail")).toBeNull();
  });

  it("X4: loading shows a loading line only", () => {
    render(<WebSearchEntryCard {...props({ expanded: true, payloadLoading: true })} />);
    expect(screen.getByTestId("web-search-loading")).toBeTruthy();
    expect(screen.queryByTestId("web-search-detail")).toBeNull();
    expect(screen.queryByTestId("web-search-fallback-body")).toBeNull();
  });

  it("bounds shown results with a +N more line", () => {
    const results = Array.from({ length: 25 }, (_, i) => res(`t${i}`, `https://e.com/${i}`));
    render(<WebSearchEntryCard {...props({ expanded: true, payload: { type: "search", queries: [{ query: "q", results }] } })} />);
    expect(screen.getAllByTestId("web-search-result")).toHaveLength(20);
    expect(screen.getByTestId("web-search-detail").textContent).toContain("+5 more");
  });

  it("reports skipped malformed items", () => {
    render(<WebSearchEntryCard {...props({ expanded: true, payload: { type: "search", queries: [{ query: "q", results: [res("ok", "https://e.com"), null] }] } })} />);
    expect(screen.getByTestId("web-search-skipped").textContent).toContain("1 item could not be displayed");
  });

  it("toggles through the header button", () => {
    const onToggle = vi.fn();
    render(<WebSearchEntryCard {...props({ onToggle })} />);
    fireEvent.click(screen.getByTestId("web-search-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ── retro-ux-chat-rendering ────────────────────────────────────────────────
// See change: retro-ux-chat-rendering (test-plan E12–E15, X1, X2).
const PALETTE = /\b(?:bg|text|border)-(?:red|blue|cyan|green|yellow|orange|purple|amber|slate|gray|black|white)(?:-\d+)?/;

describe("WebSearchEntryCard — UI-contract conformance", () => {
  it("E12: collapsed summary counts failed queries and issues no fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const body = JSON.stringify({
      type: "search",
      queries: [
        { query: "a", results: [{}, {}] },
        { query: "b", error: "timeout", results: [] },
        { query: "c", results: [] },
      ],
    });
    render(<WebSearchEntryCard {...props({ body })} />);
    expect(screen.getByTestId("web-search-summary").textContent).toBe("3 queries · 2 results · 1 failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("E13: errors are severity pills; links are underlined --link with a sr-only new-tab suffix", () => {
    const payload = {
      type: "search",
      queries: [
        { query: "q1", error: "Provider timeout", results: [] },
        { query: "q2", results: [res("Doc", "https://example.com/doc", "snippet")] },
      ],
    };
    const { container } = render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    const pill = screen.getByText("Provider timeout").closest("span[class*='severity-error']") as HTMLElement;
    expect(pill.className).toContain("bg-[var(--severity-error-bg)]");
    expect(pill.className).toContain("text-[var(--severity-error-fg)]");
    expect(pill.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");

    const a = container.querySelector("a")!;
    expect(a.className).toContain("text-[var(--link)]");
    expect(a.className).toContain("hover:text-[var(--link-hover)]");
    expect(a.className).toContain("underline");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(a.querySelector(".sr-only")!.textContent).toBe(" (opens in a new tab)");
    expect(a.firstElementChild!.textContent).toBe("https://example.com/doc");
    expect(container.innerHTML).not.toMatch(PALETTE);
    expect(container.innerHTML).not.toContain("--text-muted");
  });

  it("E13: a fetch error is an error pill too", () => {
    const payload = { type: "fetch", urlMetadata: [{ url: "https://e.org/q", title: "Q", error: "HTTP 404" }] };
    render(<WebSearchEntryCard {...props({ expanded: true, payload })} />);
    const item = screen.getByTestId("web-search-fetch-item");
    expect(item.querySelector("[class*='severity-error-bg']")!.textContent).toBe("HTTP 404");
  });

  it("E14: loading is a role=status line with a spinner", () => {
    render(<WebSearchEntryCard {...props({ expanded: true, payloadLoading: true })} />);
    const el = screen.getByTestId("web-search-loading");
    expect(el.getAttribute("role")).toBe("status");
    expect(el.textContent).toBe("Loading details…");
    expect(el.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it.each([
    [1, "1 item could not be displayed"],
    [2, "2 items could not be displayed"],
  ])("E15: %i malformed result(s) read '%s'", (n, text) => {
    const results = [res("ok", "https://e.com"), ...Array.from({ length: n }, () => null)];
    render(<WebSearchEntryCard {...props({ expanded: true, payload: { type: "search", queries: [{ query: "q", results }] } })} />);
    expect(screen.getByTestId("web-search-skipped").textContent).toBe(text);
  });

  it("X1: an evicted payload is a warning notice (not an error), then the stored body", () => {
    render(<WebSearchEntryCard {...props({ expanded: true, payloadError: "entry evicted" })} />);
    const notice = screen.getByTestId("web-search-error");
    expect(notice.className).toContain("--severity-warning-bg");
    expect(notice.className).not.toContain("severity-error");
    expect(notice.className).not.toMatch(/text-red/);
    expect(notice.textContent).toContain("entry evicted");
    expect(notice.textContent).toContain("saved with the chat");
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.getByTestId("web-search-fallback-body").textContent).toBe(searchBody);
  });

  it("X2: a request failure names its reason; the stored body stays plain text", () => {
    const { container } = render(<WebSearchEntryCard {...props({ expanded: true, payloadError: "boom" })} />);
    expect(screen.getByTestId("web-search-error").textContent).toContain("boom");
    expect(screen.getByTestId("web-search-fallback-body").textContent).toBe(searchBody);
    expect(container.querySelector("a")).toBeNull();
  });

  it("the row carries the tool-timeline inset (mx-4, mx-2 on mobile)", () => {
    render(<WebSearchEntryCard {...props()} />);
    const cls = screen.getByTestId("web-search-entry").className;
    expect(cls).toContain("mx-4");
    expect(cls).toContain("max-md:mx-2");
  });
});
