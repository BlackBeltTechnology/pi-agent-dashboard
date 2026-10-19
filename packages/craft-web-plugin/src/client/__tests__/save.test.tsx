// @vitest-environment jsdom
/**
 * Save mapping (change: edit-office-in-pane-with-craft-web, design D4).
 * Test-plan: #E19 (save routing decision table), save-as dialog, over-cap download offer,
 * Save-target toggle keyed by file, cancelled/failed saves reported back, device download
 * of other formats, busy guard.
 */
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeSave, splitName } from "../save-routing.js";
import { __resetSaveTargetsForTests } from "../save-target-store.js";
import { bytesOf, flush, makeFh, mountFrame, openDoc, saveResults, shimSend, stubFetch } from "./test-utils.js";

const download = vi.hoisted(() => vi.fn());
vi.mock("../device-download.js", async (orig) => ({ ...(await orig<typeof import("../device-download.js")>()), downloadToDevice: download }));

const DOCX_CAP = 40 * 1024 * 1024;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  download.mockReset();
  __resetSaveTargetsForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("routeSave (pure)", () => {
  const base = { tabPath: "docs/report.docx", byteLength: 10, maxBytes: DOCX_CAP };
  it.each([
    ["report.docx", "own"],
    ["REPORT.DOCX", "own"],
    ["Rep\u006Frt.docx", "own"],
    ["draft.docx", "save-as"],
    ["report.pdf", "download"],
    ["report.docx.pdf", "download"],
  ])("%s → %s", (name, expected) => {
    expect(routeSave({ ...base, suggestedName: name })).toBe(expected);
  });

  it("over the cap: workspace-bound routes become too-large; a device download is unaffected", () => {
    const big = { ...base, byteLength: DOCX_CAP + 1 };
    expect(routeSave({ ...big, suggestedName: "report.docx" })).toBe("too-large");
    expect(routeSave({ ...big, suggestedName: "draft.docx" })).toBe("too-large");
    expect(routeSave({ ...big, suggestedName: "report.pdf" })).toBe("download");
  });

  it("stems are compared NFC + lower-case", () => {
    const decomposed = "re\u0301sume\u0301.docx"; // é as e + combining acute
    const composed = "r\u00e9sum\u00e9.docx";
    expect(splitName(decomposed)).toEqual(splitName(composed));
    expect(routeSave({ ...base, tabPath: composed, suggestedName: decomposed.toUpperCase() })).toBe("own");
  });

  it("path separators in the suggested name do not change the stem", () => {
    expect(routeSave({ ...base, suggestedName: "C:\\tmp\\report.docx" })).toBe("own");
  });
});

