// Layout guard — verifies a laid-out BPMN document against its own semantics.
//
// Every measured failure mode of `bpmn-auto-layout` produces schema-valid XML
// that parses through `bpmn-moddle` with zero errors (see references/
// layout-envelope.md). Verification therefore compares the DI against the
// semantics along two axes — Presence (P1–P3) and Geometry (G1–G5) — plus the
// collaboration data-loss signature. It NEVER relies on the layout function
// raising.
//
// Two modes (layout-guard spec "Two guard modes with an explicit precedence"):
//   * strict   — geometry produced by THIS run. Any violation aborts (ok:false).
//                This is where "no corrupt diagram is ever written" holds.
//   * advisory — geometry already on disk when read. Every violation is a
//                warning; the document still renders (ok:true). G4 is not even
//                evaluated in advisory mode (negative coords are legal DI).
//
// Provenance is computed, not historical: geometry produced by the current
// layout run is strict; geometry already present on disk is advisory.

const FLOW_NODE_TYPES = new Set([
  'bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent',
  'bpmn:Task', 'bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:BusinessRuleTask',
  'bpmn:ManualTask', 'bpmn:ScriptTask', 'bpmn:SendTask', 'bpmn:ReceiveTask',
  'bpmn:CallActivity', 'bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction',
  'bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:InclusiveGateway',
  'bpmn:ComplexGateway', 'bpmn:EventBasedGateway',
]);
const CONTAINER_TYPES = new Set([
  'bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction',
]);
const ARTIFACT_TYPES = new Set([
  'bpmn:TextAnnotation', 'bpmn:Group', 'bpmn:DataObjectReference',
  'bpmn:DataStoreReference', 'bpmn:DataObject', 'bpmn:DataStoreReference',
]);
const FLOW_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

/**
 * Walk the semantics of a parsed Definitions.
 * Returns maps keyed by element id.
 */
export function collectSemantics(rootElement) {
  const flowNodes = new Map(); // id -> { type, parentId|null, attachedTo|null, isContainer }
  const flows = new Map();     // id -> { type }
  const participants = new Map(); // id -> { processRef }
  const lanes = new Map();     // id -> { name }
  const artifacts = new Map(); // id -> { type }
  const containerChildren = new Map(); // containerId -> Set(childId)

  const roots = rootElement.rootElements || [];

  function walkProcess(proc, ownerContainerId) {
    for (const fe of proc.flowElements || []) {
      const t = fe.$type;
      if (FLOW_TYPES.has(t)) {
        flows.set(fe.id, { type: t });
      } else if (ARTIFACT_TYPES.has(t)) {
        artifacts.set(fe.id, { type: t });
      } else if (FLOW_NODE_TYPES.has(t)) {
        const isContainer = CONTAINER_TYPES.has(t);
        flowNodes.set(fe.id, {
          type: t,
          parentId: ownerContainerId || null,
          attachedTo: fe.attachedToRef ? fe.attachedToRef.id : null,
          isContainer,
        });
        if (ownerContainerId) {
          if (!containerChildren.has(ownerContainerId)) containerChildren.set(ownerContainerId, new Set());
          containerChildren.get(ownerContainerId).add(fe.id);
        }
        if (isContainer) walkProcess(fe, fe.id); // recurse into sub-process children
      } else {
        // artifacts not in the set, or unknown — record loosely as artifact
        artifacts.set(fe.id, { type: t });
      }
    }
    for (const ls of proc.laneSets || []) {
      for (const lane of ls.lanes || []) lanes.set(lane.id, { name: lane.name || null });
    }
    // artifacts array (annotations/associations live here in some models)
    for (const a of proc.artifacts || []) {
      if (a.$type === 'bpmn:Association') continue;
      artifacts.set(a.id, { type: a.$type });
    }
  }

  for (const r of roots) {
    if (r.$type === 'bpmn:Process') {
      walkProcess(r, null);
    } else if (r.$type === 'bpmn:Collaboration') {
      for (const p of r.participants || []) {
        participants.set(p.id, { processRef: p.processRef ? p.processRef.id : null });
      }
      for (const mf of r.messageFlows || []) flows.set(mf.id, { type: 'bpmn:MessageFlow' });
    }
  }
  // processes referenced by participants but sitting as sibling rootElements
  for (const r of roots) {
    if (r.$type === 'bpmn:Process') { /* already walked above */ }
  }

  return { flowNodes, flows, participants, lanes, artifacts, containerChildren };
}

