// Authoring envelope — the semantics-only generation contract (§3).
//
// Confines GENERATED BPMN to the measured-safe construct set, rejects geometry,
// vendor namespaces and the three data-loss constructs (inline subProcess,
// collaboration, laneSet) plus messageFlow, each with a specific substitution
// diagnostic. Governs AUTHORING only; ingestion of laid-out files is lenient
// (see checkIngested).

// Constructs the authoring step may generate. `serviceTask`/`userTask` are
// covered by fixture 1-linear, `task` by 2-gateway; the rest are provisional
// and each is confirmed by its own fixture (scripts/fixtures.mjs) before
// implementation proceeds against it.
export const ALLOW_LIST = [
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent',
  'task', 'userTask', 'serviceTask', 'businessRuleTask', 'manualTask',
  'scriptTask', 'sendTask', 'receiveTask', 'callActivity',
  'exclusiveGateway', 'parallelGateway', 'boundaryEvent', 'sequenceFlow',
];

// Element-type → identifier prefix (normative table, §4.1).
export const PREFIX = {
  startEvent: 'Start', endEvent: 'End',
  intermediateCatchEvent: 'CatchEvent', intermediateThrowEvent: 'ThrowEvent',
  boundaryEvent: 'Boundary',
  task: 'Activity', userTask: 'Task', serviceTask: 'Service',
  businessRuleTask: 'Rule', manualTask: 'Manual', scriptTask: 'Script',
  sendTask: 'Send', receiveTask: 'Receive', callActivity: 'Call',
  exclusiveGateway: 'Gateway', parallelGateway: 'Fork', sequenceFlow: 'Flow',
};

// Bindable element types (a binding/role may target these; must be named).
export const BINDABLE = new Set(['userTask', 'businessRuleTask', 'callActivity']);

const VENDOR_NS = ['camunda', 'zeebe', 'activiti', 'flowable'];

function localName(tag) {
  const m = tag.match(/^<\/?([A-Za-z0-9_]+:)?([A-Za-z0-9_]+)/);
  return m ? { prefix: (m[1] || '').replace(':', ''), name: m[2] } : null;
}

/**
 * Check AUTHORED (generated) BPMN XML against the envelope. Returns
 * { ok, diagnostics:[{code, message}] }. Any diagnostic is a hard error:
 * authoring aborts. No element is ever dropped silently.
 */
