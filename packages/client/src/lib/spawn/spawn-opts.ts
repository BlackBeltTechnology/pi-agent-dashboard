/**
 * Spawn option builders shared by SessionList and App.
 * See change: add-spawn-model-choice (design D7).
 */
import { getEffectiveSpawnChoice } from "./spawn-choice-memory.js";

interface SiblingSource {
  driver?: string;
  acpAgentId?: string;
  model?: string;
  thinkingLevel?: string;
}

/**
 * A sibling reuses the source session's agent (ACP) or, for a pi source, its
 * `model` / `thinkingLevel` — each only when a non-empty string. `undefined`
 * when there is nothing to carry (the pre-change call shape).
 */
export function siblingSpawnOpts(s: SiblingSource): { agent?: string; model?: string; thinkingLevel?: string } | undefined {
  if (s.driver === "acp") return s.acpAgentId ? { agent: s.acpAgentId } : undefined;
  const opts: { model?: string; thinkingLevel?: string } = {};
  if (typeof s.model === "string" && s.model.length > 0) opts.model = s.model;
  if (typeof s.thinkingLevel === "string" && s.thinkingLevel.length > 0) opts.thinkingLevel = s.thinkingLevel;
  return opts.model || opts.thinkingLevel ? opts : undefined;
}

/** Initialize project: always pi, with the folder's effective model choice. */
export function initializeSpawnOpts(cwd: string, initialPrompt: string): { initialPrompt: string; model?: string; thinkingLevel?: string } {
  return { initialPrompt, ...getEffectiveSpawnChoice(cwd) };
}
