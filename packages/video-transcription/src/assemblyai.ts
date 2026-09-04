/**
 * AssemblyAI REST client — upload → submit → poll → SRT.
 *
 * Alternate backend to `soniox.ts`, chosen for its speaker diarization. Same
 * `TranscribeService` contract (`transcribeFile(path) -> SRT string`), so it is
 * a drop-in inside `transcribeChunked`.
 *
 * Verified against the live docs (2026-08):
 *  - auth header is the RAW key, no `Bearer` prefix (unlike Soniox)
 *  - `/v2/upload` takes a RAW binary body, not multipart
 *  - `speech_models` is an ordered availability-fallback ARRAY (pre-recorded);
 *    `universal-3-5-pro` covers 18 languages and falls back to `universal-2`
 *    (99 languages) for everything else — Hungarian included — when
 *    `language_detection` is on
 *  - EU data residency is a plain base-URL swap to `api.eu.assemblyai.com`
 *
 * The API key never appears in thrown errors or logs.
 */
import * as fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { groupTokens, renderSegments, type Token } from "./srt.js";

export const EU_BASE_URL = "https://api.eu.assemblyai.com";
export const US_BASE_URL = "https://api.assemblyai.com";

const POLL_INTERVAL_MS = 3000;
/** ~90 min at the 3 s poll interval; long meetings transcribe well inside it. */
const DEFAULT_MAX_POLL_ATTEMPTS = 1800;
const MAX_RETRIES = 4;

/** Ordered model fallback: flagship first, 99-language model as the fallback. */
export const DEFAULT_SPEECH_MODELS = ["universal-3-5-pro", "universal-2"];

export interface AssemblyAIWord {
  text?: string;
  start?: number;
  end?: number;
  speaker?: string;
}

export interface AssemblyAIUtterance {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
  words?: AssemblyAIWord[];
}

export interface AssemblyAITranscript {
  id?: string;
  status?: string;
  error?: string;
  text?: string;
  utterances?: AssemblyAIUtterance[];
  words?: AssemblyAIWord[];
  language_code?: string;
}

export interface AssemblyAIOptions {
  apiKey: string;
  /** Defaults to the EU endpoint (data residency). */
  baseUrl?: string;
  pollIntervalMs?: number;
  /** Pin a language (e.g. `hu`). Mutually exclusive with language detection. */
  languageCode?: string;
  /** Hard cap on distinct speaker labels — extra speakers get merged. */
  maxSpeakers?: number;
  speechModels?: string[];
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Map an AssemblyAI speaker label to the SRT label used by every backend.
 * AssemblyAI emits sequential letters (`A`, `B`, ...); the SRT format (and the
 * Soniox backend) uses `Speaker 1`, `Speaker 2`, ...
 */
export function speakerLabel(raw: string | undefined): string {
  if (!raw) return "Speaker 1";
  const letter = /^([A-Z])$/.exec(raw.trim());
  if (letter) return `Speaker ${letter[1].charCodeAt(0) - 64}`;
  if (/^\d+$/.test(raw.trim())) return `Speaker ${Number(raw.trim())}`;
  return raw;
}

/**
 * Flatten utterances into `Token`s matching the Soniox token convention: the
 * first word of a turn carries no leading space, later words carry one. Falls
 * back to the flat `words[]` array when diarization returned no utterances.
 */
export function transcriptToTokens(transcript: AssemblyAITranscript): Token[] {
  const tokens: Token[] = [];

  const pushWords = (words: AssemblyAIWord[], turnSpeaker?: string) => {
    words.forEach((word, i) => {
      const text = word.text ?? "";
      if (!text.trim()) return;
      tokens.push({
        text: i === 0 ? text : ` ${text}`,
        speaker: speakerLabel(word.speaker ?? turnSpeaker),
        start_ms: word.start ?? 0,
        end_ms: word.end ?? 0,
      });
    });
  };

  const utterances = transcript.utterances ?? [];
  if (utterances.length > 0) {
    for (const utterance of utterances) {
      const words = utterance.words ?? [];
      if (words.length > 0) {
        pushWords(words, utterance.speaker);
        continue;
      }
      const text = utterance.text ?? "";
      if (!text.trim()) continue;
      tokens.push({
        text,
        speaker: speakerLabel(utterance.speaker),
        start_ms: utterance.start ?? 0,
        end_ms: utterance.end ?? 0,
      });
    }
    return tokens;
  }

  pushWords(transcript.words ?? []);
  return tokens;
}

/** Convert a completed AssemblyAI transcript into an SRT string. */
export function transcriptToSrt(transcript: AssemblyAITranscript): string {
  const tokens = transcriptToTokens(transcript);
  if (tokens.length === 0) return "";
  // Trim so a mid-turn segment split never emits a doubled space after `[N]`.
  const segments = groupTokens(tokens).map((s) => ({ ...s, text: s.text.trim() }));
  return renderSegments(segments);
}

export class AssemblyAIClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly languageCode?: string;
  private readonly maxSpeakers?: number;
  private readonly speechModels: string[];
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AssemblyAIOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? EU_BASE_URL;
    this.pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.languageCode = opts.languageCode;
    this.maxSpeakers = opts.maxSpeakers;
    this.speechModels = opts.speechModels ?? DEFAULT_SPEECH_MODELS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Raw key — AssemblyAI does NOT take a `Bearer` prefix on this header. */
  private get authHeaders(): Record<string, string> {
    return { Authorization: this.apiKey };
  }

