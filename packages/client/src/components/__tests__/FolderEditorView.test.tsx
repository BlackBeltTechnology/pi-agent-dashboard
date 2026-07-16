/**
 * FolderEditorView — the folder-scoped internal Monaco pane that replaces the
 * removed external code-server EditorView.
 *
 * See change: remove-external-editor-integration.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));

import { folderPaneId } from "../../lib/folder-pane-id.js";
import { TREE_VISIBLE_KEY_PREFIX } from "../../lib/tree-visible.js";
import { FolderEditorView } from "../FolderEditorView.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, data: { entries: [] } }) }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("FolderEditorView", () => {
  it("mounts the internal editor pane rooted at the folder cwd", () => {
    render(<FolderEditorView cwd="/proj" />);
    // The EditorPane's discoverable rail toggle proves the internal pane mounted.
    expect(screen.getByTestId("tree-toggle")).toBeTruthy();
    // No external code-server iframe.
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("persists pane state under the namespaced folder key (not a session id)", () => {
    render(<FolderEditorView cwd="/proj" />);
    const toggle = screen.getByTestId("tree-toggle");
    fireEvent.click(toggle);
    // Tree-visible persists under `${prefix}folder:/proj`, disjoint from any UUID.
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}${folderPaneId("/proj")}`)).toBe("true");
  });

  it("shows no changed-on-disk banner in folder scope (Non-Goal v1)", () => {
    render(<FolderEditorView cwd="/proj" />);
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
  });
});
