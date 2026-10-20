// @vitest-environment jsdom
/**
 * Save mapping (change: edit-office-in-pane-with-craft-web, design D4).
 * Test-plan: #E19 (save routing decision table), save-as dialog, over-cap download offer,
 * Save-target toggle keyed by file, cancelled/failed saves reported back, device download
 * of other formats, busy guard.
 */
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRAFT_WEB_APPS } from "../craft-apps-table.js";
import { routeSave, saveNameKey, siblingName, splitName } from "../save-routing.js";
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

// ---------------------------------------------------------------------------------------------------
// extend-craft-web-to-all-apps (D6, D10, D11)
// ---------------------------------------------------------------------------------------------------

const SOUND = CRAFT_WEB_APPS.soundcraft;

describe("E13 save routing (pure, D6/D10)", () => {
  const raster = { tabPath: "img/photo.jpg", byteLength: 10, maxBytes: 1000, siblingExtensions: [".psd"] };
  it.each([
    ["photo.jpg", "own"],
    ["draft.jpg", "save-as"],
    ["photo.psd", "sibling"],
    ["other.psd", "sibling"],
    ["photo.pdf", "download"],
  ])("photocraft-raster on photo.jpg: %s → %s", (name, expected) => {
    expect(routeSave({ ...raster, suggestedName: name })).toBe(expected);
  });

  it("sibling over the cap → too-large; without siblingExtensions (older runtime, E19) → download", () => {
    expect(routeSave({ ...raster, suggestedName: "photo.psd", byteLength: 2000 })).toBe("too-large");
    expect(routeSave({ ...raster, siblingExtensions: undefined, suggestedName: "photo.psd" })).toBe("download");
  });

  it("siblingName keeps the tab's stem (original case) with the native extension", () => {
    expect(siblingName("img/My Photo.JPG", ".psd")).toBe("My Photo.psd");
  });

  it("inner-title (SoundCraft): first save under a name asks even with a matching stem; remembered → own; other name asks", () => {
    const base = { tabPath: "mix.scraftz", byteLength: 10, maxBytes: 1000, saveName: "inner-title" as const };
    expect(routeSave({ ...base, suggestedName: "mix.scraftz" })).toBe("save-as");
    expect(routeSave({ ...base, suggestedName: "Midnight Groove.scraftz" })).toBe("save-as");
    const remembered = new Set([saveNameKey("Midnight Groove.scraftz")]);
    expect(routeSave({ ...base, suggestedName: "midnight groove.SCRAFTZ", remembered })).toBe("own");
    expect(routeSave({ ...base, suggestedName: "Other.scraftz", remembered })).toBe("save-as");
    expect(routeSave({ ...base, suggestedName: "x.scraftz", byteLength: 2000 })).toBe("too-large");
  });

  it("preview claim → download for every name", () => {
    for (const n of ["sample.dng", "sample.jpg", "x.psd"]) {
      expect(routeSave({ tabPath: "sample.dng", byteLength: 1, maxBytes: 10, preview: true, suggestedName: n })).toBe("download");
    }
  });
});

describe("D10 session-named saves in the host (SoundCraft)", () => {
  const sound = () => mountFrame({ app: SOUND, fh: makeFh({ path: "mix.scraftz", save: vi.fn(async () => ({ ok: true as const, path: "mix.scraftz", mtime: 2, sha1: "b" })) as never }) });

  it("first save asks; Overwrite is remembered for the same suggested name; another name asks again", async () => {
    stubFetch({ status: () => ({ soundcraft: { status: "ok" } }) });
    const m = await sound();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "mix.scraftz", confirmed: false });
    await shimSend(m.iframe, { type: "save", suggestedName: "Midnight Groove.scraftz", bytes: bytesOf(5) });
    expect(m.getByTestId("craft-save-as")).toBeTruthy();
    fireEvent.click(m.getByTestId("craft-save-as-overwrite"));
    await flush();
    expect(m.fh.save).toHaveBeenLastCalledWith(expect.anything(), { target: "overwrite" });
    await shimSend(m.iframe, { type: "save", suggestedName: "Midnight Groove.scraftz", bytes: bytesOf(5) });
    expect(m.queryByTestId("craft-save-as")).toBeNull();
    expect(m.fh.save).toHaveBeenCalledTimes(2);
    expect(m.fh.save).toHaveBeenLastCalledWith(expect.anything(), { target: "overwrite" });
    await shimSend(m.iframe, { type: "save", suggestedName: "Other.scraftz", bytes: bytesOf(5) });
    expect(m.getByTestId("craft-save-as")).toBeTruthy();
  });

  it("a remembered copy answer writes a copy on every save", async () => {
    stubFetch({ status: () => ({ soundcraft: { status: "ok" } }) });
    const m = await sound();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "mix.scraftz", confirmed: false });
    await shimSend(m.iframe, { type: "save", suggestedName: "mix.scraftz", bytes: bytesOf(5) });
    fireEvent.click(m.getByTestId("craft-save-as-copy"));
    await flush();
    await shimSend(m.iframe, { type: "save", suggestedName: "mix.scraftz", bytes: bytesOf(5) });
    expect(m.fh.save.mock.calls.map((c) => (c[1] as { target: string }).target)).toEqual(["copy", "copy"]);
  });
});

