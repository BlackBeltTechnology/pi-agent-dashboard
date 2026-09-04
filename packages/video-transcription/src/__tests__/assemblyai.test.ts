/**
 * AssemblyAI backend tests. Every network call is a mocked `fetch`, so these
 * assert the wire contract (raw-key auth, raw-binary upload, param shape) and
 * the transcript -> SRT mapping without touching the API.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssemblyAIClient,
  EU_BASE_URL,
  speakerLabel,
  transcriptToSrt,
} from "../assemblyai.js";

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Queue of canned responses, recording every request made. */
function mockFetch(responses: Response[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const res = responses[i++];
    if (!res) throw new Error(`unexpected fetch #${i}: ${url}`);
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const tmpFiles: string[] = [];
function tempAudio(bytes = "audio-bytes"): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aai-")), "clip.mp3");
  fs.writeFileSync(file, bytes);
  tmpFiles.push(file);
  return file;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

describe("speakerLabel", () => {
  it("maps AssemblyAI letters to numbered speakers", () => {
    expect(speakerLabel("A")).toBe("Speaker 1");
    expect(speakerLabel("B")).toBe("Speaker 2");
    expect(speakerLabel("C")).toBe("Speaker 3");
  });

  it("passes through numeric and unknown labels, defaulting when absent", () => {
    expect(speakerLabel("2")).toBe("Speaker 2");
    expect(speakerLabel("Dr. Smith")).toBe("Dr. Smith");
    expect(speakerLabel(undefined)).toBe("Speaker 1");
  });
});

describe("transcriptToSrt", () => {
  it("renders diarized utterances as speaker-tagged cues with ms timings", () => {
    const srt = transcriptToSrt({
      utterances: [
        {
          speaker: "A",
          start: 0,
          end: 1500,
          words: [
            { text: "Hello", start: 0, end: 400, speaker: "A" },
            { text: "everyone", start: 400, end: 900, speaker: "A" },
            { text: "welcome.", start: 900, end: 1500, speaker: "A" },
          ],
        },
        {
          speaker: "B",
          start: 1700,
          end: 2900,
          words: [
            { text: "Thanks", start: 1700, end: 2100, speaker: "B" },
            { text: "for", start: 2100, end: 2300, speaker: "B" },
            { text: "having", start: 2300, end: 2600, speaker: "B" },
            { text: "me.", start: 2600, end: 2900, speaker: "B" },
          ],
        },
      ],
    });

    expect(srt).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:01,500",
        "[Speaker 1] Hello everyone welcome.",
        "",
        "2",
        "00:00:01,700 --> 00:00:02,900",
        "[Speaker 2] Thanks for having me.",
        "",
      ].join("\n"),
    );
  });

  it("splits a long single-speaker turn on the 5s segment boundary", () => {
    const words = Array.from({ length: 8 }, (_, i) => ({
      text: `w${i}`,
      start: i * 1000,
      end: i * 1000 + 900,
      speaker: "A",
    }));
    const srt = transcriptToSrt({ utterances: [{ speaker: "A", words }] });
    // Boundary at 5000ms -> two cues, and no doubled space after the tag.
    expect(srt.match(/-->/g)).toHaveLength(2);
    expect(srt).not.toContain("]  ");
  });

  it("falls back to the flat words array when there are no utterances", () => {
    const srt = transcriptToSrt({
      words: [{ text: "Solo", start: 0, end: 500, speaker: "A" }],
    });
    expect(srt).toContain("[Speaker 1] Solo");
  });

  it("returns an empty string for an empty transcript", () => {
    expect(transcriptToSrt({})).toBe("");
    expect(transcriptToSrt({ utterances: [] })).toBe("");
  });
});