  /**
   * Issue a request, retrying 429/5xx with `Retry-After` (or linear backoff).
   * Errors never echo the request headers, so the key cannot leak.
   */
  private async request(url: string, init: RequestInit, action: string): Promise<Response> {
    let lastStatus = 0;
    let lastText = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await this.fetchImpl(url, init);
      if (res.ok) return res;

      lastStatus = res.status;
      lastText = res.statusText;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) break;

      const retryAfter = Number.parseFloat(res.headers?.get?.("retry-after") ?? "");
      const delayMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : this.pollIntervalMs * (attempt + 1);
      await sleep(delayMs);
    }

    throw new Error(`AssemblyAI ${action} failed: HTTP ${lastStatus} ${lastText}`);
  }

  /** Upload a local file as a raw binary body; returns its temporary URL. */
  async uploadFile(audioFile: string): Promise<string> {
    const body = fs.readFileSync(audioFile);
    const res = await this.request(
      `${this.baseUrl}/v2/upload`,
      {
        method: "POST",
        headers: { ...this.authHeaders, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(body),
      },
      "upload",
    );
    const data = (await res.json()) as { upload_url: string };
    return data.upload_url;
  }

  /** Submit a diarized transcription job; returns its id. */
  async createTranscript(audioUrl: string): Promise<string> {
    const payload: Record<string, unknown> = {
      audio_url: audioUrl,
      speech_models: this.speechModels,
      speaker_labels: true,
    };
    // `language_code` and `language_detection` are mutually exclusive. Detection
    // is what routes non-U3.5-Pro languages (e.g. Hungarian) to universal-2.
    if (this.languageCode) payload.language_code = this.languageCode;
    else payload.language_detection = true;
    if (this.maxSpeakers) payload.max_speakers_expected = this.maxSpeakers;

    const res = await this.request(
      `${this.baseUrl}/v2/transcript`,
      {
        method: "POST",
        headers: { ...this.authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "create",
    );
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  /** Poll until the job completes; throws on `error` status or timeout. */
  async waitForCompletion(
    transcriptId: string,
    maxAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
  ): Promise<AssemblyAITranscript> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await this.request(
        `${this.baseUrl}/v2/transcript/${transcriptId}`,
        { headers: this.authHeaders },
        "status",
      );
      const data = (await res.json()) as AssemblyAITranscript;
      if (data.status === "completed") return data;
      if (data.status === "error") {
        throw new Error(`Transcription failed: ${data.error || "Unknown error"}`);
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(
      `Transcription ${transcriptId} timed out after ${maxAttempts} poll attempts`,
    );
  }

  /** Full flow for one file: upload → submit → poll → SRT. */
  async transcribeFile(audioFile: string): Promise<string> {
    const uploadUrl = await this.uploadFile(audioFile);
    const transcriptId = await this.createTranscript(uploadUrl);
    const transcript = await this.waitForCompletion(transcriptId);
    return transcriptToSrt(transcript);
  }
}
