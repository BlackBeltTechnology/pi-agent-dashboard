/**
 * "Apply fix to file" on a repaired diagram: availability, diff confirmation,
 * conflict-safe write. See change: add-preview-apply-fix-to-file
 * (test-plan F1–F7, X1–X6).
 */

import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidSourceContext, type MermaidSourceInfo } from "../../lib/preview/mermaid-source-context.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const mockRender = vi.fn();
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: mockRender } }));

import { _outcomeCache, MermaidBlock } from "../preview/MermaidBlock.js";

const REPAIRABLE = "graph TD\nA -->|(x)| B"; // R4
const FIXED = 'graph TD\nA -->|"(x)"| B';
const SVG = '<svg viewBox="0 0 1000 400"><text>fixed</text></svg>';
const MTIME = 1700000000123.456;
const FILE = `# T\n\n\`\`\`mermaid\n${REPAIRABLE}\n\`\`\`\n\ntail\n`;

interface FakeRes {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
const res = (status: number, body: unknown): FakeRes => ({ status, ok: status >= 200 && status < 300, json: async () => body });

let fetchMock: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
let readHandler: () => Promise<FakeRes>;
let writeHandler: () => Promise<FakeRes>;

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
const reads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/file/md-read"));

function source(over: Partial<MermaidSourceInfo> = {}): MermaidSourceInfo {
  return { cwd: "/proj", path: "docs/flow.md", kind: "md", reload: reload as unknown as () => void, ...over };
}

function mount(ctx: MermaidSourceInfo | null, props: { ordinal?: number; code?: string } = {}) {
  const ui: React.ReactElement = (
    <ThemeProvider>
      <MermaidSourceContext.Provider value={ctx}>
        <MermaidBlock code={props.code ?? REPAIRABLE} ordinal={"ordinal" in props ? props.ordinal : 0} />
      </MermaidSourceContext.Provider>
    </ThemeProvider>
  );
  return render(ui);
}

// The full suite runs thousands of tests in parallel: allow slow async settling.
const SLOW = { timeout: 8000 };

async function mountRepaired(ctx: MermaidSourceInfo | null = source(), props: { ordinal?: number } = {}) {
  mockRender.mockRejectedValueOnce(new Error("E1")).mockResolvedValueOnce({ svg: SVG });
  const utils = mount(ctx, props);
  await waitFor(() => expect(screen.getByTestId("mermaid-repair-badge")).toBeTruthy(), SLOW);
  return utils;
}

const applyBtn = () => screen.getByTestId("mermaid-apply-fix-button") as HTMLButtonElement;

async function openDialog() {
  await mountRepaired();
  fireEvent.click(applyBtn());
  await screen.findByRole("dialog", {}, SLOW);
}

vi.setConfig({ testTimeout: 30_000 });

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
});

