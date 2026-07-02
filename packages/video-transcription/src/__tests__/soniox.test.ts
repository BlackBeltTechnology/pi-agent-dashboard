import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SonioxClient } from "../soniox.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

type FetchArgs = Parameters<typeof fetch>;
const fetchMock = (impl: () => Response) =>
  vi.fn(async (..._args: FetchArgs): Promise<Response> => impl());

describe("SonioxClient", () => {
  let audioFile: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-soniox-"));
    audioFile = path.join(dir, "clip.m4a");
    fs.writeFileSync(audioFile, "fake-audio-bytes");
  });
  afterEach(() => {
    fs.rmSync(path.dirname(audioFile), { recursive: true, force: true });
  });

  it("uploadFile posts multipart to /files and returns id", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({ id: "file-1" }));
    const client = new SonioxClient({ apiKey: "secret", fetchImpl });
    const id = await client.uploadFile(audioFile);
    expect(id).toBe("file-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/files$/);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("createTranscription posts the expected config", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({ id: "tr-1" }));
    const client = new SonioxClient({ apiKey: "k", fetchImpl });
    const id = await client.createTranscription("file-1");
    expect(id).toBe("tr-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/transcriptions$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      model: "stt-async-v3",
      enable_speaker_diarization: true,
      enable_language_identification: true,
      file_id: "file-1",
    });
  });

  it("waitForCompletion polls until completed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "processing" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed" }));
    const client = new SonioxClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });
    await client.waitForCompletion("tr-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waitForCompletion throws a timeout after maxAttempts", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({ status: "processing" }));
    const client = new SonioxClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });
    await expect(client.waitForCompletion("tr-1", 3)).rejects.toThrow(/timed out/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("waitForCompletion throws on failed status", async () => {
    const fetchImpl = fetchMock(() =>
      jsonResponse({ status: "failed", error_message: "bad audio" }),
    );
    const client = new SonioxClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });
    await expect(client.waitForCompletion("tr-1")).rejects.toThrow(/bad audio/);
  });

  it("deleteFile swallows errors", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({}, false, 500));
    const client = new SonioxClient({ apiKey: "k", fetchImpl });
    await expect(client.deleteFile("file-1")).resolves.toBeUndefined();
  });

  it("transcribeFile orchestrates the flow and deletes the file", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "file-1" })) // upload
      .mockResolvedValueOnce(jsonResponse({ id: "tr-1" })) // create
      .mockResolvedValueOnce(jsonResponse({ status: "completed" })) // wait
      .mockResolvedValueOnce(
        jsonResponse({ tokens: [{ text: "hi", speaker: "Speaker 1", start_ms: 0, end_ms: 100 }] }),
      ) // transcript
      .mockResolvedValueOnce(jsonResponse({})); // delete
    const client = new SonioxClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });
    const srt = await client.transcribeFile(audioFile);
    expect(srt).toContain("[Speaker 1] hi");
    // Last call is the delete.
    const lastCall = fetchImpl.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatch(/\/files\/file-1$/);
    expect((lastCall[1] as RequestInit).method).toBe("DELETE");
  });

  it("transcribeFile cleans up the file on error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "file-1" })) // upload
      .mockResolvedValueOnce(jsonResponse({}, false, 500)) // create fails
      .mockResolvedValueOnce(jsonResponse({})); // delete
    const client = new SonioxClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });
    await expect(client.transcribeFile(audioFile)).rejects.toThrow(/create failed/);
    const lastCall = fetchImpl.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatch(/\/files\/file-1$/);
    expect((lastCall[1] as RequestInit).method).toBe("DELETE");
  });

  it("never leaks the API key in thrown errors", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({}, false, 401));
    const client = new SonioxClient({ apiKey: "super-secret-key", fetchImpl });
    await expect(client.uploadFile(audioFile)).rejects.toThrow(
      /^(?!.*super-secret-key).*$/,
    );
  });
});
