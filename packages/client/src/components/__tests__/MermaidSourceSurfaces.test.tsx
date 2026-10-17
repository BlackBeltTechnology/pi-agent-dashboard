/**
 * File surfaces hand `MarkdownContent` / `MermaidBlock` a stable on-disk
 * identity (`MermaidSourceInfo`) only for live-session cwds.
 * See change: add-preview-apply-fix-to-file (test-plan F8, F9).
 */
import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type MermaidSourceInfo, useMermaidSourceContext } from "../../lib/preview/mermaid-source-context.js";
import { LiveSessionCwdsProvider, liveCwdKey } from "../../lib/preview/use-mermaid-source.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

const mdSources: Array<MermaidSourceInfo | null | undefined> = [];
vi.mock("../preview/MarkdownContent.js", () => ({
  MarkdownContent: ({ mermaidSource }: { mermaidSource?: MermaidSourceInfo | null }) => {
    mdSources.push(mermaidSource);
    return <div data-testid="md" />;
  },
}));

const blocks: Array<{ ordinal: number | undefined; ctx: MermaidSourceInfo | null }> = [];
vi.mock("../preview/MermaidBlock.js", () => ({
  MermaidBlock: ({ ordinal }: { ordinal?: number }) => {
    const ctx = useMermaidSourceContext();
    blocks.push({ ordinal, ctx });
    return <div data-testid="mmd-block" />;
  },
}));

import MermaidViewer from "../editor-pane/MermaidViewer.js";
import { AsciiDocPreview } from "../preview/AsciiDocPreview.js";
import { FilePreviewOverlay } from "../preview/FilePreviewOverlay.js";
import { MarkdownPreview } from "../preview/MarkdownPreview.js";

const LIVE = "/live";
const ADOC_HTML = ["graph TD\nA--&gt;B", "graph LR\nX--&gt;Y"]
  .map(
    (src) =>
      `<div class="listingblock"><div class="content"><pre class="highlight"><code class="language-mermaid" data-lang="mermaid">${src}</code></pre></div></div>`,
  )
  .join("");

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "graph TD\nA-->B" };
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  mdSources.length = 0;
  blocks.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/file/render")) return jsonRes({ success: true, data: { html: ADOC_HTML } });
      if (String(url).includes("/api/file/raw")) return jsonRes({});
      return jsonRes({ success: true, data: { type: "file", content: "# hi\n", mtime: 1 } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetEscapeStack();
});

function wrap(ui: React.ReactElement, live: string[] = [LIVE]) {
  return (
    <ThemeProvider>
      <LiveSessionCwdsProvider cwdKey={liveCwdKey(live)}>{ui}</LiveSessionCwdsProvider>
    </ThemeProvider>
  );
}

const last = <T,>(a: T[]): T => a[a.length - 1];

describe("md surfaces — stable context identity (F8) and live-cwd gate (F9)", () => {
  const surfaces: Array<[string, (cwd: string) => React.ReactElement]> = [
    ["FilePreviewOverlay", (cwd) => <FilePreviewOverlay cwd={cwd} path="docs/a.md" onClose={() => {}} />],
    ["MarkdownPreview", (cwd) => <MarkdownPreview target={{ kind: "file", cwd, path: "docs/a.md" }} />],
  ];

  for (const [name, make] of surfaces) {
    it(`${name}: same context object across parent re-renders`, async () => {
      const { rerender } = render(wrap(make(LIVE)));
      await waitFor(() => expect(mdSources.length).toBeGreaterThan(0));
      const first = last(mdSources);
      expect(first).toMatchObject({ cwd: LIVE, path: "docs/a.md", kind: "md" });
      rerender(wrap(make(LIVE)));
      rerender(wrap(make(LIVE), [LIVE])); // fresh array, same live set
      expect(Object.is(last(mdSources), first)).toBe(true);
    });

    it(`${name}: no context for a cwd that is not a live session`, async () => {
      render(wrap(make("/pinned-only")));
      await waitFor(() => expect(mdSources.length).toBeGreaterThan(0));
      expect(last(mdSources)).toBeNull();
    });
  }
});

describe("AsciiDocPreview", () => {
  it("provides kind adoc, the mermaid count and per-block ordinals", async () => {
    render(wrap(<AsciiDocPreview target={{ kind: "file", cwd: LIVE, path: "guide.adoc" }} />));
    await waitFor(() => expect(blocks.length).toBeGreaterThanOrEqual(2));
    const latest = blocks.slice(-2);
    expect(latest.map((b) => b.ordinal)).toEqual([0, 1]);
    expect(latest[0].ctx).toMatchObject({ cwd: LIVE, path: "guide.adoc", kind: "adoc", expectedCount: 2 });
  });

  it("offers no context for a non-live cwd", async () => {
    render(wrap(<AsciiDocPreview target={{ kind: "file", cwd: "/pinned-only", path: "guide.adoc" }} />));
    await waitFor(() => expect(blocks.length).toBeGreaterThanOrEqual(2));
    expect(last(blocks).ctx).toBeNull();
  });
});

describe("MermaidViewer (.mmd)", () => {
  it("provides kind mmd, ordinal 0 and a stable context", async () => {
    const view = (path: string) => wrap(<MermaidViewer cwd={LIVE} path={path} kind="mermaid" mimeType="text/plain" size={0} />);
    const { rerender } = render(view("flow.mmd"));
    await waitFor(() => expect(blocks.length).toBeGreaterThan(0));
    const first = last(blocks);
    expect(first.ordinal).toBe(0);
    expect(first.ctx).toMatchObject({ cwd: LIVE, path: "flow.mmd", kind: "mmd" });
    rerender(view("flow.mmd"));
    expect(Object.is(last(blocks).ctx, first.ctx)).toBe(true);
  });

  it("reload re-fetches the raw file bypassing the HTTP cache (raw is max-age=60)", async () => {
    render(wrap(<MermaidViewer cwd={LIVE} path="flow.mmd" kind="mermaid" mimeType="text/plain" size={0} />));
    await waitFor(() => expect(blocks.length).toBeGreaterThan(0));
    const rawCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => String(u).includes("/api/file/raw"));
    expect(rawCalls()).toHaveLength(1);
    expect((rawCalls()[0][1] as RequestInit | undefined)?.cache).toBeUndefined();
    act(() => last(blocks).ctx?.reload());
    await waitFor(() => expect(rawCalls()).toHaveLength(2));
    expect((rawCalls()[1][1] as RequestInit).cache).toBe("no-store");
  });
});
