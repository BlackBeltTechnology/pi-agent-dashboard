/**
 * "Apply markup fix to file": verify-before-write, diff confirmation, conflict safety.
 * See change: add-md-adoc-markup-repair (test-plan X1–X5, F9).
 */
import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { repairAsciiDoc } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/asciidoc.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repairMarkdown } from "../../../lib/preview/markup-repair-md.js";
import { MermaidSourceContext, type MermaidSourceInfo } from "../../../lib/preview/mermaid-source-context.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { digestResponse, probe, TrackedProvider } from "./tracked-write-harness.js";
import { act } from "@testing-library/react";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { MarkupRepairBanner } from "../MarkupRepairBanner.js";

const MD = "```sh\necho\n\n# Heading\nbody\n";
const MD_FIXED = "```sh\necho\n```\n\n# Heading\nbody\n";
const ADOC = "= G\n\n----\ncode\n\n== Next\n";
const MTIME = 1700000000123.456;

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
let digestSha = "S";

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

function source(over: Partial<MermaidSourceInfo> = {}): MermaidSourceInfo {
  return { cwd: "/proj", path: "docs/n.md", kind: "md", reload: reload as unknown as () => void, ...over };
}

function mountMd(ctx: MermaidSourceInfo | null = source()) {
  return render(
    <ThemeProvider>
      <MermaidSourceContext.Provider value={ctx}>
        <MarkupRepairBanner
          repairs={repairMarkdown(MD).repairs}
          viewOriginal={false}
          onToggleOriginal={() => {}}
          apply={{ displayed: MD, repair: repairMarkdown }}
        />
      </MermaidSourceContext.Provider>
    </ThemeProvider>,
  );
}

function mountAdoc() {
  return render(
    <ThemeProvider>
      <MermaidSourceContext.Provider value={source({ path: "g.adoc", kind: "adoc" })}>
        <MarkupRepairBanner
          repairs={repairAsciiDoc(ADOC).repairs}
          viewOriginal={false}
          onToggleOriginal={() => {}}
          apply={{ renderMtime: MTIME, repair: repairAsciiDoc }}
        />
      </MermaidSourceContext.Provider>
    </ThemeProvider>,
  );
}

const applyBtn = () => screen.getByTestId("markup-repair-apply") as HTMLButtonElement;
const SLOW = { timeout: 8000 };

beforeEach(() => {
  __resetEscapeStack();
  reload = vi.fn();
  readHandler = async () => res(200, { success: true, data: { content: MD, mtime: MTIME } });
  writeHandler = async () => res(200, { success: true, data: { mtime: MTIME + 1 } });
  digestSha = "S";
  probe.cleared = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? writeHandler()
      : String(url).includes("/api/file/md-read")
        ? readHandler()
        : String(url).includes("/api/file/digest")
          ? digestResponse(digestSha)
          : res(404, {}),
  );
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apply markup fix", () => {
  it("X1: writes repair(content).source with the read mtime, then reloads once", async () => {
    mountMd();
    fireEvent.click(applyBtn());
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), SLOW);
    expect(posts()).toHaveLength(1);
    const body = JSON.parse(String((posts()[0][1] as RequestInit).body));
    expect(body).toEqual({ cwd: "/proj", path: "docs/n.md", content: MD_FIXED, mtime: MTIME });
  });

  it("X2: a one-byte content difference writes nothing, shows 'file changed — reload', no dialog", async () => {
    readHandler = async () => res(200, { success: true, data: { content: MD + " ", mtime: MTIME } });
    mountMd();
    fireEvent.click(applyBtn());
    await waitFor(() => expect(screen.getByTestId("markup-repair-changed").textContent).toMatch(/file changed — reload/i), SLOW);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("X3: adoc — md-read mtime differing from the render mtime writes nothing", async () => {
    readHandler = async () => res(200, { success: true, data: { content: ADOC, mtime: MTIME + 5 } });
    mountAdoc();
    fireEvent.click(applyBtn());
    await waitFor(() => expect(screen.getByTestId("markup-repair-changed")).toBeTruthy(), SLOW);
    expect(posts()).toHaveLength(0);
  });

  it("X3b: adoc — matching mtime writes repairAsciiDoc(content).source", async () => {
    readHandler = async () => res(200, { success: true, data: { content: ADOC, mtime: MTIME } });
    mountAdoc();
    fireEvent.click(applyBtn());
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(posts()).toHaveLength(1), SLOW);
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).content).toBe(repairAsciiDoc(ADOC).source);
  });

  it("X4: a 409 on write → exactly one POST, 'file changed — reload', banner stays", async () => {
    writeHandler = async () => res(409, { success: false, error: "conflict" });
    mountMd();
    fireEvent.click(applyBtn());
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(screen.getByTestId("markup-repair-changed")).toBeTruthy(), SLOW);
    expect(posts()).toHaveLength(1);
    expect(screen.getByTestId("markup-repair-banner")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("X5: Cancel and Escape both close the dialog without writing", async () => {
    mountMd();
    fireEvent.click(applyBtn());
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(applyBtn());
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts()).toHaveLength(0);
    expect(screen.getByTestId("markup-repair-banner")).toBeTruthy();
  });

  it("F9: unsaved edits (isDirty) disable the action with an explanation", () => {
    mountMd(source({ isDirty: true }));
    expect(applyBtn().disabled).toBe(true);
    expect(screen.getByTestId("markup-repair-banner").textContent).toMatch(/save or discard edits first/i);
    expect(applyBtn().getAttribute("aria-describedby")).toBeTruthy();
  });

  it("no apply action without a file identity", () => {
    mountMd(null);
    expect(screen.queryByTestId("markup-repair-apply")).toBeNull();
    expect(screen.getByTestId("markup-repair-view-original")).toBeTruthy();
  });
});

describe("tracked save (gate-changed-on-disk-by-content F7)", () => {
  it("F7: the repair write goes through trackedFileWrite — its own file_changed raises no banner", async () => {
    const ui = (candidate?: number) => (
      <TrackedProvider path="docs/n.md" candidate={candidate}>
        <ThemeProvider>
          <MermaidSourceContext.Provider value={source()}>
            <MarkupRepairBanner
              repairs={repairMarkdown(MD).repairs}
              viewOriginal={false}
              onToggleOriginal={() => {}}
              apply={{ displayed: MD, repair: repairMarkdown }}
            />
          </MermaidSourceContext.Provider>
        </ThemeProvider>
      </TrackedProvider>
    );
    const utils = render(ui());
    await act(async () => {
      await probe.ctx?.captureBaseline("docs/n.md"); // baseline S
    });
    writeHandler = async () => res(200, { success: true, data: { mtime: MTIME + 1, size: 9, sha1: "T" } });
    fireEvent.click(applyBtn());
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), SLOW);
    // The watcher reports the write; the disk now holds T (the baseline the save set).
    digestSha = "T";
    utils.rerender(ui(1));
    await waitFor(() => expect(probe.cleared).toContainEqual(["docs/n.md", 1]), SLOW);
    expect(probe.ctx?.verifiedChanged.has("docs/n.md")).toBe(false);
  });
});
