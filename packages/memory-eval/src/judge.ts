/**
 * Judge core (design M5): model resolution, argv, batch payloads, answer parsing,
 * verdict cache keys. I/O orchestration lives in commands/judge.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseRoleConfig, resolveModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import type { Case } from "./cases.js";
import type { KeptHit } from "./retriever.js";
import { type ScrubRule, scrubText } from "./scrub.js";
import { CliError, sha256 } from "./util.js";

export const BATCH_SIZE = 10;
export const JUDGE_TIMEOUT_MS = 120_000;
export const DATA_CLASSES = "session prompts, commands, paths, error text, retrieved snippets; known secret shapes scrubbed (best-effort)";

export type VerdictKind = "validity" | "helpfulness";
export type Verdict = "valid" | "invalid" | "helpful" | "not_helpful";
const ALLOWED: Record<VerdictKind, Verdict[]> = { validity: ["valid", "invalid"], helpfulness: ["helpful", "not_helpful"] };

export interface ResolvedJudge {
  /** `@role` when resolved from a role, else undefined. */
  role?: string;
  /** `provider/id[:thinking]`, never an `@role`. */
  ref: string;
  provider: string;
}

export function resolveJudge(spec: string | undefined, providersFile: string): ResolvedJudge {
  const wanted = spec ?? "@review";
  let roles: Record<string, string> = {};
  if (wanted.startsWith("@")) {
    if (!existsSync(providersFile)) {
      throw new CliError(`judge role '${wanted}' cannot be resolved: providers file ${providersFile} does not exist. Configure the role (update_roles / the dashboard Roles panel) or pass --judge provider/id[:thinking]`);
    }
    try {
      roles = parseRoleConfig(JSON.parse(readFileSync(providersFile, "utf8"))).roles;
    } catch (e) {
      throw new CliError(`providers file ${providersFile} is not valid JSON (${(e as Error).message})`);
    }
  }
  const r = resolveModelRef(wanted, { roles });
  if (r.unresolved || !r.model) {
    throw new CliError(
      wanted.startsWith("@")
        ? `judge role '${wanted}' is not configured in ${providersFile}. Configure it (update_roles / the dashboard Roles panel) or pass --judge provider/id[:thinking]`
        : `invalid --judge '${wanted}': ${r.unresolved ?? "no model"}`,
    );
  }
  const ref = r.level ? `${r.model}:${r.level}` : r.model;
  return { ...(r.role ? { role: `@${r.role}` } : {}), ref, provider: r.provider ?? r.model.split("/")[0] };
}

/** The exact argv after the `pi` command. `--no-tools`: the judge reads untrusted text. */
export function judgeArgs(ref: string): string[] {
  return ["-p", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-tools", "--model", ref];
}

export interface JudgeItem {
  /** Item id inside a batch: `v:<caseId>` or `h:<caseId>:<retrieverId>`. */
  id: string;
  kind: VerdictKind;
  caseId: string;
  caseType: string;
  caseContentHash: string;
  retrieverId?: string;
  outputHash?: string;
  query: string;
  context: string;
  snippets?: KeptHit[];
}

export interface VerdictKey {
  kind: VerdictKind;
  caseId: string;
  caseContentHash: string;
  outputHash?: string;
  promptVersion: string;
  promptSha256: string;
  scrubSha256: string;
  judgeModel: string;
}

export const keyString = (k: VerdictKey): string =>
  [k.kind, k.caseId, k.caseContentHash, k.outputHash ?? "", k.promptVersion, k.promptSha256, k.scrubSha256, k.judgeModel].join("\u0001");

export interface VerdictRecord extends VerdictKey {
  retrieverId?: string;
  verdict: Verdict;
  note: string;
  at: string;
}

export function outputHash(retrieverId: string, retrieverVersion: string, top5: KeptHit[]): string {
  return sha256(`${retrieverId}|${retrieverVersion}|${JSON.stringify(top5.map((h) => [h.ref, h.text, h.sessionId ?? null, h.timestamp ?? null]))}`);
}

export function validityItem(c: Case): JudgeItem {
  return { id: `v:${c.id}`, kind: "validity", caseId: c.id, caseType: c.type, caseContentHash: c.contentHash, query: c.query, context: c.context };
}

export function helpfulnessItem(c: Case, retrieverId: string, outHash: string, top5: KeptHit[]): JudgeItem {
  return { id: `h:${c.id}:${retrieverId}`, kind: "helpfulness", caseId: c.id, caseType: c.type, caseContentHash: c.contentHash, retrieverId, outputHash: outHash, query: c.query, context: c.context, snippets: top5 };
}

const esc = (s: string) => s.replace(/<\/data/gi, "<\\/data").replace(/<item /gi, "<\\item ");
const attr = (s: string) => s.replace(/[^\w:.@/-]/g, "_");

/** Build the stdin payload of one batch: prompt, then scrubbed items wrapped as data. */
export function buildBatchPayload(promptText: string, items: JudgeItem[], rules: ScrubRule[]): string {
  const sc = (t: string) => esc(scrubText(t, rules));
  const body = items
    .map((it) => {
      const parts = [`<item id="${attr(it.id)}" kind="${it.kind}" case_type="${it.caseType}">`, `<data name="query">${sc(it.query)}</data>`, `<data name="context">${sc(it.context)}</data>`];
      (it.snippets ?? []).forEach((s, i) => parts.push(`<data name="snippet" n="${i + 1}">${sc(s.text)}</data>`));
      parts.push("</item>");
      return parts.join("\n");
    })
    .join("\n");
  return `${promptText.trim()}\n\n<items>\n${body}\n</items>\n`;
}

export type ParsedAnswer = { ok: true; verdicts: Map<string, { verdict: Verdict; note: string }> } | { ok: false; error: string };

/** Parse the judge's reply; entries with an unknown id or a verdict not allowed for the item's kind are ignored. */
export function parseAnswer(stdout: string, items: JudgeItem[]): ParsedAnswer {
  const text = stdout.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a < 0 || b < a) return { ok: false, error: "no JSON array in the judge's answer" };
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(a, b + 1));
  } catch (e) {
    return { ok: false, error: `unparseable JSON (${(e as Error).message})` };
  }
  if (!Array.isArray(arr)) return { ok: false, error: "answer is not a JSON array" };
  const byId = new Map(items.map((i) => [attr(i.id), i]));
  const verdicts = new Map<string, { verdict: Verdict; note: string }>();
  for (const e of arr) {
    const o = e as { id?: unknown; verdict?: unknown; note?: unknown } | null;
    if (!o || typeof o.id !== "string" || typeof o.verdict !== "string") continue;
    const item = byId.get(o.id);
    if (!item || !(ALLOWED[item.kind] as string[]).includes(o.verdict) || verdicts.has(item.id)) continue;
    verdicts.set(item.id, { verdict: o.verdict as Verdict, note: typeof o.note === "string" ? o.note.slice(0, 200) : "" });
  }
  return { ok: true, verdicts };
}

export function promptVersionOf(path: string): string {
  return path.match(/\.(v\d+)\.md$/)?.[1] ?? "v1";
}