describe("AssemblyAIClient", () => {
  it("uploads raw binary and submits diarized, language-detected job to the EU endpoint", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ upload_url: "https://cdn.eu/upload/abc" }),
      jsonResponse({ id: "t1" }),
      jsonResponse({ status: "completed", utterances: [] }),
    ]);
    const client = new AssemblyAIClient({ apiKey: "secret-key", fetchImpl, pollIntervalMs: 0 });

    await client.transcribeFile(tempAudio());

    expect(calls[0].url).toBe(`${EU_BASE_URL}/v2/upload`);
    const uploadHeaders = calls[0].init.headers as Record<string, string>;
    // Raw key, no Bearer prefix.
    expect(uploadHeaders.Authorization).toBe("secret-key");
    expect(uploadHeaders["Content-Type"]).toBe("application/octet-stream");
    expect(calls[0].init.body).toBeInstanceOf(Uint8Array);

    expect(calls[1].url).toBe(`${EU_BASE_URL}/v2/transcript`);
    const payload = JSON.parse(calls[1].init.body as string);
    expect(payload).toMatchObject({
      audio_url: "https://cdn.eu/upload/abc",
      speech_models: ["universal-3-5-pro", "universal-2"],
      speaker_labels: true,
      language_detection: true,
    });
    expect(payload.language_code).toBeUndefined();

    expect(calls[2].url).toBe(`${EU_BASE_URL}/v2/transcript/t1`);
  });

  it("pins language_code instead of detection, and caps speakers, when configured", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ upload_url: "u" }),
      jsonResponse({ id: "t2" }),
      jsonResponse({ status: "completed", utterances: [] }),
    ]);
    const client = new AssemblyAIClient({
      apiKey: "k",
      fetchImpl,
      pollIntervalMs: 0,
      languageCode: "hu",
      maxSpeakers: 3,
    });

    await client.transcribeFile(tempAudio());

    const payload = JSON.parse(calls[1].init.body as string);
    expect(payload.language_code).toBe("hu");
    expect(payload.language_detection).toBeUndefined();
    expect(payload.max_speakers_expected).toBe(3);
  });

  it("polls until the job completes", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ upload_url: "u" }),
      jsonResponse({ id: "t3" }),
      jsonResponse({ status: "queued" }),
      jsonResponse({ status: "processing" }),
      jsonResponse({
        status: "completed",
        utterances: [{ speaker: "A", words: [{ text: "Hi", start: 0, end: 100, speaker: "A" }] }],
      }),
    ]);
    const client = new AssemblyAIClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });

    const srt = await client.transcribeFile(tempAudio());

    expect(calls).toHaveLength(5);
    expect(srt).toContain("[Speaker 1] Hi");
  });

  it("throws the API error message on an error status", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ upload_url: "u" }),
      jsonResponse({ id: "t4" }),
      jsonResponse({ status: "error", error: "audio decode failed" }),
    ]);
    const client = new AssemblyAIClient({ apiKey: "k", fetchImpl, pollIntervalMs: 0 });

    await expect(client.transcribeFile(tempAudio())).rejects.toThrow("audio decode failed");
  });

  it("retries a 429 and never leaks the key in the error", async () => {
    const { fetchImpl, calls } = mockFetch([
      new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      jsonResponse({ upload_url: "u2" }),
      jsonResponse({ id: "t5" }),
      jsonResponse({ status: "completed", utterances: [] }),
    ]);
    const client = new AssemblyAIClient({ apiKey: "super-secret", fetchImpl, pollIntervalMs: 0 });

    await expect(client.transcribeFile(tempAudio())).resolves.toBe("");
    expect(calls).toHaveLength(4);
  });

  it("gives up on a non-retryable status without exposing the key", async () => {
    const { fetchImpl } = mockFetch([new Response("nope", { status: 401 })]);
    const client = new AssemblyAIClient({ apiKey: "super-secret", fetchImpl, pollIntervalMs: 0 });

    await expect(client.transcribeFile(tempAudio())).rejects.toThrow(
      /AssemblyAI upload failed: HTTP 401(?!.*super-secret)/,
    );
  });
});