beforeEach(() => {
  vi.clearAllMocks();
  _outcomeCache.clear();
  localStorage.clear();
  __resetEscapeStack();
  reload = vi.fn();
  readHandler = async () => res(200, { success: true, data: { content: FILE, mtime: MTIME } });
  writeHandler = async () => res(200, { success: true, data: { mtime: MTIME + 1 } });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "POST" ? writeHandler() : String(url).includes("/api/file/md-read") ? readHandler() : res(404, {}),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("availability", () => {
  it("F1: chat diagram (no source context) has no action; copy-fixed stays", async () => {
    await mountRepaired(null);
    expect(screen.queryByTestId("mermaid-apply-fix-button")).toBeNull();
    expect(screen.getByTestId("mermaid-copy-fixed")).toBeTruthy();
  });

  it("F2: an un-repaired diagram has no action", async () => {
    mockRender.mockResolvedValueOnce({ svg: SVG });
    mount(source(), { code: "graph TD\nA-->B" });
    await waitFor(() => expect(document.querySelector(".mermaid-diagram svg")).not.toBeNull(), SLOW);
    expect(screen.queryByTestId("mermaid-apply-fix-button")).toBeNull();
  });

  it("a block without an ordinal (raw-HTML block) has no action", async () => {
    await mountRepaired(source(), { ordinal: undefined });
    expect(screen.queryByTestId("mermaid-apply-fix-button")).toBeNull();
  });

  it("F3: unsaved edits disable the action with an explanation", async () => {
    await mountRepaired(source({ isDirty: true }));
    expect(applyBtn().disabled).toBe(true);
    expect(screen.getByText(/save or discard edits first/i)).toBeTruthy();
    expect(applyBtn().getAttribute("aria-describedby")).toBeTruthy();
  });
});

describe("diff confirmation", () => {
  it("F4: re-reads once, then shows the on-disk vs fixed diff and writes nothing", async () => {
    await openDialog();
    expect(reads()).toHaveLength(1);
    expect(posts()).toHaveLength(0);
    const diff = screen.getByTestId("mermaid-apply-diff");
    const removed = [...diff.querySelectorAll('[data-diff="removed"]')].map((e) => e.textContent);
    const added = [...diff.querySelectorAll('[data-diff="added"]')].map((e) => e.textContent);
    expect(removed.join("\n")).toContain("A -->|(x)| B");
    expect(added.join("\n")).toContain('A -->|"(x)"| B');
  });

  it("F5: Cancel writes nothing and returns focus to the trigger", async () => {
    await openDialog();
    fireEvent.click(screen.getByTestId("mermaid-apply-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), SLOW);
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(applyBtn()), SLOW);
  });

  it("F5: Escape writes nothing and returns focus to the trigger", async () => {
    await openDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), SLOW);
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(applyBtn()), SLOW);
  });

  it("F6: Confirm posts the spliced file with the md-read mtime, then reloads once", async () => {
    await openDialog();
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), SLOW);
    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0] as [string, RequestInit];
    expect(url).toContain("/api/file/write");
    expect(JSON.parse(init.body as string)).toEqual({
      cwd: "/proj",
      path: "docs/flow.md",
      content: FILE.replace(REPAIRABLE, FIXED),
      mtime: MTIME,
    });
  });

  it("F7: accessible modal — role, aria-modal, Tab stays inside", async () => {
    await openDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const cancel = within(dialog).getByTestId("mermaid-apply-cancel");
    const confirm = within(dialog).getByTestId("mermaid-apply-confirm");
    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});

describe("conflict-safe write", () => {
  const changedMsg = () => screen.findByText(/file changed — reload/i, undefined, SLOW);

  it("X1: block edited externally → no dialog, no write, reload offered", async () => {
    readHandler = async () => res(200, { success: true, data: { content: FILE.replace(REPAIRABLE, "graph TD\nEDITED-->B"), mtime: MTIME } });
    await mountRepaired();
    fireEvent.click(applyBtn());
    await changedMsg();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("mermaid-apply-reload"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("X2: 409 on write → no retry, reload message", async () => {
    writeHandler = async () => res(409, { success: false, error: "conflict" });
    await openDialog();
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await changedMsg();
    expect(posts()).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("X3: 404 on re-read → reload message, no write", async () => {
    readHandler = async () => res(404, { success: false, error: "file not found" });
    await mountRepaired();
    fireEvent.click(applyBtn());
    await changedMsg();
    expect(posts()).toHaveLength(0);
  });

  it("X4: network failure on re-read → error text, no reload offer, no write", async () => {
    readHandler = async () => {
      throw new Error("net down");
    };
    await mountRepaired();
    fireEvent.click(applyBtn());
    await screen.findByText(/could not apply fix: net down/i, undefined, SLOW);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByTestId("mermaid-apply-reload")).toBeNull();
  });

  for (const status of [403, 500]) {
    it(`X5: ${status} on write → error text, one POST, no reload offer`, async () => {
      writeHandler = async () => res(status, { success: false, error: `status ${status}` });
      await openDialog();
      fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
      await screen.findByText(new RegExp(`could not apply fix: status ${status}`, "i"), undefined, SLOW);
      expect(posts()).toHaveLength(1);
      expect(screen.queryByTestId("mermaid-apply-reload")).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });
  }

  it("X6: fence inside a blockquote → 'cannot be applied', no write", async () => {
    const quoted = `> \`\`\`mermaid\n> ${REPAIRABLE.replace("\n", "\n> ")}\n> \`\`\`\n`;
    readHandler = async () => res(200, { success: true, data: { content: quoted, mtime: MTIME } });
    await mountRepaired();
    fireEvent.click(applyBtn());
    await screen.findByText(/cannot be applied to this block/i, undefined, SLOW);
    expect(posts()).toHaveLength(0);
  });
});
