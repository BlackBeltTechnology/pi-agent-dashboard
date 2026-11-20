/**
 * EmlPreview attachments under the enforcing strict CSP (change: enforce-strict-csp-default).
 *
 * `connect-src 'self' ws: wss:` refuses a `blob:` URL, so a PDF attachment must reach pdf.js as the
 * same-origin `/api/file/eml-attachment` URL (pdf.js fetches it itself), never as a `blob:` URL.
 * Images keep the `blob:` path: `img-src` allows `blob:` and an `<img>` load is not a connect.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../PdfPreview.js", () => ({
  default: ({ srcUrl }: { srcUrl?: string }) => <div data-testid="pdf-stub" data-src={srcUrl} />,
}));
vi.mock("../ImagePreview.js", () => ({
  ImagePreview: ({ srcUrl }: { srcUrl?: string }) => <div data-testid="img-stub" data-src={srcUrl} />,
}));

import { EmlPreview } from "../EmlPreview.js";

const target = { kind: "file" as const, cwd: "/proj", path: "mail.eml" };
const att = (index: number, filename: string, mimeType: string) => ({ index, filename, mimeType, size: 10, contentId: null, isInline: false });
const EML = {
  headers: { from: "a@x", to: "b@x", cc: "", subject: "s", date: "d" },
  html: "<p>hi</p>",
  text: "hi",
  attachments: [att(0, "report.pdf", "application/pdf"), att(1, "pic.png", "image/png")],
  hasRemote: false,
};

let fetched: string[];
let created: number;

function setup() {
  fetched = [];
  created = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url.includes("/api/file/eml?")) return new Response(JSON.stringify({ success: true, data: EML }), { status: 200 });
    return new Response(new Blob(["bytes"]), { status: 200 });
  }) as typeof fetch;
  URL.createObjectURL = vi.fn(() => `blob:test/${++created}`);
  URL.revokeObjectURL = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function expand(filename: string) {
  const row = (await screen.findAllByTestId("eml-attachment")).find((r) => r.textContent?.includes(filename))!;
  fireEvent.click(row.querySelector('[data-testid="eml-attachment-expand"]')!);
}

describe("EmlPreview attachments", () => {
  it("a PDF attachment mounts PdfPreview on the same-origin attachment URL, never a blob: URL", async () => {
    setup();
    render(<EmlPreview target={target} />);
    await expand("report.pdf");
    const stub = await screen.findByTestId("pdf-stub");
    expect(stub.getAttribute("data-src")).toBe("/api/file/eml-attachment?cwd=%2Fproj&path=mail.eml&index=0");
    expect(stub.getAttribute("data-src")).not.toMatch(/^blob:/);
    // The client did not pre-fetch the PDF bytes itself (pdf.js does, same-origin).
    expect(fetched.filter((u) => u.includes("eml-attachment"))).toEqual([]);
  });

  it("an image attachment keeps the blob: URL path", async () => {
    setup();
    render(<EmlPreview target={target} />);
    await expand("pic.png");
    const stub = await screen.findByTestId("img-stub");
    await waitFor(() => expect(stub.getAttribute("data-src")).toMatch(/^blob:/));
    expect(fetched.some((u) => u.includes("eml-attachment") && u.includes("index=1"))).toBe(true);
  });
});
