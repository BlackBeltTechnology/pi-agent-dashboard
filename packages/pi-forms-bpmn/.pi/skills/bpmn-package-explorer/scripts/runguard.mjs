// Run-mode orchestration for the layout guard (§6.1–6.3b).
//
// Decides — by a COMPUTABLE rule, not document history — whether geometry is
// strict (produced by this run) or advisory (already on disk):
//   * no DI on input  → geometry about to exist is ours → STRICT after layout.
//                        An INGESTED DI-less file containing a rejected construct
//                        is REFUSED rather than laid out (measured corruption).
//   * DI on input      → geometry is on-disk input → ADVISORY, never re-laid out.
//                        Partial DI surfaces shapeless elements as warnings.

import { parse, layout, xmlHasDI } from './pipeline.mjs';
import { runGuard } from './guard.mjs';
import { rejectedConstructIn } from './envelope.mjs';

/**
 * @param xml the .bpmn source
 * @param opts.provenance 'generated' | 'ingested'
 * @returns one of:
 *   { refused:true, diagnostics:[{code,message}] }               (6.3b refusal)
 *   { refused:false, mode, laidOut, result }                     (verified)
 */
export async function guardXml(xml, { provenance = 'ingested' } = {}) {
  if (!xmlHasDI(xml)) {
    // DI-less. The geometry about to be produced is this run's own → strict.
    if (provenance === 'ingested') {
      const rej = rejectedConstructIn(xml);
      if (rej) return { refused: true, diagnostics: rej };
    }
    const laidOut = await layout(xml);
    const { rootElement } = await parse(laidOut);
    const result = runGuard(rootElement, { mode: 'strict' });
    return { refused: false, mode: 'strict', laidOut, result };
  }
  // Has DI (possibly partial): never re-layout. On-disk geometry → advisory.
  const { rootElement } = await parse(xml);
  const result = runGuard(rootElement, { mode: 'advisory' });
  return { refused: false, mode: 'advisory', laidOut: xml, result };
}
