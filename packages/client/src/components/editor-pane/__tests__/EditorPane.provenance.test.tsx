/**
 * The editor pane declares each tab's provenance, and a provenance change on
 * the active tab remounts its viewer (change: surface-denial-remedy-in-previews,
 * design D4; test-plan #E27).
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mounts } = vi.hoisted(() => ({ mounts: [] as boolean[] }));

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
// A probe viewer: records one entry per MOUNT, carrying whether its requests
// would be opted out of the grant dialog.
vi.mock("../MonacoBuffer.js", async () => {
  const React = await import("react");
  const { usePreviewFetch } = await import("../../../lib/access-grants/preview-provenance.js");
  return {
    default: () => {
      const { optedOut } = usePreviewFetch();
      React.useEffect(() => {
        mounts.push(optedOut);
      }, []);
      return React.createElement("div", { "data-testid": "probe-viewer" });
    },
  };
});

import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";

let api: ReturnType<typeof useSplitWorkspace> | null = null;
function Probe() {
  api = useSplitWorkspace();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  mounts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: { entries: [] } }))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("#E27 a provenance change remounts the active viewer", () => {
  it("an operator re-open of an auto-opened active tab remounts it once, eligible", async () => {
    render(
      <SplitWorkspaceProvider sessionId="sProv" cwd="/proj" orientation="h">
        <Probe />
        <EditorPane />
      </SplitWorkspaceProvider>,
    );
    act(() => api?.openInSplit("a.ts", undefined, true, { autoOpened: true }));
    await waitFor(() => expect(mounts).toEqual([true])); // auto-opened → opted out (lazy viewer)
    act(() => api?.openInSplit("a.ts"));
    await waitFor(() => expect(mounts).toEqual([true, false])); // one remount, now eligible
    act(() => api?.openInSplit("a.ts"));
    expect(mounts).toEqual([true, false]); // no provenance change → no remount
  });
});