export function checkAuthored(xml) {
  const d = [];
  const add = (code, message) => d.push({ code, message });

  // Semantics-only: reject any DI or hand-written coordinate.
  if (/<(\w+:)?BPMNDiagram[\s>]/.test(xml) || /<bpmndi:/.test(xml)) {
    add('DI-PRESENT', 'authored output contains bpmndi: geometry; coordinates are produced exclusively by the layout step, not authored');
  }
  if (/<(\w+:)?Bounds[\s/>]/.test(xml) || /<dc:Bounds/.test(xml)) {
    add('DC-BOUNDS', 'authored output contains a dc:Bounds element; coordinates are produced by the layout step');
  }
  if (/<(\w+:)?waypoint[\s/>]/.test(xml) || /<di:waypoint/.test(xml)) {
    add('DI-WAYPOINT', 'authored output contains a di:waypoint; edge geometry is produced by the layout step');
  }

  // Plain BPMN 2.0 only: reject vendor namespaces, elements, attributes.
  for (const ns of VENDOR_NS) {
    if (new RegExp(`xmlns:${ns}\\s*=`).test(xml) || new RegExp(`[<\\s]${ns}:`).test(xml)) {
      add('VENDOR-NS', `authored output references the '${ns}:' vendor namespace; the .bpmn must stay plain BPMN 2.0 — put link information in package.yaml, not in a vendor extension`);
    }
  }

  // Rejected data-loss constructs with substitution diagnostics.
  if (/<(\w+:)?subProcess[\s>]/.test(xml)) {
    add('SUBPROCESS', 'inline subProcess is rejected: the layout step assigns child elements coordinates identical to parent-level elements (measured G1+G3 corruption). Emit a callActivity referencing a separate .bpmn file, bound in the manifest with kind: process.');
  }
  if (/<(\w+:)?collaboration[\s>]/.test(xml)) {
    add('COLLABORATION', 'collaboration/participant is rejected: the layout step lays out only the first process, so further participants, lanes and message flows lose geometry. Emit one .bpmn file per participant, each bound with kind: participant.');
  }
  if (/<(\w+:)?laneSet[\s>]/.test(xml)) {
    add('LANESET', 'laneSet/lane is rejected: lane shapes are never emitted by the layout step. Use manifest roles entries instead.');
  }
  if (/<(\w+:)?messageFlow[\s>]/.test(xml)) {
    add('MESSAGEFLOW', 'messageFlow is rejected: pool decomposition into one file per participant leaves cross-participant message flows unrepresentable in this change. sendTask/receiveTask are allowed but their counterpart link is not drawn.');
  }

  // Multiple boundary events on one activity — measured to OVERLAP (fixture
  // provisional/multi-boundary: two boundary events land at 190.33–226.33 and
  // 223.66–259.66, both y=92, colliding). A SINGLE boundary event is supported
  // (fixture 3-boundary passes); a second on the same host is outside the
  // measured-safe envelope (2.3a/2.3b).
  {
    const attach = {};
    const be = /<(\w+:)?boundaryEvent\b[^>]*\battachedToRef="([^"]+)"/g;
    let bm;
    while ((bm = be.exec(xml))) { attach[bm[2]] = (attach[bm[2]] || 0) + 1; }
    for (const [host, count] of Object.entries(attach)) {
      if (count > 1) add('MULTI-BOUNDARY', `activity '${host}' carries ${count} boundary events; the layout step overlaps multiple boundary events on one activity (measured), so only a single boundary event per activity is supported. Split the interruptions across separate activities.`);
    }
  }

  // Supported-construct allow-list: reject any flow element outside the list.
  // Scan element tags in the bpmn namespace that are flow elements.
  const tagRe = /<(\w+):([A-Za-z][A-Za-z0-9]*)[\s/>]/g;
  const seen = new Set();
  let m;
  const NON_FLOW = new Set([
    'definitions', 'process', 'incoming', 'outgoing', 'extensionElements',
    'documentation', 'text', 'flowNodeRef', 'timerEventDefinition',
    'messageEventDefinition', 'errorEventDefinition', 'signalEventDefinition',
    'conditionExpression', 'multiInstanceLoopCharacteristics', 'ioSpecification',
    'dataInput', 'dataOutput', 'property',
  ]);
  while ((m = tagRe.exec(xml))) {
    const [, prefix, name] = m;
    if (prefix === 'bpmndi' || prefix === 'dc' || prefix === 'di') continue;
    if (NON_FLOW.has(name)) continue;
    if (name.endsWith('EventDefinition')) continue;
    seen.add(name);
  }
  for (const name of seen) {
    // messageFlow/subProcess/collaboration/laneSet already reported above
    if (['subProcess', 'collaboration', 'laneSet', 'lane', 'participant', 'messageFlow'].includes(name)) continue;
    if (!ALLOW_LIST.includes(name)) {
      add('NOT-ALLOWED', `construct '${name}' is not in the authoring allow-list; only measured-safe constructs may be generated (see references/authoring-envelope.md)`);
    }
  }

  return { ok: d.length === 0, diagnostics: d };
}

/**
 * Ingestion posture: a file authored elsewhere and carrying DI is lenient —
 * a rejected construct becomes a WARNING, not a refusal, because the envelope
 * governs generation, not ingestion of already-laid-out diagrams. A DI-LESS
 * ingested file is handled by the layout guard's strict precedence instead
 * (refused if it contains a rejected construct) — see scripts/view.mjs.
 */
export function checkIngestedWithDI(xml) {
  const warnings = [];
  if (/<(\w+:)?subProcess[\s>]/.test(xml)) warnings.push('file contains an inline subProcess (rendered as authored; the envelope only governs generation)');
  if (/<(\w+:)?laneSet[\s>]/.test(xml)) warnings.push('file contains lanes (rendered as authored)');
  if (/<(\w+:)?collaboration[\s>]/.test(xml)) warnings.push('file contains a collaboration (rendered as authored)');
  return { ok: true, warnings };
}

/**
 * Non-fatal authoring warnings (§8.8). A sendTask/receiveTask is accepted, but
 * its message-flow counterpart is not drawn (pool decomposition), so the author
 * is warned that the link is not rendered.
 */
export function authoringWarnings(xml) {
  const warnings = [];
  if (/<(\w+:)?sendTask[\s>]/.test(xml) || /<(\w+:)?receiveTask[\s>]/.test(xml)) {
    warnings.push({ code: 'UNLINKED-MESSAGE-TASK', message: 'the process contains a sendTask/receiveTask; its message-flow counterpart in another participant is not drawn (cross-participant message flows are unrepresentable after pool decomposition in this change)' });
  }
  return warnings;
}

/** Which rejected construct (if any) a DI-less ingested file contains. */
export function rejectedConstructIn(xml) {
  const r = checkAuthored(xml);
  const blocking = r.diagnostics.filter((x) => ['SUBPROCESS', 'COLLABORATION', 'LANESET', 'MESSAGEFLOW'].includes(x.code));
  return blocking.length ? blocking : null;
}
