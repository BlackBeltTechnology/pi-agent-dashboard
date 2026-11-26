/**
 * Regression guard (G8, not an SLA): registering a sudo password must not make
 * the masking pass more than 2x slower than the same pass with nothing
 * registered. The baseline is the real `user_bash` streaming wrapper
 * (`userBash({ always: true })`, so decode/encode/chunk handling is included)
 * with an empty registry and an empty vault; the measured run registers a
 * 64-char password. CI headroom: a small absolute slack is added to the 2x bound.
 * See change: add-sudo-credential-prompt (test-plan #S48).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSudoPassword, SUDO_MASK_REGISTRY_KEY, sudoMaskState } from "../sudo-askpass/sudo-mask-registry.js";
import { type BashOperationsLike, createVaultRedaction } from "../vault-redaction.js";

const MIB = 1024 * 1024;
const TOTAL = 10 * MIB;
const CHUNK = 64 * 1024;
const RUNS = 5;
const SLACK_MS = 30;
const PW = "Zq9!".repeat(16); // 64 chars

const resetRegistry = () => { delete (process as unknown as Record<symbol, unknown>)[SUDO_MASK_REGISTRY_KEY]; };

/** 10 MiB of deterministic pseudo-text with the password echoed about once per MiB. */
function buildChunks(): Buffer[] {
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const alphabet = "abcdefghijklmnopqrstuvwxyz \n";
  const raw: string[] = [];
  for (let size = 0; size < TOTAL; size += CHUNK) {
    const a = new Array<string>(CHUNK);
    for (let i = 0; i < CHUNK; i++) a[i] = alphabet[Math.floor(rnd() * alphabet.length)];
    let text = a.join("");
    if ((size / CHUNK) % 16 === 8) text = `${text.slice(0, 1000)}${PW}${text.slice(1000 + PW.length)}`;
    raw.push(text);
  }
  return raw.map((t) => Buffer.from(t, "utf8"));
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function runOnce(chunks: Buffer[]): Promise<{ ms: number; out: number }> {
  const local: BashOperationsLike = {
    async exec(_c, _d, o) {
      for (const c of chunks) o.onData(c);
      return { exitCode: 0 };
    },
  };
  const red = createVaultRedaction({ getState: () => ({ ...sudoMaskState() }), createLocalBashOperations: () => local });
  const res = await red.userBash({ always: true });
  if (!res) throw new Error("expected wrapped operations");
  let out = 0;
  const t0 = performance.now();
  await res.operations.exec("cmd", "/", { onData: (d) => { out += d.length; } });
  return { ms: performance.now() - t0, out };
}

beforeEach(resetRegistry);
afterEach(resetRegistry);

describe("sudo password masking cost (#S48)", () => {
  it("median of 5 passes over 10 MiB with a 64-char password registered is <= 2x the unregistered baseline", async () => {
    const chunks = buildChunks();
    await runOnce(chunks); // warm-up
    const base: number[] = [];
    for (let i = 0; i < RUNS; i++) base.push((await runOnce(chunks)).ms);

    registerSudoPassword(PW);
    const masked: number[] = [];
    let maskedOut = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(chunks);
      masked.push(r.ms);
      maskedOut = r.out;
    }
    // the workload really masked something (output shrank by 64 -> 24 chars per hit)
    expect(maskedOut).toBeLessThan(TOTAL);
    expect(median(masked)).toBeLessThanOrEqual(2 * median(base) + SLACK_MS);
  });
});
