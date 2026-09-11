/**
 * `sherpa-onnx-node` wrapper. The binding is imported **lazily** so importing
 * this module never throws when the optional native dependency is absent; the
 * failure is deferred to the first `loadEmbedder` call and surfaced with an
 * actionable message instead of a raw `MODULE_NOT_FOUND`.
 *
 * See change: add-speaker-id-enrollment.
 */
import * as path from "node:path";
import { l2 } from "./voiceprint.js";

/** Dependency + install command named in the actionable error. */
export const EMBEDDING_DEPENDENCY = "sherpa-onnx-node";
export const EMBEDDING_INSTALL_COMMAND = `pnpm add -O ${EMBEDDING_DEPENDENCY}@1.13.6`;

export interface Embedder {
  dim: number;
  modelName: string;
  /** L2-normalised embedding, or null when the stream is not ready. */
  embed(samples: Float32Array, sampleRate: number): Float32Array | null;
}

interface SherpaStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

interface SherpaExtractor {
  dim: number;
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  compute(stream: SherpaStream): Float32Array | number[];
}

/** Dynamically load the native binding (never at module import time). */
async function importSherpa(): Promise<{
  SpeakerEmbeddingExtractor: new (config: Record<string, unknown>) => SherpaExtractor;
}> {
  try {
    const mod = (await import("sherpa-onnx-node")) as unknown as {
      default?: { SpeakerEmbeddingExtractor?: unknown };
      SpeakerEmbeddingExtractor?: unknown;
    };
    const sherpa = (mod.default ?? mod) as { SpeakerEmbeddingExtractor?: unknown };
    if (typeof sherpa.SpeakerEmbeddingExtractor !== "function") {
      throw new Error("SpeakerEmbeddingExtractor is not exported");
    }
    return sherpa as { SpeakerEmbeddingExtractor: new (c: Record<string, unknown>) => SherpaExtractor };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `the optional dependency '${EMBEDDING_DEPENDENCY}' could not be loaded (${msg}). ` +
        `Speaker identification needs it; install it with: ${EMBEDDING_INSTALL_COMMAND}`,
    );
  }
}

/** Load the embedding model. The Node binding wants camelCase options. */
export async function loadEmbedder(modelPath: string, threads = 4): Promise<Embedder> {
  const { SpeakerEmbeddingExtractor } = await importSherpa();
  const extractor = new SpeakerEmbeddingExtractor({
    model: modelPath,
    numThreads: threads,
    debug: false,
    provider: "cpu",
  });
  return {
    dim: extractor.dim,
    modelName: path.basename(modelPath),
    embed(samples: Float32Array, sampleRate: number): Float32Array | null {
      if (samples.length === 0) return null;
      const stream = extractor.createStream();
      stream.acceptWaveform({ sampleRate, samples });
      stream.inputFinished();
      if (!extractor.isReady(stream)) return null;
      return l2(extractor.compute(stream));
    },
  };
}