describe("E32 session-name hint", () => {
  it("SoundCraft's Save As question explains the session name; WordCraft's has no such line", async () => {
    stubFetch({ status: () => ({ soundcraft: { status: "ok" } }) });
    const s = await mountFrame({ app: SOUND, fh: makeFh({ path: "mix.scraftz" }) });
    await shimSend(s.iframe, { type: "ready" });
    await shimSend(s.iframe, { type: "opened", title: "mix.scraftz", confirmed: false });
    await shimSend(s.iframe, { type: "save", suggestedName: "Midnight Groove.scraftz", bytes: bytesOf(5) });
    expect(s.getByTestId("craft-save-as").textContent).toContain("SoundCraft names saves after the session inside the file, not after mix.scraftz.");
    cleanup();
    stubFetch({});
    const w = await mountFrame();
    await openDoc(w);
    await shimSend(w.iframe, { type: "save", suggestedName: "draft.docx", bytes: bytesOf(5) });
    expect(w.getByTestId("craft-save-as")).toBeTruthy();
    expect(w.queryByTestId("craft-save-as-hint")).toBeNull();
  });
});

describe("D6 native-format sibling in the host (E14, E19, E31, X3)", () => {
  const RASTER = CRAFT_WEB_APPS["photocraft-raster"];
  const okStatus = () => stubFetch({ status: () => ({ photocraft: { status: "ok" } }) });
  async function openPhoto(over: Partial<Parameters<typeof makeFh>[0]> = {}, app = RASTER) {
    const save = vi.fn(async () => ({ ok: true as const, path: "img/photo.psd", mtime: 2, sha1: "b" }));
    const openFile = vi.fn();
    const m = await mountFrame({ app, fh: makeFh({ path: "img/photo.jpg", save: save as never, openFile, ...over }) });
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "photo.jpg", confirmed: true });
    return { m, save, openFile };
  }

  it("E31: dialog copy — title, reason, file names on the create buttons; nothing written before choosing", async () => {
    okStatus();
    const { m, save } = await openPhoto();
    await shimSend(m.iframe, { type: "save", suggestedName: "My Photo.psd", bytes: bytesOf(9) });
    const dlg = m.getByTestId("craft-sibling");
    expect(dlg.textContent).toContain("PhotoCraft saves as .psd");
    expect(dlg.textContent).toContain("Your edits go into a new file next to photo.jpg, which stays unchanged.");
    expect(m.getByTestId("craft-sibling-create-open").textContent).toBe("Create and open photo.psd");
    expect(m.getByTestId("craft-sibling-create").textContent).toBe("Create photo.psd");
    expect(m.getByTestId("craft-sibling-download").textContent).toBe("Download instead");
    expect(m.getByTestId("craft-sibling-cancel")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("Create and open: sibling save, the new file opens in PhotoCraft's .psd claim, the tab stays dirty", async () => {
    okStatus();
    const { m, save, openFile } = await openPhoto();
    await shimSend(m.iframe, { type: "dirty", value: false });
    await shimSend(m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-sibling-create-open"));
    await flush();
    expect(save).toHaveBeenCalledWith(expect.anything(), { target: "sibling", ext: ".psd" });
    expect(openFile).toHaveBeenCalledWith("img/photo.psd", "photocraft");
    expect(m.fh.setDirty.mock.calls.at(-1)?.[0]).toBe(true);
    const r = saveResults(m).at(-1) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true });
    expect(r.own).toBeUndefined();
    await shimSend(m.iframe, { type: "dirty", value: false });
    expect(m.fh.setDirty.mock.calls.at(-1)?.[0]).toBe(true);
  });

  it("E14: Create and open only when the native claim is available; Create / Download instead / Cancel always", async () => {
    okStatus();
    // absent: a raster claim of an app without a native .psd claim
    const lone = { ...RASTER, id: "photocraft", claimId: "lone", siblingExtensions: [".xyz"] };
    const a = await openPhoto({}, lone);
    await shimSend(a.m.iframe, { type: "save", suggestedName: "photo.xyz", bytes: bytesOf(9) });
    expect(a.m.queryByTestId("craft-sibling-create-open")).toBeNull();
    for (const id of ["create", "download", "cancel"]) expect(a.m.getByTestId(`craft-sibling-${id}`)).toBeTruthy();
    cleanup();
    // host cannot open files (older runtime without `openFile`)
    okStatus();
    const b = await openPhoto({ openFile: undefined });
    await shimSend(b.m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    expect(b.m.queryByTestId("craft-sibling-create-open")).toBeNull();
    expect(b.m.getByTestId("craft-sibling-create")).toBeTruthy();
  });

  it("Download instead → device download, no workspace write; Cancel → save-result cancelled", async () => {
    okStatus();
    const { m, save } = await openPhoto();
    await shimSend(m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-sibling-download"));
    await flush();
    expect(download).toHaveBeenCalledWith("photo.psd", expect.anything(), undefined);
    await shimSend(m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-sibling-cancel"));
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(saveResults(m).at(-1)).toMatchObject({ ok: false, error: "cancelled" });
  });

  it("X3 / E31: core 409 → 'too many copies' alert naming the way out + Download instead; save-result ok:false; tab stays dirty", async () => {
    okStatus();
    const save = vi.fn(async () => ({ ok: false as const, reason: "conflict-unresolved" as const, message: "no free name for the copy" }));
    const { m } = await openPhoto({ save: save as never });
    await shimSend(m.iframe, { type: "dirty", value: true });
    await shimSend(m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-sibling-create"));
    await flush();
    const alert = m.getByTestId("craft-sibling-exhausted");
    expect(alert.textContent).toContain("photo.psd and photo-2.psd to photo-99.psd already exist");
    expect(alert.textContent).toContain("Open photo.psd in PhotoCraft to keep editing it in place.");
    fireEvent.click(m.getByTestId("craft-sibling-exhausted-download"));
    expect(download).toHaveBeenCalledWith("photo.psd", expect.anything(), undefined);
    expect(saveResults(m).at(-1)).toMatchObject({ ok: false });
    expect(m.fh.setDirty.mock.calls.at(-1)?.[0]).toBe(true);
  });

  it("E19: a client registry claim without siblingExtensions (older server) → photo.psd downloads, no sibling request", async () => {
    okStatus();
    const old = { ...RASTER, siblingExtensions: [] };
    const { m, save } = await openPhoto({}, old);
    await shimSend(m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    expect(m.queryByTestId("craft-sibling")).toBeNull();
    expect(download).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("observability: validator rejects are counted by the written format", () => {
  it("a rejected sibling save reports the sibling extension (.psd), not the tab's (.jpg)", async () => {
    const f = stubFetch({ status: () => ({ photocraft: { status: "ok" } }) });
    const save = vi.fn(async () => ({ ok: false as const, reason: "rejected" as const, message: "rejected: missing 8BPS signature" }));
    const m = await mountFrame({ app: CRAFT_WEB_APPS["photocraft-raster"], fh: makeFh({ path: "img/photo.jpg", save: save as never, openFile: vi.fn() }) });
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "photo.jpg", confirmed: true });
    await shimSend(m.iframe, { type: "save", suggestedName: "photo.psd", bytes: bytesOf(9) });
    fireEvent.click(m.getByTestId("craft-sibling-create"));
    await flush();
    const events = f.calls.filter((c) => c.url.endsWith("/telemetry")).map((c) => JSON.parse(c.body as string));
    expect(events).toContainEqual({ app: "photocraft", kind: "reject", ext: ".psd" });
  });
});
