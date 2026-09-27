/**
 * ANSI layer — CSI / OSC / single-char ESC sequences and the 8-bit CSI (U+009B).
 * All high severity; removed in strip/block. Linear: every alternative is a
 * bounded character-class scan anchored on an ESC / CSI code unit.
 */

import type { FindingSet } from "./findings.js";

const ANSI =
  // OSC: ESC ] … (BEL | ESC \ | end); CSI: ESC [ params intermediates final;
  // 8-bit CSI; two-char ESC sequences (ESC @..Z, \, ], ^, _ — `[` handled above).
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~]|\x1b[@-Z\\^_]/g;

export function ansiLayer(text: string, findings: FindingSet): string {
  if (!text.includes("\x1b") && !text.includes("\x9b")) return text;
  let count = 0;
  let first = "";
  const out = text.replace(ANSI, (seq) => {
    if (count++ === 0) first = seq;
    return "";
  });
  if (count > 0) findings.add("ansi", "high", first, count);
  return out;
}
