/**
 * Production wiring for brief generation: providers.json on disk, the
 * dashboard's single model registry/auth store (same one the model proxy uses)
 * and the runtime `streamSimple`. Kept apart from `brief-model.ts` so unit
 * tests of the pure logic do not load the model runtime.
 * See change: add-pending-question-stack (D5).
 */
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getModelRegistry, getStreamSimpleFn } from "../model-proxy/registry-singleton.js";
import { streamCompletion } from "../model-proxy/streamer.js";
import { createBriefModelResolver } from "./brief-model.js";

const BRIEF_MAX_TOKENS = 400;

async function readProvidersFile(): Promise<string | undefined> {
  try {
    return await fsp.readFile(path.join(os.homedir(), ".pi", "agent", "providers.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export const resolveBriefModel = createBriefModelResolver({
  readProviders: readProvidersFile,
  getRegistry: () => getModelRegistry(),
  hasStreamFn: () => getStreamSimpleFn() !== null,
});

/** One `@fast` completion; the caller owns the timeout (`signal`). */
export async function completeBrief(model: unknown, prompt: { system: string; user: string }, signal: AbortSignal): Promise<string> {
  const fn = getStreamSimpleFn();
  if (!fn) throw new Error("model runtime not initialized");
  const stream = await streamCompletion(
    { model, system: prompt.system, messages: [{ role: "user", content: prompt.user, timestamp: Date.now() }], maxTokens: BRIEF_MAX_TOKENS, signal },
    fn,
  );
  let text = "";
  for await (const ev of stream) {
    if (signal.aborted) throw new Error("generation aborted"); // a provider that ignores the signal must not keep us reading
    if (ev.type === "text_delta") text += ev.delta;
    else if (ev.type === "error") throw new Error(ev.error?.errorMessage ?? "model stream error");
    else if (ev.type === "done" && !text) {
      text = (ev.message?.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    }
  }
  return text;
}