/** Collect DI: shapes and edges across every plane. */
export function collectDI(rootElement) {
  const shapes = new Map(); // bpmnElementId -> [ { bounds, isExpanded, planeId } ]
  const edges = new Map();  // bpmnElementId -> [ { waypoints, planeId } ]
  const planeOf = new Map(); // bpmnElementId -> planeId (first)
  const planes = [];

  for (const dia of rootElement.diagrams || []) {
    const plane = dia.plane;
    if (!plane) continue;
    const planeId = plane.bpmnElement ? plane.bpmnElement.id : `plane_${planes.length}`;
    planes.push(planeId);
    for (const pe of plane.planeElement || []) {
      const ref = pe.bpmnElement ? pe.bpmnElement.id : null;
      if (pe.$type === 'bpmndi:BPMNShape') {
        const b = pe.bounds || {};
        const entry = { bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, isExpanded: pe.isExpanded, planeId };
        if (!shapes.has(ref)) shapes.set(ref, []);
        shapes.get(ref).push(entry);
        if (!planeOf.has(ref)) planeOf.set(ref, planeId);
      } else if (pe.$type === 'bpmndi:BPMNEdge') {
        const entry = { waypoints: pe.waypoint || [], planeId };
        if (!edges.has(ref)) edges.set(ref, []);
        edges.get(ref).push(entry);
      }
    }
  }
  return { shapes, edges, planeOf, planes };
}

function boundsEqual(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}
function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
         inner.x + inner.width <= outer.x + outer.width &&
         inner.y + inner.height <= outer.y + outer.height;
}

/**
 * Run the guard.
 * @param rootElement parsed Definitions
 * @param opts { mode: 'strict'|'advisory' }
 * @returns { ok, mode, violations:[{code,elements,detail,corrective}], warnings:[...] }
 *          In strict mode ok is false when any violation exists.
 *          In advisory mode ok is always true; violations are reported as warnings.
 */
