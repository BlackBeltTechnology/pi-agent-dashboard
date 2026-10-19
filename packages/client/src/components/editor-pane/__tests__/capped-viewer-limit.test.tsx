/**
 * CappedViewer gates rich viewers on the configured `editor.largeFileLimitMb`
 * (not the fixed 10 MiB), waits for config hydration, and reacts live.
 * The viewer registry is stubbed so these tests pin the GATE, not the renderers.
 *
 * See change: gate-changed-on-disk-by-content (test-plan #E2, #E3, #F14, #F15).
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../viewer-registry.js", () => ({
  viewerRegistry: new Proxy(
    {},
    {
      get: (_t, kind: string) => () => <div data-testid={`viewer-${kind}`} />,
    },
  ),
}));

import {
  __resetEditorLimitsConfig,
  hydrateEditorLimitsConfig,
} from "../../../lib/preview/editor-limits-config.js";
import { CappedViewer } from "../CappedViewer.js";

const MB = 1024 * 1024;
const originalFetch = globalThis.fetch;

function mockSize(size: number): void {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { type: "file", size } }) }),
  ) as unknown as typeof fetch;
}

const hydrate = (mb: number): void =>
  hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: mb } } });

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  __resetEditorLimitsConfig();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  __resetEditorLimitsConfig();
});

describe("CappedViewer — configured limit boundary (E2)", () => {
  it("limit 10 MiB: data.csv at exactly the limit mounts the viewer, +1 byte mounts TooLargePreview naming 10 MB", async () => {
    hydrate(10);
    mockSize(10 * MB);
    const { unmount } = render(
      <CappedViewer viewer="spreadsheet" cwd="/proj" path="data.csv" kind="text" mimeType="text/csv" size={0} />,
    );
    expect(await screen.findByTestId("viewer-spreadsheet")).toBeTruthy();
    expect(screen.queryByTestId("too-large-preview")).toBeNull();
    unmount();

    mockSize(10 * MB + 1);
    render(<CappedViewer viewer="spreadsheet" cwd="/proj" path="data.csv" kind="text" mimeType="text/csv" size={0} />);
    const notice = await screen.findByTestId("too-large-preview");
    expect(notice.textContent).toContain("limit 10 MB");
    expect(screen.queryByTestId("viewer-spreadsheet")).toBeNull();
  });
});

describe("CappedViewer — raised limit (E3)", () => {
  it("store hydrated with 64 MiB: a 30 MiB notes.md mounts the markdown viewer", async () => {
    hydrate(64);
    mockSize(30 * MB);
    render(<CappedViewer viewer="markdown" cwd="/proj" path="notes.md" kind="text" mimeType="text/markdown" size={0} />);
    expect(await screen.findByTestId("viewer-markdown")).toBeTruthy();
    expect(screen.queryByTestId("too-large-preview")).toBeNull();
  });
});

describe("CappedViewer — hydration wait (F14)", () => {
  it("waits for the config (no fallback flash), then mounts the viewer when it raises the limit", async () => {
    vi.useFakeTimers();
    mockSize(30 * MB);
    render(<CappedViewer viewer="markdown" cwd="/proj" path="notes.md" kind="text" mimeType="text/markdown" size={0} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByTestId("too-large-preview")).toBeNull();
    expect(screen.queryByTestId("viewer-markdown")).toBeNull();
    expect(screen.getByText("Loading viewer…")).toBeTruthy();

    act(() => hydrate(64));
    expect(screen.getByTestId("viewer-markdown")).toBeTruthy();
    expect(screen.queryByTestId("too-large-preview")).toBeNull();
  });

  it("config never arrives: after 3 s the default 10 MiB gate applies", async () => {
    vi.useFakeTimers();
    mockSize(30 * MB);
    render(<CappedViewer viewer="markdown" cwd="/proj" path="notes.md" kind="text" mimeType="text/markdown" size={0} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2900);
    });
    expect(screen.queryByTestId("too-large-preview")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 10 MB");
  });

  it("monaco is never gated and never waits", () => {
    render(<CappedViewer viewer="monaco" cwd="/proj" path="a.ts" kind="text" mimeType="text/plain" size={0} />);
    expect(screen.getByTestId("viewer-monaco")).toBeTruthy();
  });
});

describe("CappedViewer — live change (F15)", () => {
  it("a limit raised after mount swaps the fallback for the viewer without a reload", async () => {
    hydrate(10);
    mockSize(30 * MB);
    render(<CappedViewer viewer="markdown" cwd="/proj" path="notes.md" kind="text" mimeType="text/markdown" size={0} />);
    expect(await screen.findByTestId("too-large-preview")).toBeTruthy();

    act(() => hydrate(64));
    expect(screen.getByTestId("viewer-markdown")).toBeTruthy();
    expect(screen.queryByTestId("too-large-preview")).toBeNull();
  });

  it("a limit lowered after mount swaps the viewer for the fallback", async () => {
    hydrate(64);
    mockSize(30 * MB);
    render(<CappedViewer viewer="markdown" cwd="/proj" path="notes.md" kind="text" mimeType="text/markdown" size={0} />);
    expect(await screen.findByTestId("viewer-markdown")).toBeTruthy();
    act(() => hydrate(10));
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 10 MB");
  });
});
