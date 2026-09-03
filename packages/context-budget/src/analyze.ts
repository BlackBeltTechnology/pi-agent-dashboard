/**
 * Pure analysis of a provider request payload.
 *
 * Everything here operates on a captured payload object — no pi, no network,
 * no filesystem — so the accounting is unit-testable and the numbers are
 * reproducible. Capture happens in meter.ts via `before_provider_request`.
 */

export interface ToolCost {
  name: string;
  bytes: number;
}

export interface SystemBlock {
  label: string;
  bytes: number;
}

export interface SkillCost {
  name: string;
  bytes: number;
}

export interface Breakdown {
  model: string;
  payloadBytes: number;
  systemBytes: number;
  messagesBytes: number;
  toolsBytes: number;
  toolCount: number;
  perTool: ToolCost[];
  systemBlocks: SystemBlock[];
  skills: SkillCost[];
}

export interface BudgetLimits {
  maxPayloadBytes?: number;
  maxToolsBytes?: number;
  maxSkillsBytes?: number;
}

export interface BudgetViolation {
  limit: keyof BudgetLimits;
  actual: number;
  allowed: number;
}

export interface Delta {
  payloadBytesDelta: number;
  systemBytesDelta: number;
  toolsBytesDelta: number;
  toolsAdded: string[];
  toolsRemoved: string[];
  skillsAdded: string[];
  skillsRemoved: string[];
  /** Names that were expected to disappear but are still on the wire. */
  unmetExpectations: string[];
}

const bytes = (v: unknown): number => (v === undefined ? 0 : Buffer.byteLength(JSON.stringify(v)));
const textBytes = (s: string): number => Buffer.byteLength(s);

/** Provider payloads carry `system` as a string or as an array of text blocks. */
function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join("\n");
  }
  return "";
}

function sliceBetween(haystack: string, open: string, close: string): string | undefined {
  const i = haystack.indexOf(open);
  if (i < 0) return undefined;
  const j = haystack.indexOf(close, i);
  if (j < 0) return undefined;
  return haystack.slice(i, j + close.length);
}

