import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { TasksPopover } from "../session/TasksPopover.js";

afterEach(() => cleanup());

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>,
) {
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    const { status, body } = await handler(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as any;
  }) as any;
}

const listPayload = {
  success: true,
  data: {
    tasks: [
      { id: "1.1", text: "First", done: false, line: 3, group: "1. Setup" },
      { id: "1.2", text: "Second", done: true, line: 4, group: "1. Setup" },
      { id: "2.1", text: "Third", done: false, line: 7, group: "2. Docs" },
    ],
    groups: ["1. Setup", "2. Docs"],
  },
};

describe("TasksPopover", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders groups and tasks from fetched payload", async () => {
    mockFetch((url) => {
      if (url.includes("/api/openspec/tasks?")) return { status: 200, body: listPayload };
      return { status: 404, body: { success: false } };
    });
    render(<TasksPopover cwd="/cwd" change="demo" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("task-row-1.1"));
    expect(screen.getByTestId("task-row-1.2")).toBeTruthy();
    expect(screen.getByTestId("task-row-2.1")).toBeTruthy();
    expect((screen.getByTestId("task-checkbox-1.1") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("task-checkbox-1.2") as HTMLInputElement).checked).toBe(true);
  });

  it("POSTs toggle with correct body on checkbox click", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let phase: "initial" | "post" | "refetch" = "initial";
    mockFetch((url, init) => {
      calls.push({ url, init });
      if (init?.method === "POST") {
        phase = "refetch";
        return { status: 200, body: { success: true, data: { task: { id: "1.1", text: "First", done: true, line: 3, group: "1. Setup" } } } };
      }
      return { status: 200, body: listPayload };
    });
    render(<TasksPopover cwd="/cwd" change="demo" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("task-row-1.1"));
    fireEvent.click(screen.getByTestId("task-checkbox-1.1"));
    await waitFor(() => {
      const postCall = calls.find((c) => c.init?.method === "POST");
      expect(postCall).toBeTruthy();
    });
    const postCall = calls.find((c) => c.init?.method === "POST")!;
    const body = JSON.parse(String(postCall.init!.body));
    expect(body).toEqual({ cwd: "/cwd", change: "demo", id: "1.1", done: true, line: 3 });
    // After POST, a refetch should fire (phase goes from post → refetch happened)
    expect(phase).toBe("refetch");
  });

  it("shows banner and refetches when POST returns 409", async () => {
    let getCount = 0;
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        return { status: 409, body: { success: false, error: "line mismatch" } };
      }
      getCount++;
      return { status: 200, body: listPayload };
    });
    render(<TasksPopover cwd="/cwd" change="demo" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("task-row-1.1"));
    fireEvent.click(screen.getByTestId("task-checkbox-1.1"));
    await waitFor(() => screen.getByTestId("tasks-popover-banner"));
    expect(screen.getByTestId("tasks-popover-banner").textContent).toMatch(/changed/i);
    expect(getCount).toBeGreaterThanOrEqual(2);
  });

  it("calls onClose when backdrop clicked", async () => {
    mockFetch(() => ({ status: 200, body: listPayload }));
    const onClose = vi.fn();
    render(<TasksPopover cwd="/cwd" change="demo" onClose={onClose} />);
    await waitFor(() => screen.getByTestId("task-row-1.1"));
    fireEvent.click(screen.getByTestId("tasks-popover-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });
});