export function runGuard(rootElement, { mode = 'strict' } = {}) {
  const sem = collectSemantics(rootElement);
  const di = collectDI(rootElement);
  const v = []; // violations

  const record = (code, elements, detail, corrective) =>
    v.push({ code, elements, detail, corrective });

  // ── Presence ──────────────────────────────────────────────────────────
  // P1 — every flow node, participant and lane owns exactly one BPMNShape.
  const shapeBearing = [
    ...[...sem.flowNodes.keys()].map((id) => [id, 'flow node']),
    ...[...sem.participants.keys()].map((id) => [id, 'participant']),
    ...[...sem.lanes.keys()].map((id) => [id, 'lane']),
  ];
  const missingShape = [];
  for (const [id, what] of shapeBearing) {
    const n = (di.shapes.get(id) || []).length;
    if (n !== 1) missingShape.push({ id, what, count: n });
  }
  if (missingShape.length) {
    record('P1', missingShape.map((m) => m.id),
      `every flow node, participant and lane must own exactly one BPMNShape; ` +
      missingShape.map((m) => `${m.id} (${m.what}) has ${m.count}`).join(', '),
      'ensure the layout produced a shape for each semantic element; a collaboration ' +
      'or lane set that lost geometry must be emitted as one .bpmn per participant ' +
      'with kind: participant bindings, and lanes as manifest roles');
  }

  // P2 — every sequence/message flow owns exactly one edge with >= 2 waypoints.
  const badEdge = [];
  for (const [id] of sem.flows) {
    const list = di.edges.get(id) || [];
    if (list.length !== 1) { badEdge.push({ id, reason: `owns ${list.length} edges` }); continue; }
    const wp = list[0].waypoints || [];
    if (wp.length < 2) badEdge.push({ id, reason: `edge carries ${wp.length} waypoints` });
  }
  if (badEdge.length) {
    record('P2', badEdge.map((b) => b.id),
      `every sequenceFlow/messageFlow must own one BPMNEdge with >= 2 waypoints; ` +
      badEdge.map((b) => `${b.id} ${b.reason}`).join(', '),
      'regenerate layout; a waypoint-less or missing edge indicates a layout failure');
  }

  // P3 — no shape or edge references an element absent from the semantics.
  const known = new Set([
    ...sem.flowNodes.keys(), ...sem.participants.keys(), ...sem.lanes.keys(),
    ...sem.flows.keys(), ...sem.artifacts.keys(),
  ]);
  const extraneous = [];
  for (const id of di.shapes.keys()) if (id && !known.has(id)) extraneous.push(`shape ${id}`);
  for (const id of di.edges.keys()) if (id && !known.has(id)) extraneous.push(`edge ${id}`);
  if (extraneous.length) {
    record('P3', extraneous,
      `DI references elements absent from the semantics: ${extraneous.join(', ')}`,
      'remove the extraneous geometry; the DI must reference only semantic elements');
  }

  // Collaboration data-loss signature: a declared participant/lane with no shape.
  // (Already covered by P1, but name it explicitly for the collaboration case.)
  const lostCollab = missingShape.filter((m) => m.what !== 'flow node' && m.count === 0);
  if (lostCollab.length) {
    record('COLLAB', lostCollab.map((m) => m.id),
      `only the first process received a plane; these received no shape: ` +
      lostCollab.map((m) => `${m.id} (${m.what})`).join(', '),
      'emit one .bpmn per participant with kind: participant bindings, and lanes as manifest roles');
  }

  // ── Geometry ──────────────────────────────────────────────────────────
  // Build per-plane shape lists (single-shape elements only; ignore missing).
  const perPlane = new Map(); // planeId -> [ {id, bounds, type} ]
  for (const [id, list] of di.shapes) {
    for (const s of list) {
      if (!perPlane.has(s.planeId)) perPlane.set(s.planeId, []);
      const type = sem.flowNodes.get(id)?.type || sem.participants.get(id)?.type ||
        (sem.lanes.has(id) ? 'bpmn:Lane' : (sem.artifacts.get(id)?.type || 'unknown'));
      perPlane.get(s.planeId).push({ id, bounds: s.bounds, type });
    }
  }

  // G1 — no two shapes in a plane share identical bounds.
  for (const [planeId, list] of perPlane) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.bounds.x != null && boundsEqual(a.bounds, b.bounds)) {
          record('G1', [a.id, b.id],
            `${a.id} and ${b.id} share identical bounds ` +
            `${a.bounds.x},${a.bounds.y},${a.bounds.width},${a.bounds.height} in plane ${planeId}`,
            'this is the measured inline-subProcess corruption signature; replace the ' +
            'sub-process with a callActivity + separate .bpmn file + kind: process binding');
        }
      }
    }
  }

  // G2 — every shape has non-zero width and height.
  for (const [id, list] of di.shapes) {
    for (const s of list) {
      if (!(s.bounds.width > 0) || !(s.bounds.height > 0)) {
        record('G2', [id],
          `${id} has zero-or-negative size ${s.bounds.width}x${s.bounds.height}`,
          'a shape must have positive width and height; regenerate layout');
      }
    }
  }

  // G3 — a child of an expanded container lies within that container's bounds.
  for (const [containerId, childIds] of sem.containerChildren) {
    const contShapes = di.shapes.get(containerId) || [];
    if (!contShapes.length) continue;
    const cont = contShapes[0];
    // Only enforce for an EXPANDED container whose children sit in the same plane.
    const expanded = cont.isExpanded !== false;
    if (!expanded) continue;
    for (const childId of childIds) {
      const cs = (di.shapes.get(childId) || [])[0];
      if (!cs) continue;
      if (cs.planeId !== cont.planeId) continue; // collapsed-plane children exempt
      if (cont.bounds.x != null && cs.bounds.x != null && !contains(cont.bounds, cs.bounds)) {
        record('G3', [containerId, childId],
          `child ${childId} at ${cs.bounds.x},${cs.bounds.y},${cs.bounds.width},${cs.bounds.height} ` +
          `lies outside expanded container ${containerId} bounds ` +
          `${cont.bounds.x},${cont.bounds.y},${cont.bounds.width},${cont.bounds.height}`,
          'this is the measured inline-subProcess corruption signature; replace the ' +
          'sub-process with a callActivity + separate .bpmn file + kind: process binding');
      }
    }
  }

  // G4 — no negative coordinate. STRICT MODE ONLY.
  if (mode === 'strict') {
    for (const [id, list] of di.shapes) {
      for (const s of list) {
        if (s.bounds.x < 0 || s.bounds.y < 0) {
          record('G4', [id],
            `${id} has a negative coordinate ${s.bounds.x},${s.bounds.y}`,
            'generated geometry must not be negative; regenerate layout');
        }
      }
    }
  }

  // G5 — no overlap between FLOW NODE shapes not in host/boundary or container/child.
  for (const [planeId, list] of perPlane) {
    const flowNodeShapes = list.filter((s) => sem.flowNodes.has(s.id) && !CONTAINER_TYPES.has(s.type));
    for (let i = 0; i < flowNodeShapes.length; i++) {
      for (let j = i + 1; j < flowNodeShapes.length; j++) {
        const a = flowNodeShapes[i], b = flowNodeShapes[j];
        if (a.bounds.x == null || b.bounds.x == null) continue;
        if (!rectsOverlap(a.bounds, b.bounds)) continue;
        // exempt host/boundary
        const an = sem.flowNodes.get(a.id), bn = sem.flowNodes.get(b.id);
        if (an.attachedTo === b.id || bn.attachedTo === a.id) continue;
        // exempt container/child
        if (an.parentId === b.id || bn.parentId === a.id) continue;
        record('G5', [a.id, b.id],
          `flow-node shapes ${a.id} and ${b.id} overlap and are not in a ` +
          `host/boundary or container/child relationship`,
          'regenerate layout; unrelated flow nodes must not overlap');
      }
    }
  }

  const ok = mode === 'advisory' ? true : v.length === 0;
  return {
    ok,
    mode,
    violations: mode === 'strict' ? v : [],
    warnings: mode === 'advisory' ? v : [],
  };
}

/** Format a guard result as human diagnostics. */
export function formatDiagnostics(result) {
  const items = result.mode === 'advisory' ? result.warnings : result.violations;
  return items.map((it) =>
    `[${it.code}] elements: ${it.elements.join(', ')}\n  ${it.detail}\n  → ${it.corrective}`
  ).join('\n');
}
