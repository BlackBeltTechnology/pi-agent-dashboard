/**
 * EditorPane × content-gated changed-on-disk: baseline before viewer mount,
 * Refresh, activation. See change: gate-changed-on-disk-by-content
 * (tasks 6.1–6.4; test-plan F1, F9, F10).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { monacoMounts } = vi.hoisted(() => ({ monacoMounts: { n: 0 } }));

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../MonacoBuffer.js", async () => {
  const React = await import("react");
  return {
    default: () => {
      React.useEffect(() => {
        monacoMounts.n++;
      }, []);
      return <div data-testid="monaco-viewer" />;
    },
  };
});

import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";

const originalFetch = globalThis.fetch;

type Api = { fire: (p: string) => void };
const api: Api = { fire: () => {} };
let gen = 0;

function Probe() {
  const { openInSplit } = useSplitWorkspace();
  return (
    <>
      <button type="button" data-testid="open-foo" onClick={() => openInSplit("foo.ts")} />
      <button type="button" data-testid="open-bar" onClick={() => openInSplit("bar.ts")} />
    </>
  );
}

function Harness({ watch }: { watch: (...a: unknown[]) => void }) {
  const [changed, setChanged] = useState(new Map<string, number>());
  api.fire = (p) => act(() => setChanged((prev) => new Map(prev).set(p, ++gen)));
  return (
    <SplitWorkspaceProvider
      sessionId="sCD"
      cwd="/proj"
      orientation="h"
      changeDetection
      changedFiles={changed}
      onWatchFiles={watch}
      onClearChanged={(path, g) =>
        setChanged((prev) => {
          if (!prev.has(path) || (g !== undefined && prev.get(path) !== g)) return prev;
          const n = new Map(prev);
          n.delete(path);
          return n;
        })
      }
    >
      <EditorPane />
      <Probe />
    </SplitWorkspaceProvider>
  );
}

let digest: (path: string) => Promise<unknown>;
const digestPaths: string[] = [];
const ok = (sha1: string) => ({ ok: true, status: 200, json: async () => ({ success: true, data: { size: 1, mtime: 1, sha1 } }) });

beforeEach(() => {
  localStorage.clear();
  monacoMounts.n = 0;
  digestPaths.length = 0;
  digest = async () => ok("S");
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === "/api/file/digest") {
      const p = url.searchParams.get("path") ?? "";
      digestPaths.push(p);
      return digest(p);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: { entries: [] } }) });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("EditorPane — baseline before viewer mount", () => {
  it("F1: the viewer is not mounted until the digest resolves, then mounts once", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    digest = async () => {
      await hold;
      return ok("S");
    };
    render(<Harness watch={vi.fn()} />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await screen.findByTestId("baseline-pending");
    expect(screen.queryByTestId("monaco-viewer")).toBeNull();
    await act(async () => {
      release();
    });
    await screen.findByTestId("monaco-viewer");
    expect(screen.queryByTestId("baseline-pending")).toBeNull();
    expect(monacoMounts.n).toBe(1);
  });

  it("a failed digest still mounts the viewer (null baseline)", async () => {
    digest = async () => Promise.reject(new Error("net"));
    render(<Harness watch={vi.fn()} />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await screen.findByTestId("monaco-viewer");
  });

  it("F9: Refresh re-mounts the viewer, clears the banner, recaptures the baseline, re-sends watch_files", async () => {
    const watch = vi.fn();
    render(<Harness watch={watch} />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await screen.findByTestId("monaco-viewer");
    digest = async () => ok("S2");
    api.fire("foo.ts");
    await screen.findByTestId("changed-on-disk-banner", undefined, { timeout: 2000 });
    const mounts = monacoMounts.n;
    const digests = digestPaths.length;
    const sends = watch.mock.calls.length;
    fireEvent.click(screen.getByTestId("changed-refresh"));
    await waitFor(() => expect(monacoMounts.n).toBe(mounts + 1));
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
    expect(digestPaths.length).toBeGreaterThan(digests); // baseline recaptured
    expect(watch.mock.calls.length).toBe(sends + 1);
    expect(watch).toHaveBeenLastCalledWith("sCD", "/proj", ["foo.ts"]);
  });

  it("F10: activating a background tab recaptures its baseline and clears its candidate + banner", async () => {
    render(<Harness watch={vi.fn()} />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await screen.findByTestId("monaco-viewer");
    fireEvent.click(screen.getByTestId("open-bar"));
    await waitFor(() => expect(monacoMounts.n).toBe(2));
    digest = async () => ok("S2");
    api.fire("foo.ts"); // background tab: candidate verified, banner not shown (not active)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const before = digestPaths.filter((p) => p === "foo.ts").length;
    digest = async () => ok("S2");
    fireEvent.click(screen.getByTitle("foo.ts"));
    await waitFor(() => expect(digestPaths.filter((p) => p === "foo.ts").length).toBeGreaterThan(before));
    await screen.findByTestId("monaco-viewer");
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
  });
});
