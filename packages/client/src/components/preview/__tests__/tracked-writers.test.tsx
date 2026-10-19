/**
 * The in-pane repair writers (markup auto-fix, mermaid "Apply fix to file") post
 * through the shared tracked-write helper, so the pane rebaselines from the
 * response and the user's own write never raises the changed-on-disk banner.
 * Outside a session pane they fall back to a plain POST.
 *
 * See change: gate-changed-on-disk-by-content (test-plan #F7, D3).
 */
import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repairMarkdown } from "../../../lib/preview/markup-repair-md.js";
import { MermaidSourceContext, type MermaidSourceInfo } from "../../../lib/preview/mermaid-source-context.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { TrackedFileWriteProvider } from "../../split/tracked-file-write.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { MarkupRepairBanner } from "../MarkupRepairBanner.js";
import { MermaidApplyFix } from "../MermaidApplyFix.js";

const MD = "```sh\necho\n\n# Heading\nbody\n";
const MD_FIXED = "```sh\necho\n```\n\n# Heading\nbody\n";
const MERMAID_MD = "# T\n\n```mermaid\ngraph TD\n  A-->B\n```\n";
const MTIME = 1700000000123.456;
const SLOW = { timeout: 8000 };

const json = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
let readContent: string;

const rawPosts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
const source = (over: Partial<MermaidSourceInfo> = {}): MermaidSourceInfo => ({
  cwd: "/proj",
  path: "docs/n.md",
  kind: "md",
  reload: reload as unknown as () => void,
  ...over,
});

beforeEach(() => {
  __resetEscapeStack();
  reload = vi.fn();
  readContent = MD;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? json(200, { success: true, data: { mtime: MTIME + 1 } })
      : String(url).includes("/api/file/md-read")
        ? json(200, { success: true, data: { content: readContent, mtime: MTIME } })
        : json(404, {}),
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
afterEach(() => vi.unstubAllGlobals());

describe("in-pane repair writers use trackedFileWrite", () => {
  it("F7: the markup auto-fix write goes through the tracked helper with the tab path + payload", async () => {
    const tracked = vi.fn(async (_path: string, _body: Record<string, unknown>) => json(200, { success: true, data: { mtime: 1 } }));
    render(
      <ThemeProvider>
        <TrackedFileWriteProvider value={tracked}>
          <MermaidSourceContext.Provider value={source()}>
            <MarkupRepairBanner
              repairs={repairMarkdown(MD).repairs}
              viewOriginal={false}
              onToggleOriginal={() => {}}
              apply={{ displayed: MD, repair: repairMarkdown }}
            />
          </MermaidSourceContext.Provider>
        </TrackedFileWriteProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("markup-repair-apply"));
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), SLOW);
    expect(tracked).toHaveBeenCalledTimes(1);
    expect(tracked).toHaveBeenCalledWith("docs/n.md", { cwd: "/proj", path: "docs/n.md", content: MD_FIXED, mtime: MTIME });
    expect(rawPosts()).toHaveLength(0); // never a bare fetch POST
  });

  it("F7: the mermaid 'Apply fix to file' write goes through the tracked helper", async () => {
    readContent = MERMAID_MD;
    const tracked = vi.fn(async (_path: string, _body: Record<string, unknown>) => json(200, { success: true, data: { mtime: 1 } }));
    render(
      <ThemeProvider>
        <TrackedFileWriteProvider value={tracked}>
          <MermaidApplyFix
            source={source()}
            ordinal={0}
            originalCode={"graph TD\n  A-->B"}
            fixedSource={"flowchart TD\n  A-->B"}
          />
        </TrackedFileWriteProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("mermaid-apply-fix-button"));
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), SLOW);
    expect(tracked).toHaveBeenCalledTimes(1);
    const [path, body] = tracked.mock.calls[0];
    expect(path).toBe("docs/n.md");
    expect(body).toMatchObject({ cwd: "/proj", path: "docs/n.md", mtime: MTIME });
    expect(String(body.content)).toContain("flowchart TD");
    expect(rawPosts()).toHaveLength(0);
  });

  it("outside a session pane the default is a plain POST", async () => {
    render(
      <ThemeProvider>
        <MermaidSourceContext.Provider value={source()}>
          <MarkupRepairBanner
            repairs={repairMarkdown(MD).repairs}
            viewOriginal={false}
            onToggleOriginal={() => {}}
            apply={{ displayed: MD, repair: repairMarkdown }}
          />
        </MermaidSourceContext.Provider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("markup-repair-apply"));
    await screen.findByRole("dialog", {}, SLOW);
    fireEvent.click(screen.getByTestId("mermaid-apply-confirm"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), SLOW);
    expect(rawPosts()).toHaveLength(1);
  });
});