function parseSkills(system: string): SkillCost[] {
  const block = sliceBetween(system, "<available_skills>", "</available_skills>");
  if (!block) return [];
  const entries = [...block.matchAll(/<name>([^<]+)<\/name>\s*<description>([\s\S]*?)<\/description>/g)];
  return entries
    .map((m) => ({ name: m[1].trim(), bytes: textBytes(m[0]) }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}

/**
 * Attribute the system prompt to known blocks. `other` absorbs the remainder so
 * the parts always sum to the whole — a block that silently stops matching shows
 * up as `other` growing, rather than as bytes vanishing from the report.
 */
function systemBlocks(system: string): SystemBlock[] {
  const named: SystemBlock[] = [];
  const known: Array<[string, string, string]> = [
    ["skills-catalogue", "<available_skills>", "</available_skills>"],
    ["project-context", "<project_context>", "</project_context>"],
    ["memory-policy", "<memory-policy>", "</memory-policy>"],
  ];

  for (const [label, open, close] of known) {
    const found = sliceBetween(system, open, close);
    if (found) named.push({ label, bytes: textBytes(found) });
  }

  const accounted = named.reduce((sum, b) => sum + b.bytes, 0);
  named.push({ label: "other", bytes: Math.max(0, textBytes(system) - accounted) });
  return named;
}

export function analyzePayload(payload: unknown): Breakdown {
  const p = (payload ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(p.tools) ? (p.tools as Array<Record<string, unknown>>) : [];
  const system = systemText(p.system);

  const perTool = tools
    .map((t) => {
      const fn = t.function as { name?: unknown } | undefined;
      const name = String(t.name ?? fn?.name ?? "?");
      return { name, bytes: bytes(t) };
    })
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  return {
    model: String(p.model ?? "?"),
    payloadBytes: bytes(p),
    systemBytes: textBytes(system),
    messagesBytes: bytes(p.messages),
    toolsBytes: bytes(p.tools),
    toolCount: tools.length,
    perTool,
    systemBlocks: systemBlocks(system),
    skills: parseSkills(system),
  };
}

export function comparePayloads(before: Breakdown, after: Breakdown, opts: { expectRemoved?: string[] } = {}): Delta {
  const beforeTools = before.perTool.map((t) => t.name);
  const afterTools = after.perTool.map((t) => t.name);
  const beforeSkills = before.skills.map((s) => s.name);
  const afterSkills = after.skills.map((s) => s.name);

  const stillPresent = new Set([...afterTools, ...afterSkills]);

  return {
    payloadBytesDelta: after.payloadBytes - before.payloadBytes,
    systemBytesDelta: after.systemBytes - before.systemBytes,
    toolsBytesDelta: after.toolsBytes - before.toolsBytes,
    toolsAdded: afterTools.filter((n) => !beforeTools.includes(n)),
    toolsRemoved: beforeTools.filter((n) => !afterTools.includes(n)),
    skillsAdded: afterSkills.filter((n) => !beforeSkills.includes(n)),
    skillsRemoved: beforeSkills.filter((n) => !afterSkills.includes(n)),
    unmetExpectations: (opts.expectRemoved ?? []).filter((n) => stillPresent.has(n)),
  };
}

export function checkBudget(b: Breakdown, limits: BudgetLimits): { ok: boolean; violations: BudgetViolation[] } {
  const skillsBytes = b.skills.reduce((sum, s) => sum + s.bytes, 0);
  const checks: Array<[keyof BudgetLimits, number]> = [
    ["maxPayloadBytes", b.payloadBytes],
    ["maxToolsBytes", b.toolsBytes],
    ["maxSkillsBytes", skillsBytes],
  ];

  const violations: BudgetViolation[] = [];
  for (const [limit, actual] of checks) {
    const allowed = limits[limit];
    if (allowed !== undefined && actual > allowed) violations.push({ limit, actual, allowed });
  }
  return { ok: violations.length === 0, violations };
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)}KB`;

export function formatReport(b: Breakdown, top = 12): string {
  const skillsBytes = b.skills.reduce((sum, s) => sum + s.bytes, 0);
  const lines = [
    `model            ${b.model}`,
    `payload          ${kb(b.payloadBytes)}  (~${Math.round(b.payloadBytes / 3.8)} tokens)`,
    `  system         ${kb(b.systemBytes)}`,
    ...b.systemBlocks.map((x) => `    ${x.label.padEnd(16)} ${kb(x.bytes)}`),
    `  tools          ${kb(b.toolsBytes)}  (${b.toolCount} tools)`,
    `  messages       ${kb(b.messagesBytes)}`,
    "",
    `skills advertised: ${b.skills.length} (${kb(skillsBytes)})`,
    "",
    `top ${top} tool schemas:`,
    ...b.perTool.slice(0, top).map((t) => `  ${String(t.bytes).padStart(6)}  ${t.name}`),
    "",
    `top ${top} skill entries:`,
    ...b.skills.slice(0, top).map((s) => `  ${String(s.bytes).padStart(6)}  ${s.name}`),
  ];
  return lines.join("\n");
}

export function formatDelta(d: Delta): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  const lines = [
    `payload  ${sign(d.payloadBytesDelta)} B`,
    `system   ${sign(d.systemBytesDelta)} B`,
    `tools    ${sign(d.toolsBytesDelta)} B`,
  ];
  if (d.toolsRemoved.length) lines.push(`tools removed: ${d.toolsRemoved.join(", ")}`);
  if (d.toolsAdded.length) lines.push(`tools added:   ${d.toolsAdded.join(", ")}`);
  if (d.skillsRemoved.length) lines.push(`skills removed (${d.skillsRemoved.length}): ${d.skillsRemoved.join(", ")}`);
  if (d.skillsAdded.length) lines.push(`skills added (${d.skillsAdded.length}): ${d.skillsAdded.join(", ")}`);
  if (d.unmetExpectations.length) {
    lines.push(`UNMET EXPECTATIONS — still on the wire: ${d.unmetExpectations.join(", ")}`);
  }
  return lines.join("\n");
}
