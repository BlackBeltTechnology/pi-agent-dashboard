import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { FileLink } from "../FileLink.js";
import * as editorApi from "../../../lib/editor-api.js";
import type { ToolContext } from "../types.js";

const originalLocation = window.location;
function setHost(host: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, hostname: host },
    writable: true,
  });
}
function restoreHost() {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
}

describe("FileLink — click routing", () => {
  beforeEach(() => {
    vi.spyOn(editorApi, "openEditor").mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreHost();
  });

  it("localhost + editor → calls openEditor with cwd/editor/file/line", async () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = render(
      <FileLink path="src/foo.ts" line={42} context={ctx}>
        src/foo.ts:42
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    // Allow microtask flush for the async handler.
    await Promise.resolve();
    expect(editorApi.openEditor).toHaveBeenCalledWith(
      "/Users/me/repo",
      "code",
      "src/foo.ts",
      42,
    );
  });

  it("remote → does NOT call openEditor; opens the preview overlay", async () => {
    setHost("dashboard.example.com");
    // Stub /api/file so the overlay's mount-time fetch doesn't throw.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole, findByTestId } = render(
      <FileLink path="src/foo.ts" line={5} context={ctx}>
        src/foo.ts:5
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(editorApi.openEditor).not.toHaveBeenCalled();
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it("localhost without editors → opens preview overlay (no openEditor call)", async () => {
    setHost("localhost");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const ctx: ToolContext = { cwd: "/Users/me/repo", editors: [] };
    const { getByRole, findByTestId } = render(
      <FileLink path="src/bar.ts" context={ctx}>
        src/bar.ts
      </FileLink>,
    );
    fireEvent.click(getByRole("button"));
    expect(editorApi.openEditor).not.toHaveBeenCalled();
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
  });

  it("title exposes resolved absolute path on hover", () => {
    setHost("localhost");
    const ctx: ToolContext = {
      cwd: "/Users/me/repo",
      editors: [{ id: "code", name: "VS Code" }],
    };
    const { getByRole } = render(
      <FileLink path="src/foo.ts" line={42} context={ctx}>
        src/foo.ts:42
      </FileLink>,
    );
    const title = getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("/Users/me/repo/src/foo.ts");
    expect(title).toContain(":42");
  });
});
