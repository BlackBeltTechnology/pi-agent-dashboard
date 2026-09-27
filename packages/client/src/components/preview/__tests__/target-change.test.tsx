/**
 * Target-scoped state resets on a target change (change:
 * surface-denial-remedy-in-previews; step-4.5 review round 1). An explicit ask
 * belongs to ONE target — carrying it to the next would let an undeclared
 * surface load eligibly without a click (fail open).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import { HtmlPreview } from "../HtmlPreview.js";
import { ImagePreview } from "../ImagePreview.js";

const denied = () =>
  new Response(JSON.stringify({ success: false, error: "x", denialId: "d", subject: "/o", promptOutcome: "ineligible" }), {
    status: 403,
  });
const grantHeaderOf = (init?: RequestInit) => new Headers(init?.headers).get("X-Pi-Grant-Channel");

beforeEach(() => {
  setGrantChannel("cap-live");
  URL.createObjectURL = vi.fn(() => "blob:ok");
  URL.revokeObjectURL = vi.fn();
  window.matchMedia = vi.fn((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearGrantChannel();
});

describe("an ask does not carry to the next target", () => {
  it("HtmlPreview: after asking for a.html, b.html loads opted out again", async () => {
    const fetchSpy = vi.fn(async (_u: RequestInfo | URL, _init?: RequestInit) => denied());
    vi.stubGlobal("fetch", fetchSpy);
    const { rerender } = render(<HtmlPreview target={{ kind: "file", cwd: "/p", path: "a.html" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for access" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(grantHeaderOf(fetchSpy.mock.calls[1][1])).toBeNull(); // the ask: eligible
    rerender(<HtmlPreview target={{ kind: "file", cwd: "/p", path: "b.html" }} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    expect(grantHeaderOf(fetchSpy.mock.calls[2][1])).toBe(""); // new target: opted out
  });

  it("FilePreviewOverlay (auto): a replacement target starts un-asked, with no stale denial", async () => {
    const fetchSpy = vi.fn(async (u: RequestInfo | URL, _init?: RequestInit) =>
      String(u).includes("b.txt")
        ? new Response(JSON.stringify({ success: true, data: { type: "file", content: "bee" } }))
        : denied(),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const ui = (path: string) => (
      <ThemeProvider>
        <FilePreviewOverlay cwd="/p" path={path} onClose={() => {}} provenance="auto" />
      </ThemeProvider>
    );
    const { rerender } = render(ui("a.txt"));
    fireEvent.click(await screen.findByRole("button", { name: "Ask for access" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    rerender(ui("b.txt"));
    await screen.findByText("bee");
    expect(screen.queryByTestId("denial-notice")).toBeNull();
    expect(grantHeaderOf(fetchSpy.mock.calls[2][1])).toBe("");
  });
});

describe("ImagePreview full: a decode failure does not stick to the next target", () => {
  it("corrupt a.png → valid b.png renders b", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]), { status: 200 })));
    const { container, rerender } = render(<ImagePreview target={{ kind: "file", cwd: "/p", path: "a.png" }} variant="full" />);
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByTestId("denial-notice")).toBeTruthy();
    rerender(<ImagePreview target={{ kind: "file", cwd: "/p", path: "b.png" }} variant="full" />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("alt")).toBe("b.png"));
    expect(screen.queryByTestId("denial-notice")).toBeNull();
  });
});
