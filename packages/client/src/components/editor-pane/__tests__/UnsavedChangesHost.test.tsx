/**
 * Page-level unsaved dialog: lists every dirty tab; initial focus on Cancel;
 * Escape / backdrop = Cancel; Enter on the initial focus never discards (#S79, G5).
 * See change: fix-file-link-editor-routing (4.18 / 4.19).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesHost } from "../UnsavedChangesHost.js";
import { createUnsavedStore, unsavedKey } from "../unsaved-store.js";

afterEach(cleanup);

function setup() {
  const store = createUnsavedStore();
  const a = { label: "notes.md", dirty: true, save: vi.fn(async () => true), discard: vi.fn() };
  const b = { label: "todo.md", dirty: true, save: vi.fn(async () => true), discard: vi.fn() };
  store.registerUnsaved(unsavedKey("s1", "notes.md"), a);
  store.registerUnsaved(unsavedKey("s1", "todo.md"), b);
  render(<UnsavedChangesHost store={store} />);
  return { store, a, b };
}

describe("UnsavedChangesHost", () => {
  it("renders nothing without an open dialog", () => {
    render(<UnsavedChangesHost store={createUnsavedStore()} />);
    expect(screen.queryByTestId("unsaved-dialog")).toBeNull();
  });

  it("lists every dirty tab in one dialog; Cancel is first and focused", async () => {
    const { store } = setup();
    let p!: Promise<boolean>;
    act(() => {
      p = store.confirmLeave();
    });
    const list = await screen.findByTestId("unsaved-list");
    expect(list.textContent).toContain("notes.md");
    expect(list.textContent).toContain("todo.md");
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("unsaved-cancel")));
    // Enter on the initial focus acts as Cancel, never Discard.
    fireEvent.click(document.activeElement as HTMLElement);
    await expect(p).resolves.toBe(false);
  });

  it("Escape and backdrop click both Cancel", async () => {
    const { store, a } = setup();
    let p!: Promise<boolean>;
    act(() => {
      p = store.confirmLeave();
    });
    await screen.findByTestId("unsaved-dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBe(false);
    act(() => {
      p = store.confirmLeave();
    });
    fireEvent.click(await screen.findByTestId("unsaved-dialog-overlay"));
    await expect(p).resolves.toBe(false);
    expect(a.discard).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
  });

  it("Save / Discard buttons drive the verdict", async () => {
    const { store, a, b } = setup();
    let p!: Promise<boolean>;
    act(() => {
      p = store.confirmLeave();
    });
    fireEvent.click(await screen.findByTestId("unsaved-save"));
    await expect(p).resolves.toBe(true);
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledTimes(1);
    act(() => {
      p = store.confirmLeave();
    });
    fireEvent.click(await screen.findByTestId("unsaved-discard"));
    await expect(p).resolves.toBe(true);
    expect(a.discard).toHaveBeenCalledTimes(1);
  });
});
