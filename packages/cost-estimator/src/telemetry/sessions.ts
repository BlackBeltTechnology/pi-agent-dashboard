/**
 * Read pi session logs and derive measured delivery constants.
 *
 * THE ONLY MODULE IN THIS PACKAGE THAT TOUCHES THE SESSION STORE.
 * The engine under ../engine stays zero-dependency and portable; this adapter
 * is where the workspace dependencies live. Keep that seam intact — it is what
 * lets the estimator run in a project with no dashboard installed.
 *
 * Session store layout:
 *   ~/.pi/agent/sessions/<slugified-cwd>/<timestamp>_<uuid>.jsonl
 *   ~/.pi/agent/sessions/<slugified-cwd>/<timestamp>_<uuid>.meta.json
 *
 * The `.jsonl` carries per-record timestamps (active-time measurement); the
 * `.meta.json` carries token counts and the real billed cost. Both are read
 * through the shared readers rather than re-parsed here, so a session-schema
 * change lands in one place instead of silently rotting the calibration.
 *
 * ACTIVE TIME METHOD: sum the gaps between consecutive records, capping any gap
 * longer than `gapCapMinutes` at the cap. A long gap is a break, not work.
 * This is the same method that produced the locally measured steering figures.
 */

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { SessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { readSession } from "@blackbelt-technology/pi-dashboard-session-distiller/jsonl-reader.js";

export interface SessionRecord {
  file: string;
  project: string;
  name: string | null;
  startedAt: number | null;
  activeHours: number;
  wallHours: number;
  humanTurns: number;
  assistantTurns: number;
  toolCalls: number;
  toolResults: number;
  toolErrors: number;
  corrections: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
}

export interface ScanOptions {
  root?: string;
  gapCapMinutes?: number;
  /** Case-insensitive substring filter on the project path. */
  project?: string;
  /** Only sessions started on or after this ISO date. */
  since?: string;
  /** Ignore trivial sessions below this active-hour threshold. */
  minActiveHours?: number;
  /** Ignore sessions with fewer assistant turns than this. */
  minAssistantTurns?: number;
}

const CORRECTION =
  /(^|\s)(no,|nope|wrong|instead|revert|undo|don't|do not|stop|that's not|thats not|not what|fix that|redo|again,|rather)/i;
const TOOL_ERROR = /^(error|Error:|Traceback|command failed|exit code [1-9]|FAIL|not found|Cannot |ENOENT)/i;

export function defaultSessionRoot(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

/** Collapse a worktree path back to its parent repository. */
export function normalizeProject(cwd: string | undefined): string {
  if (!cwd) return '(unknown)';
  const home = homedir();
  let path = cwd.startsWith(home) ? cwd.slice(home.length + 1) : cwd;
  const worktree = path.indexOf('/.worktrees/');
  if (worktree >= 0) path = path.slice(0, worktree);
  return path;
}

/** Scan the session store and return one record per usable session. */
export function scanSessions(options: ScanOptions = {}): SessionRecord[] {
  const root = options.root ?? defaultSessionRoot();
  const gapCap = (options.gapCapMinutes ?? 15) * 60_000;
  const minActive = options.minActiveHours ?? 0.25;
  const minTurns = options.minAssistantTurns ?? 3;
  const since = options.since ? Date.parse(options.since) : null;
  const filter = options.project?.toLowerCase();

  const out: SessionRecord[] = [];
  for (const dir of safeReaddir(root)) {
    const dirPath = join(root, dir);
    if (!isDirectory(dirPath)) continue;
    for (const file of safeReaddir(dirPath)) {
      if (!file.endsWith(".jsonl")) continue;
      const record = readSessionRecord(join(dirPath, file), gapCap);
      if (!record) continue;
      if (record.activeHours < minActive) continue;
      if (record.assistantTurns < minTurns) continue;
      if (since && (record.startedAt ?? 0) < since) continue;
      if (filter && !record.project.toLowerCase().includes(filter)) continue;
      out.push(record);
    }
  }
  return out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSessionRecord(jsonlPath: string, gapCap: number): SessionRecord | null {
  // `readSessionMeta` resolves the sibling .meta.json itself.
  const meta: SessionMeta | undefined = readSessionMeta(jsonlPath);
  if (!meta) return null;

  const { events } = readSession(jsonlPath);
  if (!events || events.length === 0) return null;

  const stamps: number[] = [];
  let humanTurns = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let toolErrors = 0;
  let corrections = 0;

  for (const entry of events as unknown as Array<Record<string, unknown>>) {
    if (entry.type !== "message") continue;

    const stamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    if (Number.isFinite(stamp)) stamps.push(stamp);

    const message = entry.message as { role?: string; content?: unknown } | undefined;
    if (!message) continue;

    let text = "";
    if (Array.isArray(message.content)) {
      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block?.type === "text") text += (block.text as string) ?? "";
        else if (block?.type === "toolCall") toolCalls++;
      }
    } else if (typeof message.content === "string") {
      text = message.content;
    }

    if (message.role === "assistant") assistantTurns++;
    else if (message.role === "user") {
      humanTurns++;
      if (CORRECTION.test(text.slice(0, 300))) corrections++;
    } else if (message.role === "toolResult") {
      toolResults++;
      if (TOOL_ERROR.test(text.trim().slice(0, 120))) toolErrors++;
    }
  }

  if (stamps.length < 2) return null;
  stamps.sort((a, b) => a - b);

  let active = 0;
  for (let i = 1; i < stamps.length; i++) active += Math.min(stamps[i] - stamps[i - 1], gapCap);

  return {
    file: jsonlPath,
    project: normalizeProject(meta.cwd),
    name: meta.name ?? null,
    startedAt: meta.startedAt ?? stamps[0],
    activeHours: active / 3_600_000,
    wallHours: (stamps[stamps.length - 1] - stamps[0]) / 3_600_000,
    humanTurns,
    assistantTurns,
    toolCalls,
    toolResults,
    toolErrors,
    corrections,
    tokensIn: meta.tokensIn ?? 0,
    tokensOut: meta.tokensOut ?? 0,
    cacheRead: meta.cacheRead ?? 0,
    cacheWrite: meta.cacheWrite ?? 0,
    cost: meta.cost ?? 0,
    model: meta.model ?? null,
  };
}

export interface ProjectAggregate {
  project: string;
  sessions: number;
  activeHours: number;
  steeringDays: number;
  cost: number;
  costPerHour: number;
  tokensOut: number;
  cacheRead: number;
  humanTurns: number;
  assistantTurns: number;
  toolCalls: number;
}

/** Aggregate sessions per project. */
export function aggregateByProject(records: SessionRecord[], hoursPerDay = 8): ProjectAggregate[] {
  const map = new Map<string, ProjectAggregate>();
  for (const record of records) {
    let agg = map.get(record.project);
    if (!agg) {
      agg = {
        project: record.project,
        sessions: 0,
        activeHours: 0,
        steeringDays: 0,
        cost: 0,
        costPerHour: 0,
        tokensOut: 0,
        cacheRead: 0,
        humanTurns: 0,
        assistantTurns: 0,
        toolCalls: 0,
      };
      map.set(record.project, agg);
    }
    agg.sessions++;
    agg.activeHours += record.activeHours;
    agg.cost += record.cost;
    agg.tokensOut += record.tokensOut;
    agg.cacheRead += record.cacheRead;
    agg.humanTurns += record.humanTurns;
    agg.assistantTurns += record.assistantTurns;
    agg.toolCalls += record.toolCalls;
  }
  for (const agg of map.values()) {
    agg.steeringDays = agg.activeHours / hoursPerDay;
    agg.costPerHour = agg.activeHours > 0 ? agg.cost / agg.activeHours : 0;
  }
  return [...map.values()].sort((a, b) => b.activeHours - a.activeHours);
}

export interface MeasuredConstants {
  sessions: number;
  activeHours: number;
  steeringDays: number;
  totalCost: number;
  /** Real billed cost per active steering hour — the most robust agentic cost driver. */
  costPerSteeringHour: number;
  costPerSteeringDay: number;
  /** ACEM Context Factor, measured as cache-read per turn in long vs short sessions. */
  contextFactor: number;
  /** ACEM Revision Factor LOWER BOUND: tool-error rate + human-correction rate. */
  revisionFactorLowerBound: number;
  toolErrorRate: number;
  correctionRate: number;
  /** Output tokens as a share of all tokens billed. */
  outputShare: number;
  outputTokensPerHour: number;
  assistantPerHumanTurn: number;
  toolCallsPerHour: number;
  cacheReadShare: number;
  /** Calendar months with meaningful activity. */
  activeMonths: number;
  /** Mean active steering hours per active month. */
  hoursPerMonth: number;
  /** Mean meter-equivalent spend per active month — what a subscription must beat. */
  meterPerMonth: number;
  /** Share of active hours on models the meter priced at zero (routed/subscription-billed). */
  unmeteredHourShare: number;
}

export interface SubscriptionComparison {
  monthlySeatCost: number;
  months: number;
  subscriptionCost: number;
  meterEquivalent: number;
  /** Meter-equivalent divided by subscription cost. Above 1 means the plan pays for itself. */
  leverage: number;
  effectiveCostPerHour: number;
  meteredCostPerHour: number;
}

/**
 * Compare what the measured work actually cost on a seat plan against what the
 * same work would have cost on the token meter.
 *
 * The gap is subscription LEVERAGE. It is not a saving already banked — it is the
 * on-demand value the flat plan captured.
 */
export function compareSubscription(
  measured: MeasuredConstants,
  monthlySeatCost: number,
  months?: number,
): SubscriptionComparison {
  const period = months ?? measured.activeMonths;
  const subscriptionCost = monthlySeatCost * period;
  return {
    monthlySeatCost,
    months: period,
    subscriptionCost,
    meterEquivalent: measured.totalCost,
    leverage: subscriptionCost > 0 ? measured.totalCost / subscriptionCost : 0,
    effectiveCostPerHour: measured.activeHours > 0 ? subscriptionCost / measured.activeHours : 0,
    meteredCostPerHour: measured.costPerSteeringHour,
  };
}

/** Derive the measured constants the estimator needs. */
export function measureConstants(records: SessionRecord[], hoursPerDay = 8): MeasuredConstants {
  const sum = (pick: (r: SessionRecord) => number) => records.reduce((s, r) => s + pick(r), 0);

  const activeHours = sum((r) => r.activeHours);
  const totalCost = sum((r) => r.cost);
  const tokensOut = sum((r) => r.tokensOut);
  const tokensIn = sum((r) => r.tokensIn);
  const cacheRead = sum((r) => r.cacheRead);
  const cacheWrite = sum((r) => r.cacheWrite);
  const allTokens = tokensOut + tokensIn + cacheRead + cacheWrite;
  const toolResults = sum((r) => r.toolResults);
  const toolErrors = sum((r) => r.toolErrors);
  const humanTurns = sum((r) => r.humanTurns);
  const corrections = sum((r) => r.corrections);

  // Context Factor: how much more context a long session re-reads per turn.
  const short = records.filter((r) => r.assistantTurns <= 20);
  const long = records.filter((r) => r.assistantTurns >= 60);
  const perTurn = (group: SessionRecord[]) => {
    const turns = group.reduce((s, r) => s + r.assistantTurns, 0);
    return turns > 0 ? group.reduce((s, r) => s + r.cacheRead, 0) / turns : 0;
  };
  const shortPerTurn = perTurn(short);
  const longPerTurn = perTurn(long);
  const contextFactor = shortPerTurn > 0 && longPerTurn > 0 ? longPerTurn / shortPerTurn : 1;

  const toolErrorRate = toolResults > 0 ? toolErrors / toolResults : 0;
  const correctionRate = humanTurns > 0 ? corrections / humanTurns : 0;

  // Calendar spread: subscription cost is per month, so months are a cost driver.
  const monthly = new Map<string, number>();
  for (const record of records) {
    if (!record.startedAt) continue;
    const key = new Date(record.startedAt).toISOString().slice(0, 7);
    monthly.set(key, (monthly.get(key) ?? 0) + record.activeHours);
  }
  const activeMonths = [...monthly.values()].filter((h) => h >= 1).length || monthly.size || 1;

  // Hours the meter priced at zero: routed or subscription-billed models where
  // token cost is not reported. These deflate any $/h figure computed naively.
  const unmeteredHours = records.filter((r) => r.cost === 0).reduce((s, r) => s + r.activeHours, 0);

  return {
    sessions: records.length,
    activeHours,
    steeringDays: activeHours / hoursPerDay,
    totalCost,
    costPerSteeringHour: activeHours > 0 ? totalCost / activeHours : 0,
    costPerSteeringDay: activeHours > 0 ? (totalCost / activeHours) * hoursPerDay : 0,
    contextFactor,
    revisionFactorLowerBound: 1 + toolErrorRate + correctionRate,
    toolErrorRate,
    correctionRate,
    outputShare: allTokens > 0 ? tokensOut / allTokens : 0,
    outputTokensPerHour: activeHours > 0 ? tokensOut / activeHours : 0,
    assistantPerHumanTurn: humanTurns > 0 ? sum((r) => r.assistantTurns) / humanTurns : 0,
    toolCallsPerHour: activeHours > 0 ? sum((r) => r.toolCalls) / activeHours : 0,
    cacheReadShare: allTokens > 0 ? cacheRead / allTokens : 0,
    activeMonths,
    hoursPerMonth: activeHours / activeMonths,
    meterPerMonth: totalCost / activeMonths,
    unmeteredHourShare: activeHours > 0 ? unmeteredHours / activeHours : 0,
  };
}
