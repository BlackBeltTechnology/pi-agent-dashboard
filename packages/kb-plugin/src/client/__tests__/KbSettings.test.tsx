/**
 * useKbConfig round-trip (task 5.1) + KbSettingsPanel sources editing / worktree
 * bootstrap affordances (tasks 5.3, 5.4). See change: add-kb-folder-slot.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KbConfigResponse } from "../../shared/kb-plugin-types.js";
import { KbSettingsPanel, parentRepoOf } from "../KbSettingsPanel.js";
import { useKbConfig } from "../useKbConfig.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function configResponse(over: Partial<KbConfigResponse> = {}): KbConfigResponse {
  return {
    origin: "project",
    projectPath: "/repo/.pi/dashboard/knowledge_base.json",
    // Only the fields the panel reads are needed for the smoke test.
    config: { sources: [{ kind: "filesystem", ref: "docs" }], include: ["**/*.md"], exclude: ["**/node_modules/**"], dbPath: ".pi/dashboard/kb/index.db" } as KbConfigResponse["config"],
    ...over,
  };
}

function jsonOk(body: unknown): Response {
  return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}

describe("parentRepoOf", () => {
  it("derives the parent for a .worktrees checkout", () => {
    expect(parentRepoOf("/repo/.worktrees/feature-x")).toBe("/repo");
    expect(parentRepoOf("/repo/worktrees/feature-x")).toBe("/repo");
  });
  it("returns null when not under a worktree path", () => {
    expect(parentRepoOf("/repo/src")).toBeNull();
  });
});

describe("useKbConfig", () => {
  function Probe({ cwd }: { cwd: string }): React.ReactElement {
    const { data, save } = useKbConfig(cwd);
    return (
      <div>
        <span data-testid="origin">{data?.origin ?? ""}</span>
        <button data-testid="do-save" onClick={() => void save({ sources: [{ kind: "filesystem", ref: "openspec" }], reindex: false })} />
      </div>
    );
  }

  it("GETs then round-trips a save (PUT)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? jsonOk(configResponse({ config: { sources: [{ kind: "filesystem", ref: "openspec" }] } as KbConfigResponse["config"] })) : jsonOk(configResponse()),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<Probe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("origin").textContent).toBe("project"));
    fireEvent.click(getByTestId("do-save"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    );
  });
});

describe("KbSettingsPanel", () => {
  it("lists sources and adds a new one, then Save + Reindex PUTs with reindex", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/kb/config") && init?.method === "PUT") return jsonOk(configResponse());
      if (String(url).includes("/api/kb/config")) return jsonOk(configResponse());
      return jsonOk({ files: 1, chunks: 5, indexed: true, staleCount: 0, indexing: false, jobStatus: "idle" });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId, getAllByTestId } = render(<KbSettingsPanel cwd="/repo" onBack={() => {}} />);
    await waitFor(() => expect(getAllByTestId("kb-source-row").length).toBe(1));

    fireEvent.change(getByTestId("kb-source-input"), { target: { value: "openspec" } });
    fireEvent.click(getByTestId("kb-source-add"));
    await waitFor(() => expect(getAllByTestId("kb-source-row").length).toBe(2));

    fireEvent.click(getByTestId("kb-save-reindex"));
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/kb/config") && (c[1] as RequestInit)?.method === "PUT");
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.reindex).toBe(true);
      expect(body.sources.map((s: { ref: string }) => s.ref)).toContain("openspec");
    });
  });

  it("worktree (no project file): shows Create/Copy bootstrap affordances", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/api/kb/config")
        ? jsonOk(configResponse({ origin: "global" }))
        : jsonOk({ files: 0, chunks: 0, indexed: false, staleCount: 0, indexing: false, jobStatus: "idle" }),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<KbSettingsPanel cwd="/repo/.worktrees/x" onBack={() => {}} />);
    await waitFor(() => expect(getByTestId("kb-copy-parent")).toBeTruthy());
    expect(getByTestId("kb-create-config")).toBeTruthy();
    expect(getByTestId("kb-bootstrap-note")).toBeTruthy();
  });
});
