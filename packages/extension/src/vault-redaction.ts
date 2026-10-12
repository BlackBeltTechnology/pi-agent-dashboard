/**
 * Redaction handlers: keep delivered vault values out of the transcript, the
 * model context and the user's `!` command output.
 *
 *  - `tool_result`: deep-masks `content`, `details` (incl. `details.truncation.content`)
 *    and `structuredContent`, and rewrites the full-output spill file. pi applies
 *    the result before recording it, so transcript and model see masked text.
 *    Returns all three fields together: replacing `content` alone would drop
 *    `structuredContent`.
 *  - `message_end`: replaces the finalized message with a masked copy (text and
 *    tool-call arguments); `role`, `usage` and other fields are kept.
 *  - `user_bash`: wraps the local bash operations so streamed output is masked
 *    chunk-by-chunk with a UTF-8-safe hold-back; the held tail is flushed on exit.
 *
 * Every handler is a no-op (returns undefined) while no value is held.
 * Accepted residual: another extension that registers before this one, or a
 * crash mid-command, can leave raw text in a spill file in `tmpdir()` (pi 1.1
 * writes them 0600).
 *
 * See change: add-credential-vault (D5).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createMasker, type Masker, type MaskerState } from "./vault-masker.js";

/** Message/content discriminators pi relies on; every other string, whatever its key, is masked. */
const DISCRIMINATORS: Readonly<Record<string, ReadonlySet<string>>> = {
  role: new Set(["user", "assistant", "toolResult", "custom", "system"]),
  type: new Set(["text", "image", "thinking", "toolCall", "toolResult", "redacted_thinking"]),
};
const SPILL_NAME = /^pi-[A-Za-z0-9._-]+$/;
const CHUNK = 1024 * 1024;

export interface BashOperationsLike {
  exec: (
    command: string,
    cwd: string,
    options: { onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv },
  ) => Promise<{ exitCode: number | null }>;
}

export interface VaultRedactionDeps {
  getState: () => MaskerState;
  /** pi's `createLocalBashOperations`, loaded lazily; undefined when unavailable (the `!` output is then unwrapped). */
  createLocalBashOperations: () => Promise<BashOperationsLike | undefined> | BashOperationsLike | undefined;
  /** Defaults to `os.tmpdir()`; where pi writes full-output spill files. */
  tmpDir?: string;
  log?: (line: string) => void;
}

interface ToolResultLike {
  content?: unknown;
  details?: unknown;
  structuredContent?: unknown;
}

const latin1 = (s: string): string => Buffer.from(s, "utf8").toString("latin1");

/** A spill file we may rewrite: a pi-named regular file directly inside the temp dir. */
async function isSpillFile(file: string, tmpDir: string): Promise<boolean> {
  try {
    if (!path.isAbsolute(file) || !SPILL_NAME.test(path.basename(file))) return false;
    const [dir, tmp] = await Promise.all([fs.promises.realpath(path.dirname(file)), fs.promises.realpath(tmpDir)]);
    if (dir !== tmp) return false;
    return (await fs.promises.lstat(file)).isFile();
  } catch {
    return false;
  }
}

/** One pass over `file` through the masker; writes masked bytes to `write` when given. Returns true when a value was found. */
async function maskPass(file: string, masker: Masker, write?: fs.promises.FileHandle): Promise<boolean> {
  const src = await fs.promises.open(file, "r");
  const buf = Buffer.allocUnsafe(CHUNK);
  let carry = "";
  let found = false;
  try {
    for (;;) {
      const { bytesRead } = await src.read(buf, 0, CHUNK, null);
      const raw = carry + buf.toString("latin1", 0, bytesRead);
      const last = bytesRead === 0;
      const { emit, held } = last ? { emit: masker.mask(raw), held: "" } : masker.maskAndHold(raw);
      if (emit !== raw.slice(0, raw.length - held.length)) found = true;
      if (write && emit.length > 0) await write.write(Buffer.from(emit, "latin1"));
      carry = held;
      if (last) return found;
    }
  } finally {
    await src.close();
  }
}

/** Mask a file in place, byte-safely (latin1 view of the UTF-8 bytes). Returns true when it was rewritten. */
async function maskFile(file: string, getState: () => MaskerState): Promise<boolean> {
  const state = getState();
  const bytesMasker = createMasker(() => ({
    version: state.version,
    entries: state.entries.map((e) => ({ name: e.name, value: latin1(e.value) })),
  }));
  if (!(await maskPass(file, bytesMasker))) return false;
  const tmp = `${file}.vault-${process.pid}.tmp`;
  const out = await fs.promises.open(tmp, "wx", 0o600);
  try {
    await maskPass(file, bytesMasker, out);
  } finally {
    await out.close();
  }
  await fs.promises.rename(tmp, file);
  return true;
}

export interface VaultRedaction {
  masker: Masker;
  toolResult: (event: ToolResultLike) => Promise<ToolResultLike | undefined>;
  messageEnd: (event: { message?: unknown }) => { message: unknown } | undefined;
  userBash: () => Promise<{ operations: BashOperationsLike } | undefined>;
}

export function createVaultRedaction(deps: VaultRedactionDeps): VaultRedaction {
  const masker = createMasker(deps.getState);
  const tmpDir = deps.tmpDir ?? os.tmpdir();

  const rewriteSpill = async (details: unknown): Promise<void> => {
    const p = (details as { fullOutputPath?: unknown } | null | undefined)?.fullOutputPath;
    if (typeof p !== "string" || !(await isSpillFile(p, tmpDir))) return;
    try {
      await maskFile(p, deps.getState);
    } catch {
      deps.log?.("[vault] could not rewrite a full-output file");
    }
  };

  const wrapOperations = (local: BashOperationsLike): BashOperationsLike => ({
    async exec(command, cwd, options) {
      const decoder = new StringDecoder("utf8");
      let carry = "";
      const emit = (s: string): void => {
        if (s.length > 0) options.onData(Buffer.from(s, "utf8"));
      };
      const onData = (data: Buffer): void => {
        const { emit: out, held } = masker.maskAndHold(carry + decoder.write(data));
        carry = held;
        emit(out);
      };
      try {
        return await local.exec(command, cwd, { ...options, onData });
      } finally {
        const tail = carry + decoder.end();
        carry = "";
        emit(masker.mask(tail));
      }
    },
  });

  return {
    masker,
    async toolResult(event) {
      if (!masker.active()) return undefined;
      const content = masker.maskDeep(event.content, { skipLiterals: DISCRIMINATORS });
      const details = masker.maskDeep(event.details);
      const structuredContent = masker.maskDeep(event.structuredContent);
      await rewriteSpill(event.details);
      if (content === event.content && details === event.details && structuredContent === event.structuredContent) return undefined;
      // All three together: replacing `content` alone drops `structuredContent`.
      return { content, details, structuredContent };
    },
    messageEnd(event) {
      if (!masker.active() || event.message === undefined) return undefined;
      const message = masker.maskDeep(event.message, { skipLiterals: DISCRIMINATORS });
      return message === event.message ? undefined : { message };
    },
    async userBash() {
      if (!masker.active()) return undefined;
      const local = await deps.createLocalBashOperations();
      return local ? { operations: wrapOperations(local) } : undefined;
    },
  };
}
