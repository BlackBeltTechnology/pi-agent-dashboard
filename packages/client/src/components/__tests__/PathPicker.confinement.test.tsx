/**
 * PathPicker states for a remote (confined) caller: the root-top hint and the
 * outside-the-shared-folders refusal. Its own file because the F2 fixed-tick guard
 * pins `PathPicker.test.tsx` to its merge-base test ids.
 * See change: harden-server-capability-bounds (test-plan #F4, #F5).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathPicker } from "../primitives/PathPicker.js";

const mockBrowse = vi.fn();
const mockMkdir = vi.fn();
const mockClassify = vi.fn();
vi.mock("../../lib/api/browse-api.js", () => ({
  browseDirectory: (...args: unknown[]) => mockBrowse(...args),
  classifyPaths: (...args: unknown[]) => mockClassify(...args),
  createDirectory: (...args: unknown[]) => mockMkdir(...args),
}));

function makeBrowseResult(current: string, entries: Array<{ name: string }>, parent: string | null) {
  return { current, parent, entries: entries.map((e) => ({ name: e.name, path: `${current}/${e.name}` })) };
}

afterEach(() => cleanup());

// ─── remote confinement states (change: harden-server-capability-bounds, #F4, #F5) ───
describe("PathPicker confinement states", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const refusal = () => Object.assign(new Error("path outside allowed roots"), { code: "path_outside_allowed_roots" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClassify.mockResolvedValue({});
  });

  it("F4 confined root top: hint shown, no `..` row", async () => {
    mockBrowse.mockResolvedValue({ ...makeBrowseResult("/Users/robson", [{ name: "Project" }], null), confined: true });
    render(<PathPicker initialPath="/Users/robson/" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    expect(screen.getByTestId("path-picker-confined-hint").textContent).toMatch(/folders this dashboard shares/i);
    expect(screen.queryByText("..")).toBeNull();
  });

  it("F4 local filesystem root: no `..`, no hint", async () => {
    mockBrowse.mockResolvedValue(makeBrowseResult("/", [{ name: "usr" }], null));
    render(<PathPicker initialPath="/" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("usr")).toBeTruthy());
    expect(screen.queryByTestId("path-picker-confined-hint")).toBeNull();
    expect(screen.queryByText("..")).toBeNull();
  });

  it("F4 confined below the root top: `..` row, no hint", async () => {
    mockBrowse.mockResolvedValue({ ...makeBrowseResult("/Users/robson/Project", [{ name: "app" }], "/Users/robson"), confined: true });
    render(<PathPicker initialPath="/Users/robson/Project/" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("app")).toBeTruthy());
    expect(screen.getByText("..")).toBeTruthy();
    expect(screen.queryByTestId("path-picker-confined-hint")).toBeNull();
  });

  it("F5 a browse refusal shows plain-language text + Back to home, never the raw string", async () => {
    mockBrowse.mockRejectedValueOnce(refusal());
    const { container } = render(<PathPicker initialPath="/" onSelect={onSelect} onCancel={onCancel} />);
    const box = await screen.findByTestId("path-picker-outside-roots");
    expect(box.textContent).toMatch(/outside the folders this dashboard shares/i);
    expect(box.textContent).toMatch(/Ask the host to pin it/i);
    expect(container.textContent).not.toContain("path outside allowed roots");
    // Back to home re-browses with no path
    mockBrowse.mockResolvedValue({ ...makeBrowseResult("/Users/robson", [{ name: "Project" }], null), confined: true });
    fireEvent.click(screen.getByRole("button", { name: /back to home/i }));
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    expect(mockBrowse).toHaveBeenLastCalledWith(undefined, expect.anything());
    // CodeRabbit r1: the input must show the browsed home, or Select stays disabled and typing parses against "".
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("/Users/robson/"));
    expect(screen.queryByTestId("path-picker-outside-roots")).toBeNull();
  });

  it("F5 a mkdir refusal shows the same text", async () => {
    mockBrowse.mockResolvedValue({ ...makeBrowseResult("/Users/robson", [{ name: "Project" }], null), confined: true });
    mockMkdir.mockRejectedValueOnce(refusal());
    render(<PathPicker initialPath="/Users/robson/" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/Users/robson/brand-new" } });
    const create = await screen.findByText(/brand-new/, { selector: "[role=option] *" }).catch(() => null);
    if (create) fireEvent.click(create);
    await waitFor(() => expect(mockMkdir).toHaveBeenCalled());
    const box = await screen.findByTestId("path-picker-outside-roots");
    expect(box.textContent).toMatch(/Ask the host to pin it/i);
  });
});