describe("E19 save routing in the host", () => {
  it.each([["report.docx"], ["REPORT.DOCX"]])("%s, target overwrite → props.save(overwrite), save-result ok", async (name) => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    const bytes = bytesOf(100);
    await shimSend(m.iframe, { type: "save", suggestedName: name, bytes });
    expect(m.fh.save).toHaveBeenCalledTimes(1);
    expect(m.fh.save).toHaveBeenCalledWith(expect.anything(), { target: "overwrite" });
    expect((m.fh.save.mock.calls[0][0] as ArrayBuffer).byteLength).toBe(100);
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: true })]);
    expect(download).not.toHaveBeenCalled();
  });

  it("target copy → props.save(copy)", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    fireEvent.click(m.getByTestId("craft-save-target-copy"));
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(9) });
    expect(m.fh.save).toHaveBeenCalledWith(expect.anything(), { target: "copy" });
  });

  it("different stem → dialog; nothing written before choosing; Save as copy → props.save(copy)", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "draft.docx", bytes: bytesOf(9) });
    const dlg = m.getByTestId("craft-save-as");
    expect(dlg.textContent).toContain("WordCraft wants to save as draft.docx");
    expect(m.getByTestId("craft-save-as-copy").textContent).toBe("Save as copy next to report.docx");
    expect(m.getByTestId("craft-save-as-overwrite").textContent).toBe("Overwrite report.docx");
    expect(m.fh.save).not.toHaveBeenCalled();
    expect(saveResults(m)).toHaveLength(0);
    fireEvent.click(m.getByTestId("craft-save-as-copy"));
    await flush();
    expect(m.fh.save).toHaveBeenCalledWith(expect.anything(), { target: "copy" });
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: true })]);
    expect(m.queryByTestId("craft-save-as")).toBeNull();
  });

  it("dialog Overwrite → props.save(overwrite) regardless of the toggle", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    fireEvent.click(m.getByTestId("craft-save-target-copy"));
    await shimSend(m.iframe, { type: "save", suggestedName: "draft.docx", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-save-as-overwrite"));
    await flush();
    expect(m.fh.save).toHaveBeenCalledWith(expect.anything(), { target: "overwrite" });
  });

  it("dialog Cancel → no write, save-result ok:false (app keeps the doc unsaved)", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "draft.docx", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-save-as-cancel"));
    await flush();
    expect(m.fh.save).not.toHaveBeenCalled();
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: false, error: "cancelled" })]);
  });

  it(".pdf → device download from the host, no props.save, no dialog, save-result ok", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.pdf", mime: "application/pdf", bytes: bytesOf(50) });
    expect(download).toHaveBeenCalledWith("report.pdf", expect.anything(), "application/pdf");
    expect(m.fh.save).not.toHaveBeenCalled();
    expect(m.queryByTestId("craft-save-as")).toBeNull();
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: true })]);
  });

  it("> cap → no write, save-result ok:false + explicit download offer of those bytes", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(DOCX_CAP + 1) });
    expect(m.fh.save).not.toHaveBeenCalled();
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: false, error: "too-large" })]);
    expect(m.getByTestId("craft-too-large").textContent).toContain("too large");
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(m.getByTestId("craft-download-offer"));
    expect(download).toHaveBeenCalledWith("report.docx", expect.anything(), undefined);
    expect((download.mock.calls[0][1] as ArrayBuffer).byteLength).toBe(DOCX_CAP + 1);
  });

  it("props.save failure → save-result ok:false with the reason, message shown; cancelled is silent", async () => {
    stubFetch({});
    const fh = makeFh({
      save: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "conflict-unresolved", message: "changed on disk" })
        .mockResolvedValueOnce({ ok: false, reason: "cancelled", message: "" }) as never,
    });
    const m = await mountFrame({ fh });
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(saveResults(m).at(-1)).toEqual(expect.objectContaining({ ok: false, error: "conflict-unresolved" }));
    expect(m.getByTestId("craft-save-error").textContent).toContain("changed on disk");
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(saveResults(m).at(-1)).toEqual(expect.objectContaining({ ok: false, error: "cancelled" }));
  });

  it("a rejected props.save promise is reported as ok:false, never an unhandled rejection", async () => {
    stubFetch({});
    const fh = makeFh({ save: vi.fn().mockRejectedValue(new Error("net")) as never });
    const m = await mountFrame({ fh });
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: false, error: "rejected" })]);
  });

  it("a second save while one is pending is refused (busy), not interleaved", async () => {
    stubFetch({});
    let release: (v: unknown) => void = () => {};
    const fh = makeFh({ save: vi.fn(() => new Promise((r) => (release = r))) as never });
    const m = await mountFrame({ fh });
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(fh.save).toHaveBeenCalledTimes(1);
    expect(saveResults(m)).toEqual([expect.objectContaining({ ok: false, error: "busy" })]);
    release({ ok: true, path: "p", mtime: 1, sha1: "x" });
    await flush();
    expect(saveResults(m).at(-1)).toEqual(expect.objectContaining({ ok: true }));
  });

  it("a save before the document is open is ignored", async () => {
    stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(m.fh.save).not.toHaveBeenCalled();
  });
});

describe("Save-target toggle", () => {
  it("defaults to overwrite, is aria-pressed, and is keyed by cwd+path (tabs on the same file agree)", async () => {
    stubFetch({});
    const a = await mountFrame();
    expect(a.getByTestId("craft-save-target-overwrite").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(a.getByTestId("craft-save-target-copy"));
    expect(a.getByTestId("craft-save-target-copy").getAttribute("aria-pressed")).toBe("true");
    cleanup();
    // same file, new instance → remembered
    const b = await mountFrame();
    expect(b.getByTestId("craft-save-target-copy").getAttribute("aria-pressed")).toBe("true");
    cleanup();
    // another file → default
    const c = await mountFrame({ fh: makeFh({ path: "docs/other.docx" }) });
    expect(c.getByTestId("craft-save-target-overwrite").getAttribute("aria-pressed")).toBe("true");
  });
});
