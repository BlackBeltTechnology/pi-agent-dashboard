/**
 * FileHandlerHost services: snapshot bracket (X1–X3), first-overwrite notice (X8),
 * conflict dialog (X7), status → reason mapping, own-save tracking.
 * See change: add-editor-pane-file-handlers (test-plan X1, X2, X3, X7, X8).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { sha1Hex } from "../../../../lib/util/sha1.js";
import { createHostApi } from "../FileHandlerHost.js";
import { FileHandlerLayer } from "../FileHandlerLayer.js";
import { fileHandlerStore } from "../file-handler-store.js";
import { enc, installFetch, makeClaim } from "./harness.js";

const originalFetch = globalThis.fetch;
const KEY = "s1␟/proj␟report.docx␟demo/word";

type Ws = Parameters<typeof createHostApi>[0]["ws"];
const mkWs = () => {
  const ws = {
    sessionId: "s1",
    setBaseline: vi.fn(),
    trackedFileWrite: vi.fn((_p: string, run: (s: AbortSignal) => Promise<unknown>) => run(new AbortController().signal)),
  };
  return ws as unknown as ReturnType<Ws> & typeof ws;
};

function setup(claimOver = {}, ws: ReturnType<Ws> = null) {
  fileHandlerStore.activate({ key: KEY, sessionId: "s1", cwd: "/proj", path: "report.docx", claim: makeClaim(claimOver) });
  return createHostApi({ store: fileHandlerStore, inst: () => fileHandlerStore.get(KEY)!, ws: () => ws });
}
const bytes = enc("edited");

beforeEach(() => {
  fileHandlerStore.reset();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("snapshot (digest bracket)", () => {
  it("X1: digest ≠ digest every attempt → rejects after 3 retries, never resolves mixed bytes", async () => {
    const body = enc("hello");
    const log = installFetch({
      digest: (n) => ({ size: 5, sha1: n % 2 === 1 ? "1".repeat(40) : sha1Hex(body) }),
      raw: () => body,
    });
    const api = setup();
    await expect(api.snapshot()).rejects.toMatchObject({ reason: "rejected" });
    expect(log.count("/api/file/raw")).toBe(3);
    expect(log.count("/api/file/digest")).toBe(6);
  });

  it("X1b: bytes whose hash differs from the digest also retry", async () => {
    const log = installFetch({ digest: () => ({ size: 5, sha1: "2".repeat(40) }), raw: () => enc("hello") });
    await expect(setup().snapshot()).rejects.toBeTruthy();
    expect(log.count("/api/file/raw")).toBe(3);
  });

  it("X2: an mtime-only change between digests resolves on the first attempt and sets the baseline", async () => {
    const body = enc("hello");
    const sha = sha1Hex(body);
    const log = installFetch({ digest: (n) => ({ size: 5, sha1: sha, mtime: n }), raw: () => body });
    const ws = mkWs();
    const api = setup({}, ws);
    const snap = await api.snapshot();
    expect(log.count("/api/file/raw")).toBe(1);
    expect(snap).toMatchObject({ sha1: sha, size: 5, mtime: 2 });
    expect(new Uint8Array(snap.bytes)).toEqual(new Uint8Array(body));
    expect(ws.setBaseline).toHaveBeenCalledWith("report.docx", sha);
  });

  it("X3: size above maxBytes rejects too-large with no raw and no /api/file request, and marks the mode unavailable", async () => {
    const log = installFetch({ digest: () => ({ size: 11, sha1: "3".repeat(40) }) });
    const api = setup({ maxBytes: 10 });
    await expect(api.snapshot()).rejects.toMatchObject({ reason: "too-large" });
    expect(log.count("/api/file/raw")).toBe(0);
    expect(log.count("/api/file")).toBe(0);
    expect(fileHandlerStore.get(KEY)?.unavailableLimit).toBe(10);
  });
});

describe("setDirty", () => {
  it("starts unknown, accepts true/false/unknown and ignores junk", () => {
    const api = setup();
    expect(fileHandlerStore.get(KEY)?.dirty).toBe("unknown");
    api.setDirty(false);
    expect(fileHandlerStore.get(KEY)?.dirty).toBe(false);
    api.setDirty(true);
    expect(fileHandlerStore.get(KEY)?.dirty).toBe(true);
    api.setDirty("nope" as unknown as boolean);
    expect(fileHandlerStore.get(KEY)?.dirty).toBe(true);
  });
});

async function snapshotThen(api: ReturnType<typeof setup>) {
  await api.snapshot();
}

describe("save: status mapping and own-save tracking", () => {
  it("overwrite goes through trackedFileWrite with the snapshot sha as expectSha1; copy does not", async () => {
    const log = installFetch();
    const ws = mkWs();
    const api = setup({}, ws);
    await snapshotThen(api);
    const ok = await api.save(bytes, { target: "overwrite" });
    expect(ok).toMatchObject({ ok: true, path: "report.docx" });
    expect(ws.trackedFileWrite).toHaveBeenCalledTimes(1);
    expect(ws.trackedFileWrite.mock.calls[0][0]).toBe("report.docx");
    expect(log.writes[0].searchParams.get("expectSha1")).toBe(sha1Hex(enc("hello")));
    expect(log.writes[0].searchParams.get("claim")).toBe("demo/word");
    expect(log.writes[0].searchParams.get("mode")).toBe("overwrite");
    const copy = await api.save(bytes, { target: "copy" });
    expect(copy.ok).toBe(true);
    expect(ws.trackedFileWrite).toHaveBeenCalledTimes(1);
    expect(log.writes[1].searchParams.get("mode")).toBe("copy");
    expect(log.writes[1].searchParams.has("expectSha1")).toBe(false);
  });

  it("the next overwrite expects the sha of the previous successful save", async () => {
    const log = installFetch({ write: () => ({ status: 200, body: { success: true, data: { mtime: 2, sha1: "a".repeat(40), path: "report.docx" } } }) });
    const api = setup();
    await snapshotThen(api);
    await api.save(bytes, { target: "overwrite" });
    await api.save(bytes, { target: "overwrite" });
    expect(log.writes[1].searchParams.get("expectSha1")).toBe("a".repeat(40));
  });

  it.each([
    [413, { success: false, error: "too big" }, "too-large"],
    [422, { success: false, error: "bad docx" }, "rejected"],
    [503, { success: false, error: "busy", retryable: true }, "busy"],
    [503, { success: false, error: "not loaded" }, "rejected"],
    [403, { success: false, error: "no" }, "rejected"],
    [400, { success: false, error: "no token" }, "rejected"],
  ])("maps %i → %s", async (status, body, reason) => {
    installFetch({ write: () => ({ status, body }) });
    const api = setup();
    await snapshotThen(api);
    expect(await api.save(bytes, { target: "overwrite" })).toMatchObject({ ok: false, reason });
  });

  it("rejects a body above the claim limit locally (too-large) and a save without a snapshot", async () => {
    const log = installFetch();
    const api = setup({ maxBytes: 3 });
    expect(await api.save(bytes, { target: "overwrite" })).toMatchObject({ ok: false, reason: "too-large" });
    fileHandlerStore.reset();
    const api2 = setup({ maxBytes: 100 });
    expect(await api2.save(bytes, { target: "overwrite" })).toMatchObject({ ok: false, reason: "rejected" });
    expect(log.writes).toHaveLength(0);
  });

  it("a second save while one is in flight reports busy", async () => {
    let release!: () => void;
    installFetch();
    const api = setup();
    await snapshotThen(api);
    const slow = new Promise<void>((r) => {
      release = r;
    });
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (...a: Parameters<typeof fetch>) => {
      await slow;
      return orig(...a);
    }) as unknown as typeof fetch;
    const first = api.save(bytes, { target: "overwrite" });
    expect(await api.save(bytes, { target: "overwrite" })).toMatchObject({ ok: false, reason: "busy" });
    release();
    expect((await first).ok).toBe(true);
  });
});

describe("first overwrite notice (X8)", () => {
  it("Cancel → cancelled, nothing written; Overwrite → written; third save asks no more", async () => {
    const log = installFetch();
    render(<FileHandlerLayer />);
    const api = setup({ firstOverwriteNotice: "Heads up: this replaces the file" });
    await snapshotThen(api);

    let p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-first-overwrite");
    expect(screen.getByText("Heads up: this replaces the file")).toBeTruthy();
    fireEvent.click(screen.getByTestId("file-handler-first-overwrite-cancel"));
    expect(await p).toMatchObject({ ok: false, reason: "cancelled" });
    expect(log.writes).toHaveLength(0);

    p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-first-overwrite");
    fireEvent.click(screen.getByTestId("file-handler-first-overwrite-overwrite"));
    expect((await p).ok).toBe(true);
    expect(log.writes).toHaveLength(1);

    expect((await api.save(bytes, { target: "overwrite" })).ok).toBe(true);
    expect(screen.queryByTestId("file-handler-first-overwrite")).toBeNull();
    expect(log.writes).toHaveLength(2);
  });

  it("Save as copy from the notice writes a sibling, toasts with Open, and the instance stays bound", async () => {
    const log = installFetch({ write: (_n, u) => ({ status: 200, body: { success: true, data: { mtime: 2, sha1: "c".repeat(40), path: u.searchParams.get("mode") === "copy" ? "report.demo.docx" : "report.docx" } } }) });
    render(<FileHandlerLayer />);
    const api = setup({ firstOverwriteNotice: "Heads up" });
    await snapshotThen(api);
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-first-overwrite");
    fireEvent.click(screen.getByTestId("file-handler-first-overwrite-copy"));
    expect(await p).toMatchObject({ ok: true, path: "report.demo.docx" });
    expect(log.writes[0].searchParams.get("mode")).toBe("copy");
    await screen.findByText(/report\.demo\.docx/);
    expect(screen.getByTestId("toast-action").textContent).toBe("Open");
    expect(fileHandlerStore.get(KEY)).toBeTruthy();
    // The first-overwrite notice was NOT consumed by choosing copy.
    expect(fileHandlerStore.get(KEY)?.firstOverwriteDone).toBe(false);
  });
});

describe("conflict dialog (X7)", () => {
  const conflict = (n: number, _u: URL, _i: RequestInit) =>
    n === 1 ? { status: 409, body: { success: false, error: "changed", sha1: "d".repeat(40), mtime: 9 } } : { status: 200, body: { success: true, data: { mtime: 3, sha1: "e".repeat(40), path: "report.docx" } } };

  it("Cancel resolves cancelled and writes nothing more", async () => {
    const log = installFetch({ write: conflict });
    render(<FileHandlerLayer />);
    const api = setup();
    await snapshotThen(api);
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-conflict");
    fireEvent.click(screen.getByTestId("file-handler-conflict-cancel"));
    expect(await p).toMatchObject({ ok: false, reason: "cancelled" });
    expect(log.writes).toHaveLength(1);
  });

  it("Overwrite anyway warns, re-reads the digest and re-sends with the new expectSha1", async () => {
    let digestN = 0;
    const log = installFetch({
      write: conflict,
      digest: () => ({ size: 5, sha1: ++digestN <= 2 ? sha1Hex(enc("hello")) : "9".repeat(40) }),
    });
    render(<FileHandlerLayer />);
    const api = setup();
    await snapshotThen(api);
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-conflict");
    expect(screen.getByTestId("file-handler-conflict-warning").textContent).toMatch(/currently on disk/);
    const before = log.count("/api/file/digest");
    fireEvent.click(screen.getByTestId("file-handler-conflict-overwrite"));
    expect((await p).ok).toBe(true);
    expect(log.count("/api/file/digest")).toBe(before + 1);
    expect(log.writes[1].searchParams.get("expectSha1")).toBe("9".repeat(40));
  });

  it("Save as copy writes a sibling and resolves ok with the copy path", async () => {
    const log = installFetch({
      write: (n, u) => (n === 1 ? { status: 409, body: { success: false, error: "changed", sha1: "d".repeat(40) } } : { status: 200, body: { success: true, data: { mtime: 3, sha1: "e".repeat(40), path: u.searchParams.get("mode") === "copy" ? "report.demo.docx" : "report.docx" } } }),
    });
    render(<FileHandlerLayer />);
    const api = setup();
    await snapshotThen(api);
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-conflict");
    fireEvent.click(screen.getByTestId("file-handler-conflict-copy"));
    expect(await p).toMatchObject({ ok: true, path: "report.demo.docx" });
    expect(log.writes[1].searchParams.get("mode")).toBe("copy");
  });

  it("Reload from disk (clean) remounts and resolves cancelled without a confirmation", async () => {
    installFetch({ write: conflict });
    render(<FileHandlerLayer />);
    const api = setup();
    await snapshotThen(api);
    api.setDirty(false);
    const nonce = fileHandlerStore.get(KEY)!.nonce;
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-conflict");
    fireEvent.click(screen.getByTestId("file-handler-conflict-reload"));
    expect(await p).toMatchObject({ ok: false, reason: "cancelled" });
    expect(screen.queryByTestId("file-handler-confirm")).toBeNull();
    expect(fileHandlerStore.get(KEY)!.nonce).toBe(nonce + 1);
    expect(fileHandlerStore.get(KEY)!.dirty).toBe("unknown");
  });

  it("Reload from disk when dirty confirms first; declining returns to the conflict dialog", async () => {
    installFetch({ write: conflict });
    render(<FileHandlerLayer />);
    const api = setup();
    await snapshotThen(api);
    api.setDirty(true);
    const nonce = fileHandlerStore.get(KEY)!.nonce;
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-conflict");
    fireEvent.click(screen.getByTestId("file-handler-conflict-reload"));
    await screen.findByTestId("file-handler-confirm");
    fireEvent.click(screen.getByTestId("file-handler-confirm-cancel"));
    await screen.findByTestId("file-handler-conflict");
    expect(fileHandlerStore.get(KEY)!.nonce).toBe(nonce);
    fireEvent.click(screen.getByTestId("file-handler-conflict-reload"));
    await screen.findByTestId("file-handler-confirm");
    fireEvent.click(screen.getByTestId("file-handler-confirm-action"));
    expect(await p).toMatchObject({ ok: false, reason: "cancelled" });
    expect(fileHandlerStore.get(KEY)!.nonce).toBe(nonce + 1);
  });

  it("a deleted file (409 without sha1) hides Reload and Overwrite anyway", async () => {
    installFetch({ write: () => ({ status: 409, body: { success: false, error: "file no longer exists" } }) });
    render(<FileHandlerLayer />);
    const api = setup();
    await snapshotThen(api);
    const p = api.save(bytes, { target: "overwrite" });
    await screen.findByTestId("file-handler-conflict");
    expect(screen.queryByTestId("file-handler-conflict-reload")).toBeNull();
    expect(screen.queryByTestId("file-handler-conflict-overwrite")).toBeNull();
    expect(screen.getByTestId("file-handler-conflict-copy")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("file-handler-conflict-cancel"));
    });
    await waitFor(async () => expect(await p).toMatchObject({ reason: "cancelled" }));
  });
});
