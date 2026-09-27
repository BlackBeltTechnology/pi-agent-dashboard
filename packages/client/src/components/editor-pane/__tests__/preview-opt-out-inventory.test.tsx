/**
 * Every file-route requester in `components/preview/` and
 * `components/editor-pane/` opts out of the access-grant dialog unless a
 * provider declares operator provenance (change: surface-denial-remedy-in-previews,
 * design D4; test-plan #E29).
 *
 * Two halves:
 *   1. STATIC — the two directories are enumerated; every bare `fetch(` must be
 *      an exempt non-read route. A new requester that calls the global `fetch`
 *      for a file route fails here without anyone listing it.
 *   2. DYNAMIC — each requester is rendered with NO provider, a live capability
 *      and the real global wrapper installed; every `/api/*` request it makes
 *      must carry `X-Pi-Grant-Channel: ""`.
 */
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../monaco-setup.js", () => ({}));
vi.mock("../../../lib/theme/monaco-theme.js", () => ({ buildMonacoTheme: () => ({ name: "t", data: {} }) }));
vi.mock("@monaco-editor/react", () => ({ __esModule: true, default: () => <div data-testid="monaco" /> }));

import { GRANT_CHANNEL_HEADER, installGrantChannelFetch, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { AsciiDocPreview } from "../../preview/AsciiDocPreview.js";
import { AudioPreview } from "../../preview/AudioPreview.js";
import { DiagramPreview } from "../../preview/DiagramPreview.js";
import { DocxPreview } from "../../preview/DocxPreview.js";
import { EmlPreview } from "../../preview/EmlPreview.js";
import { HtmlPreview } from "../../preview/HtmlPreview.js";
import { ImagePreview } from "../../preview/ImagePreview.js";
import { MarkdownPreview } from "../../preview/MarkdownPreview.js";
import { PptxPreview } from "../../preview/PptxPreview.js";
import { SpreadsheetPreview } from "../../preview/SpreadsheetPreview.js";
import { VideoPreview } from "../../preview/VideoPreview.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { CappedViewer } from "../CappedViewer.js";
import EditableSpreadsheetTab from "../EditableSpreadsheetTab.js";
import MarkdownViewer from "../MarkdownViewer.js";
import MermaidViewer from "../MermaidViewer.js";
import MonacoBuffer from "../MonacoBuffer.js";
import type { ViewerProps } from "../types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIRS = [path.resolve(here, ".."), path.resolve(here, "../../preview")];

/** Bare global `fetch(` calls that are NOT file-route reads, by the route they name. */
const EXEMPT_ROUTES = [
  /\/api\/file\/write/,
  /\/api\/diagram\/render/,
  // TabActions' open-in-system / reveal POSTs: `allowGrant:false` routes that
  // mint no remedy and so can never raise the dialog.
  /fetch\(`\$\{getApiBase\(\)\}\$\{endpoint\}`/,
];

/**
 * Files that request a file route but declare their OWN operator provenance
 * (they open on a click) — covered by their own tests, not by "opts out undeclared".
 */
const DECLARES_PROVENANCE = new Set(["FilePreviewOverlay.tsx", "ImageLightbox.tsx"]);

/** Files whose file-route requests ALWAYS go through `fetchWithoutGrantPrompt` (no provenance). */
const ALWAYS_OPTED_OUT = new Set(["EditorFileTree.tsx"]);

type Case = { file: string; el: () => ReactElement; act?: (c: HTMLElement) => void };
const f = { kind: "file" as const, cwd: "/proj", path: "doc" };
const vp = (p: string, kind = "text") => ({ cwd: "/proj", path: p, kind, mimeType: "x", size: 0 }) as ViewerProps;
const CASES: Case[] = [
  { file: "AsciiDocPreview.tsx", el: () => <AsciiDocPreview target={{ ...f, path: "a.adoc" }} /> },
  { file: "DiagramPreview.tsx", el: () => <DiagramPreview target={{ ...f, path: "a.puml" }} /> },
  { file: "DocxPreview.tsx", el: () => <DocxPreview target={{ ...f, path: "a.docx" }} /> },
  { file: "EmlPreview.tsx", el: () => <EmlPreview target={{ ...f, path: "a.eml" }} /> },
  { file: "HtmlPreview.tsx", el: () => <HtmlPreview target={{ ...f, path: "a.html" }} /> },
  { file: "ImagePreview.tsx", el: () => <ImagePreview target={{ ...f, path: "a.png" }} variant="full" /> },
  { file: "MarkdownPreview.tsx", el: () => <MarkdownPreview target={{ ...f, path: "a.md" }} /> },
  {
    file: "PptxPreview.tsx",
    el: () => <PptxPreview target={{ ...f, path: "a.pptx" }} />,
    act: (c) => c.querySelector("button") && fireEvent.click(c.querySelector("button") as HTMLElement),
  },
  { file: "SpreadsheetPreview.tsx", el: () => <SpreadsheetPreview target={{ ...f, path: "a.csv" }} /> },
  {
    file: "VideoPreview.tsx",
    el: () => <VideoPreview target={{ ...f, path: "a.mp4" }} />,
    act: (c) => fireEvent.error(c.querySelector("video") as HTMLElement),
  },
  {
    file: "AudioPreview.tsx",
    el: () => <AudioPreview target={{ ...f, path: "a.mp3" }} />,
    act: (c) => fireEvent.error(c.querySelector("audio") as HTMLElement),
  },
  { file: "CappedViewer.tsx", el: () => <CappedViewer viewer="image" {...vp("a.png", "image")} /> },
  // EditablePreviewTab's own `/api/file` load runs on entering Edit.
  {
    file: "EditablePreviewTab.tsx",
    el: () => <EditableSpreadsheetTab {...vp("a.csv")} />,
    act: (c) => fireEvent.click(c.querySelector('[data-testid="csv-edit-toggle"]') as HTMLElement),
  },
  { file: "MarkdownViewer.tsx", el: () => <MarkdownViewer {...vp("a.md", "markdown")} /> },
  { file: "MermaidViewer.tsx", el: () => <MermaidViewer {...vp("a.mmd")} /> },
  { file: "MonacoBuffer.tsx", el: () => <MonacoBuffer {...vp("a.ts")} /> },
];

const sources = DIRS.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((n) => /\.(ts|tsx)$/.test(n))
    .map((n) => ({ name: n, text: fs.readFileSync(path.join(dir, n), "utf8") })),
);

/** Files that make a file-route request: a file-route URL plus a request call. */
const requesters = sources.filter(
  ({ text }) =>
    /\/api\/file|\b(rawUrl|renderUrl|readTextUrl|sheetUrl|emlUrl|emlAttachmentUrl|renderedPdfUrl)\(/.test(text) &&
    /\b(fetch|previewFetch|fetchWithoutGrantPrompt|getDocument|denialFetch|useBlobImage|useMediaDenial)\(/.test(text),
);

describe("#E29 static: no file route through the bare global fetch", () => {
  it("every bare fetch( in preview/ and editor-pane/ names an exempt non-read route", () => {
    const offenders: string[] = [];
    for (const { name, text } of sources) {
      for (const m of text.matchAll(/(?<![.\w])fetch\(/g)) {
        const arg = text.slice(m.index ?? 0, (m.index ?? 0) + 120);
        if (!EXEMPT_ROUTES.some((r) => r.test(arg))) offenders.push(`${name}: ${arg.split("\n")[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every requester is exercised below or declares its own provenance", () => {
    const covered = new Set([...CASES.map((c) => c.file), ...DECLARES_PROVENANCE, ...ALWAYS_OPTED_OUT]);
    for (const name of ALWAYS_OPTED_OUT) {
      expect(sources.find((s) => s.name === name)?.text).toContain("fetchWithoutGrantPrompt(");
    }
    // Pure helpers/hooks are exercised THROUGH the components that use them.
    const helpers = new Set(["raw-url.ts", "denial-fetch.ts", "use-blob-image.ts", "use-media-denial.ts", "PdfPreview.tsx"]);
    const missing = requesters.map((r) => r.name).filter((n) => !covered.has(n) && !helpers.has(n));
    expect(missing).toEqual([]);
  });
});

describe("#E29 dynamic: undeclared requesters send the opt-out", () => {
  const seen: Array<{ url: string; header: string | null }> = [];
  beforeAll(() => {
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
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, header: new Headers(init?.headers).get(GRANT_CHANNEL_HEADER) });
      return new Response(JSON.stringify({ success: false, error: "x", denialId: "d", subject: "/d" }), { status: 403 });
    }) as typeof fetch;
    installGrantChannelFetch();
  });
  beforeEach(() => {
    seen.length = 0;
    setGrantChannel("cap-live");
  });
  afterEach(() => cleanup());

  it.each(CASES.map((c) => [c.file, c] as const))("%s", async (_name, c) => {
    const { container } = render(<ThemeProvider>{c.el()}</ThemeProvider>);
    c.act?.(container);
    await waitFor(() => expect(seen.some((s) => s.url.includes("/api/"))).toBe(true));
    const apiCalls = seen.filter((s) => s.url.includes("/api/"));
    expect(apiCalls.every((s) => s.header === "")).toBe(true);
  });
});
