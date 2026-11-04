// @ts-check
// Page-level decisions: `<mockDir>/decision.json` = { status, by, note?, at };
// open = file absent. Atomic writes, never through a symlink, malformed = open.
// See change: add-live-component-mock-site (design D4, D5).
import * as fs from "node:fs";
import * as path from "node:path";
import { MOCK_ID_RE } from "./refs.mjs";

const STATUSES = /** @type {const} */ (["accepted", "rejected", "open"]);
const NOTE_MAX = 500;

/** @typedef {{ status: "accepted"|"rejected", by: "user"|"agent", note?: string, at: string }} Decision */

/**
 * @param {string} file
 * @returns {{ decision?: Decision, warning?: string }}
 */
export function readDecisionFile(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    const bad = !d || typeof d !== "object" || Array.isArray(d) || (d.status !== "accepted" && d.status !== "rejected")
      || (d.by !== "user" && d.by !== "agent") || (d.note !== undefined && typeof d.note !== "string") || typeof d.at !== "string";
    if (bad) {
      return { warning: `invalid decision (treated as open): ${file}` };
    }
    return { decision: d };
  } catch {
    return { warning: `unreadable decision (treated as open): ${file}` };
  }
}

/**
 * @param {{ id: string, dir: string }[]} mocks
 * @returns {{ decisions: Record<string, Decision>, warnings: string[] }}
 */
export function readDecisions(mocks) {
  /** @type {Record<string, Decision>} */
  const decisions = {};
  /** @type {string[]} */
  const warnings = [];
  for (const m of mocks) {
    const r = readDecisionFile(path.join(m.dir, "decision.json"));
    if (r.decision) decisions[m.id] = r.decision;
    if (r.warning) warnings.push(r.warning);
  }
  return { decisions, warnings };
}

let seq = 0;
/**
 * @param {{ dir: string }} mock
 * @param {{ status: "accepted"|"rejected"|"open", by: "user"|"agent", note?: string }} d
 */
export function writeDecision(mock, d) {
  const file = path.join(mock.dir, "decision.json");
  for (const p of [mock.dir, file]) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error(`refusing symlink: ${p}`);
  }
  if (d.status === "open") { fs.rmSync(file, { force: true }); return; }
  /** @type {Decision} */
  const out = { status: d.status, by: d.by, ...(d.note ? { note: d.note } : {}), at: new Date().toISOString() };
  const tmp = path.join(mock.dir, `.decision.json.tmp-${process.pid}-${++seq}`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Validate a decide request body against the discovered id allow-list.
 * @param {any} body @param {Set<string>} knownIds
 * @returns {{ ok: true, id: string, status: "accepted"|"rejected"|"open", note?: string } | { ok: false, error: string }}
 */
export function validateDecideBody(body, knownIds) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const { id, status, note } = body;
  if (typeof id !== "string" || !MOCK_ID_RE.test(id) || !knownIds.has(id)) return { ok: false, error: "unknown mock id" };
  if (!STATUSES.includes(status)) return { ok: false, error: "status must be accepted|rejected|open" };
  if (note !== undefined && (typeof note !== "string" || [...note].length > NOTE_MAX)) return { ok: false, error: `note must be a string of at most ${NOTE_MAX} characters` };
  return { ok: true, id, status, ...(note ? { note } : {}) };
}
