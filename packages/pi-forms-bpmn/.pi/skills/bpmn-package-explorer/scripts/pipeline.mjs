// Pipeline primitives: parse, DI detection, layout invocation.
//
// Wraps the vendored self-contained Node bundle. No install / bundler / network
// at use time.

import { layoutProcess, BpmnModdle } from '../assets/lib/bpmn-pipeline.mjs';

export { BpmnModdle };

/** Parse BPMN XML into a moddle tree. Returns { rootElement, warnings }. */
export async function parse(xml) {
  const m = new BpmnModdle();
  return m.fromXML(xml);
}

/** Serialise a moddle tree back to XML. */
export async function serialise(rootElement) {
  const m = new BpmnModdle();
  const { xml } = await m.toXML(rootElement, { format: true });
  return xml;
}

/**
 * Does this document already carry Diagram Interchange?
 * A document with even a partial `<bpmndi:BPMNDiagram>` counts as "has DI":
 * per the layout-guard spec, partial DI is treated as present and is NOT
 * re-laid out.
 */
export function hasDI(rootElement) {
  return Array.isArray(rootElement.diagrams) && rootElement.diagrams.length > 0;
}

/** Cheap textual DI probe for raw XML, before a full parse. */
export function xmlHasDI(xml) {
  return /<(\w+:)?BPMNDiagram[\s>]/.test(xml) || /<bpmndi:/.test(xml);
}

/**
 * Lay out a semantics-only document. Throws if the input already carries DI —
 * the caller is responsible for the "layout only when DI absent" rule and must
 * not call this on a DI-bearing document.
 */
export async function layout(xml) {
  if (xmlHasDI(xml)) {
    throw new Error('layout() called on a document that already carries DI; ' +
      'existing layout must be preserved, never re-laid out');
  }
  return layoutProcess(xml);
}
