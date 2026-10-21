/**
 * CanvasDriver × useOpenCanvasTarget — provenance per caller, `.html` routed to a
 * static tab, loopback URLs never auto-open, the chip/card tap probes then opens
 * a restricted preset at its declared path.
 * See change: improve-canvas-html-and-url-ux (test-plan #F1, #F4).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CanvasState, EMPTY_CANVAS_STATE } from "../../lib/canvas/canvas-gate.js";
import { CanvasDriver } from "../canvas/CanvasDriver.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { CanvasToolRenderer } from "../tool-renderers/CanvasToolRenderer.js";

let tier: "mobile" | "tablet" | "desktop" = "desktop";
vi.mock("../../hooks/useCanvasTier.js", () => ({ useCanvasTier: () => tier }));

const probe = vi.fn<(port: number, sessionId?: string) => Promise<"iframe" | "not-running" | "not-responding">>();
vi.mock("../../lib/canvas/probe-loopback.js", () => ({
  probeLoopbackServer: (port: number, sessionId?: string) => probe(port, sessionId),
}));

let api: ReturnType<typeof useSplitWorkspace> | null = null;
function Probe() {
  api = useSplitWorkspace();
  return null;
}
let setCanvasState: (s: CanvasState) => void = () => {};
function Harness({ initial }: { initial: CanvasState }) {
  const [state, setState] = useState(initial);
  setCanvasState = setState;
  return (
    <SplitWorkspaceProvider sessionId="sOpen" cwd="/proj" orientation="h">
      <Probe />
      <CanvasDriver state={state} />
    </SplitWorkspaceProvider>
  );
}

const fileState = (path: string, version = 1): CanvasState => ({
  ...EMPTY_CANVAS_STATE,
  target: { kind: "file", cwd: "/proj", path },
  version,
});
const tabs = () => api?.paneState.openFiles ?? [];
const tab = (path: string) => tabs().find((f) => f.path === path);

beforeEach(() => {
  localStorage.clear();
  tier = "desktop";
  api = null;
  probe.mockReset();
});
afterEach(() => cleanup());

describe("F1 — one opener, provenance per caller", () => {
  it("auto-open of an .html file → static tab, agent opener, background (unread)", () => {
    render(<Harness initial={EMPTY_CANVAS_STATE} />);
    act(() => api?.openInSplit("notes.md")); // a reading context
    act(() => setCanvasState(fileState("m/a/index.html")));
    expect(tab("static:/proj/m/a/index.html")).toMatchObject({ viewer: "live-server", autoOpened: true, unread: true });
    expect(tabs()[api?.paneState.activeIndex ?? -1].path).toBe("notes.md");
  });

  it("an .md file auto-opens through openInSplit (no static tab)", () => {
    render(<Harness initial={EMPTY_CANVAS_STATE} />);
    act(() => setCanvasState(fileState("README.md")));
    expect(tab("README.md")).toMatchObject({ autoOpened: true, restrictCsp: true });
    expect(tabs().some((f) => f.path.startsWith("static:"))).toBe(false);
  });

  it("the mobile file chip tap on an .html file is an operator, foreground static open", () => {
    tier = "mobile";
    render(<Harness initial={fileState("m/a/index.html")} />);
    expect(tabs()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("canvas-file-chip"));
    expect(tab("static:/proj/m/a/index.html")).toMatchObject({ autoOpened: false });
    expect(api?.paneState.activeIndex).toBe(0);
  });

  it("a loopback URL target never auto-opens and never probes", () => {
    render(<Harness initial={{ ...EMPTY_CANVAS_STATE, target: { kind: "url", url: "http://localhost:5173/app" }, version: 1 }} />);
    expect(tabs()).toHaveLength(0);
    expect(probe).not.toHaveBeenCalled();
  });

  it("a generic URL still auto-opens through openUrlTarget", () => {
    render(<Harness initial={{ ...EMPTY_CANVAS_STATE, target: { kind: "url", url: "https://example.com/x" }, version: 1 }} />);
    expect(tab("url:https://example.com/x")).toBeTruthy();
  });

  it("the URL confirm chip tap probes, then opens the restricted preset AT ITS PATH", async () => {
    probe.mockResolvedValue("iframe");
    render(
      <Harness
        initial={{ ...EMPTY_CANVAS_STATE, chip: { kind: "server", port: 5173, path: "/app", declarationId: "c2" } }}
      />,
    );
    expect(probe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("canvas-server-chip"));
    await waitFor(() => expect(tab("live:http://127.0.0.1:5173/app")).toBeTruthy());
    expect(probe).toHaveBeenCalledWith(5173, "sOpen");
    // Consent to connecting only → agent provenance → restricted egress in the viewer.
    expect(tab("live:http://127.0.0.1:5173/app")).toMatchObject({ autoOpened: true, viewer: "live-server" });
    expect(api?.paneState.activeIndex).toBe(0); // a tap is foreground
  });

  it("a bare server chip opens the root", async () => {
    probe.mockResolvedValue("iframe");
    render(<Harness initial={{ ...EMPTY_CANVAS_STATE, chip: { kind: "server", port: 4321 } }} />);
    fireEvent.click(screen.getByTestId("canvas-server-chip"));
    await waitFor(() => expect(tab("live:http://127.0.0.1:4321/")).toBeTruthy());
  });

  it("a refused probe shows 'server not running' and opens nothing", async () => {
    probe.mockResolvedValue("not-running");
    render(<Harness initial={{ ...EMPTY_CANVAS_STATE, chip: { kind: "server", port: 4321 } }} />);
    fireEvent.click(screen.getByTestId("canvas-server-chip"));
    expect((await screen.findByTestId("canvas-server-chip-status")).textContent).toBe("Server not running");
    expect(tabs()).toHaveLength(0);
  });
});

describe("F4 — an active URL card click behaves like the confirm chip", () => {
  const renderCard = () =>
    render(
      <SplitWorkspaceProvider sessionId="sCardOpen" cwd="/proj" orientation="h">
        <Probe />
        <CanvasToolRenderer
          toolName="canvas"
          toolCallId="c2"
          status="complete"
          result='{"ok":true}'
          args={{ target: { kind: "url", url: "http://localhost:5173/app" } }}
          context={{ cwd: "/proj", canvas: { key: "server:5173", chipDeclarationId: "c2" } }}
        />
      </SplitWorkspaceProvider>,
    );

  it("live → preset opened at /app, restricted (agent provenance)", async () => {
    probe.mockResolvedValue("iframe");
    renderCard();
    fireEvent.click(screen.getByTestId("canvas-tool-target"));
    await waitFor(() => expect(tabs().map((f) => f.path)).toEqual(["live:http://127.0.0.1:5173/app"]));
    expect(probe).toHaveBeenCalledWith(5173, "sCardOpen");
    expect(tabs()[0].autoOpened).toBe(true);
  });

  it("refused → 'Server not running', no tab", async () => {
    probe.mockResolvedValue("not-running");
    renderCard();
    fireEvent.click(screen.getByTestId("canvas-tool-target"));
    expect((await screen.findByTestId("canvas-tool-status")).textContent).toBe("Server not running");
    expect(tabs()).toHaveLength(0);
  });
});

describe("a card click on an active file card is an operator foreground open", () => {
  it("opens the .html as a static tab with open provenance", () => {
    render(
      <SplitWorkspaceProvider sessionId="sCardFile" cwd="/proj" orientation="h">
        <Probe />
        <CanvasToolRenderer
          toolName="canvas"
          toolCallId="c1"
          status="complete"
          result='{"ok":true}'
          args={{ target: { kind: "file", path: "m/a/index.html" } }}
          context={{ cwd: "/proj", canvas: { key: "file:/proj:m/a/index.html", sourceCallId: "c1" } }}
        />
      </SplitWorkspaceProvider>,
    );
    fireEvent.click(screen.getByTestId("canvas-tool-target"));
    expect(tab("static:/proj/m/a/index.html")).toMatchObject({ autoOpened: false });
    expect(api?.paneState.activeIndex).toBe(0);
  });
});
