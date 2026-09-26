/**
 * Image transport for the grant dialog: `fetch` → `blob:` for a same-origin
 * API base, blob ownership, the cross-origin `<img>` fallback, the silent
 * inline variant, and the lightbox's foreign sources (change:
 * surface-denial-remedy-in-previews, design D1; test-plan #E39-#E42, #X4).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let apiBase = "";
vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => apiBase }));

import { ImageLightbox } from "../preview/ImageLightbox.js";
import { ImagePreview } from "../preview/ImagePreview.js";

const target = { kind: "file" as const, cwd: "/p", path: "a.png" };
let created: string[];
let revoked: string[];

beforeEach(() => {
  apiBase = "";
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:made-${++n}`;
    created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const png = () => new Response(new Blob(["png"]), { status: 200 });

describe("#E39 image blob ownership", () => {
  it("(a) a caller srcUrl is never fetched and never revoked", () => {
    const fetchSpy = vi.fn(async () => png());
    vi.stubGlobal("fetch", fetchSpy);
    const { unmount, container } = render(<ImagePreview target={target} variant="full" srcUrl="blob:x" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:x");
    unmount();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(revoked).not.toContain("blob:x");
  });

  it("(b) every URL it created is revoked exactly once, on replacement and on unmount", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => png()));
    const { rerender, unmount, container } = render(<ImagePreview target={target} variant="full" />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:made-1"));
    rerender(<ImagePreview target={{ ...target, path: "b.png" }} variant="full" />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:made-2"));
    unmount();
    expect(created).toEqual(["blob:made-1", "blob:made-2"]);
    expect(revoked.sort()).toEqual(["blob:made-1", "blob:made-2"]);
  });
});

describe("#E40 a cross-origin API base keeps <img>", () => {
  it("no fetch; a load failure shows the unknown variant with no reason and no control", () => {
    apiBase = "http://other:8000";
    const fetchSpy = vi.fn(async () => png());
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<ImagePreview target={target} variant="full" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^http:\/\/other:8000\/api\/file\/raw\?/);
    fireEvent.error(img as HTMLImageElement);
    const notice = screen.getByTestId("denial-notice");
    expect(notice.getAttribute("data-outcome")).toBe("unknown");
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("#E41 the inline variant stays silent", () => {
  it("renders a plain <img>, and no notice after a failure", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const { container } = render(<ImagePreview target={target} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.queryByTestId("denial-notice")).toBeNull();
  });
});

describe("#X4 network failure", () => {
  it("shows the load-failure message, with no access wording", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<ImagePreview target={target} variant="full" />);
    const notice = await screen.findByTestId("denial-notice");
    expect(notice.getAttribute("data-outcome")).toBe("error");
    expect(notice.textContent).toMatch(/Couldn't load a\.png/);
    expect(notice.textContent).not.toMatch(/access|grant|prompt/i);
  });
});

describe("#E42 a foreign lightbox source is unchanged", () => {
  it("(a) a data: source is never fetched", () => {
    const fetchSpy = vi.fn(async () => png());
    vi.stubGlobal("fetch", fetchSpy);
    render(<ImageLightbox src="data:image/png;base64,AAAA" alt="a" onClose={() => {}} />);
    expect(screen.getByTestId("lightbox-image").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("(b) a remote source falls back to fallbackSrc on failure, with no fetch", () => {
    const fetchSpy = vi.fn(async () => png());
    vi.stubGlobal("fetch", fetchSpy);
    render(<ImageLightbox src="https://example.com/x.png" fallbackSrc="data:image/png;base64,BBBB" alt="a" onClose={() => {}} />);
    fireEvent.error(screen.getByTestId("lightbox-image"));
    expect(screen.getByTestId("lightbox-image").getAttribute("src")).toBe("data:image/png;base64,BBBB");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a same-origin /api/file/raw source loads through fetch → blob:, operator-declared", async () => {
    const fetchSpy = vi.fn(async (_u: RequestInfo | URL, _init?: RequestInit) => png());
    vi.stubGlobal("fetch", fetchSpy);
    render(<ImageLightbox src="/api/file/raw?cwd=%2Fp&path=a.png" alt="a" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("lightbox-image").getAttribute("src")).toBe("blob:made-1"));
    // Operator provenance: the request is NOT opted out (no empty grant header).
    const init = fetchSpy.mock.calls[0][1];
    expect(new Headers(init?.headers).get("X-Pi-Grant-Channel")).toBeNull();
  });
});
