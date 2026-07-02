/**
 * Soniox REST client — upload → create → poll → get transcript → delete.
 * Native `fetch` + `FormData`/`Blob`; no SDK. The API key never appears in
 * thrown errors or logs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Token, tokensToSrt } from "./srt.js";

const BASE_URL = "https://api.soniox.com/v1";
const POLL_INTERVAL_MS = 2000;

export interface SonioxOptions {
  apiKey: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class SonioxClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SonioxOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async ensureOk(res: Response, action: string): Promise<Response> {
    if (!res.ok) {
      // Never include the request/headers (would leak the key).
      throw new Error(`Soniox ${action} failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res;
  }

  /** Upload an audio file; returns its Soniox file id. */
  async uploadFile(audioFile: string): Promise<string> {
    const name = path.basename(audioFile);
    const buffer = fs.readFileSync(audioFile);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "audio/m4a" }), name);

    const res = await this.fetchImpl(`${this.baseUrl}/files`, {
      method: "POST",
      headers: this.authHeaders,
      body: form,
    });
    await this.ensureOk(res, "upload");
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  /** Create a transcription request; returns its id. */
  async createTranscription(fileId: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/transcriptions`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "stt-async-v3",
        enable_speaker_diarization: true,
        enable_language_identification: true,
        file_id: fileId,
      }),
    });
    await this.ensureOk(res, "create");
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  /**
   * Poll until the transcription completes; throw on failure/error status.
   * Bounded by `maxAttempts` (default ~60 min at the 2 s poll interval) so a
   * stuck transcription surfaces a clear timeout instead of hanging forever.
   */
  async waitForCompletion(transcriptionId: string, maxAttempts = 1800): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await this.fetchImpl(`${this.baseUrl}/transcriptions/${transcriptionId}`, {
        headers: this.authHeaders,
      });
      await this.ensureOk(res, "status");
      const data = (await res.json()) as {
        status: string;
        error_message?: string;
        error?: string;
      };
      if (data.status === "completed") return;
      if (data.status === "failed" || data.status === "error") {
        const msg = data.error_message || data.error || "Unknown error";
        throw new Error(`Transcription failed: ${msg}`);
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(
      `Transcription ${transcriptionId} timed out after ${maxAttempts} poll attempts`,
    );
  }

  /** Retrieve the completed transcript payload (tokens + speaker info). */
  async getTranscript(transcriptionId: string): Promise<{ tokens?: Token[] }> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/transcriptions/${transcriptionId}/transcript`,
      { headers: this.authHeaders },
    );
    await this.ensureOk(res, "get transcript");
    return (await res.json()) as { tokens?: Token[] };
  }

  /** Best-effort delete of an uploaded file; swallows errors. */
  async deleteFile(fileId: string): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/files/${fileId}`, {
        method: "DELETE",
        headers: this.authHeaders,
      });
      await this.ensureOk(res, "delete");
    } catch {
      // Cleanup failures are non-fatal.
    }
  }

  /** Orchestrate the full flow for one file: upload→create→wait→get→srt→delete. */
  async transcribeFile(audioFile: string): Promise<string> {
    const fileId = await this.uploadFile(audioFile);
    try {
      const transcriptionId = await this.createTranscription(fileId);
      await this.waitForCompletion(transcriptionId);
      const transcript = await this.getTranscript(transcriptionId);
      const srt = tokensToSrt(transcript);
      await this.deleteFile(fileId);
      return srt;
    } catch (err) {
      await this.deleteFile(fileId);
      throw err;
    }
  }
}
