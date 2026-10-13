/**
 * Validation of browser-supplied `model` / `thinkingLevel` before they become
 * pi argv (`--model` / `--thinking`). One helper used by `spawn_session`,
 * `send_prompt` (auto-resume) and `resume_session`.
 *
 * An invalid value is DROPPED with `console.warn`; the operation proceeds
 * without it. Values are only ever passed on as discrete argv elements (the
 * tmux pane path additionally `shellEscape`s each one).
 *
 * See change: redesign-directory-home-split (design D5).
 */
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

export interface SpawnChoice {
  model?: string;
  thinking?: string;
}

const MAX_MODEL_LENGTH = 200;
const PROVIDER_RE = /^[A-Za-z0-9._-]+$/;
const ID_RE = /^[A-Za-z0-9._:@/+-]+$/;

function isThinkingLevel(v: unknown): v is (typeof THINKING_LEVELS)[number] {
  return typeof v === "string" && (THINKING_LEVELS as readonly string[]).includes(v);
}

/** True for `provider/id` within the charset, with no empty or dash-led segment. */
function isValidModel(model: string): boolean {
  if (model.length === 0 || model.length > MAX_MODEL_LENGTH) return false;
  const segments = model.split("/");
  if (segments.length < 2) return false;
  if (segments.some((s) => s.length === 0 || s.startsWith("-"))) return false;
  const [provider, ...rest] = segments;
  return PROVIDER_RE.test(provider ?? "") && ID_RE.test(rest.join("/"));
}

/** Split a trailing `:<canonical level>` off a model id. */
function splitThinkingSuffix(model: string): { model: string; thinking?: string } {
  const idx = model.lastIndexOf(":");
  const tail = idx > 0 ? model.slice(idx + 1) : "";
  return isThinkingLevel(tail) ? { model: model.slice(0, idx), thinking: tail } : { model };
}

/**
 * Validate a model / thinking-level pair.
 *
 * - `thinkingLevel` present (valid or not) → the model is used as given and the
 *   field alone decides thinking (an invalid one is dropped).
 * - `thinkingLevel` absent → a trailing `:<level>` on the model, with `<level>`
 *   a canonical thinking level, is split off. Other `:` uses pass through.
 */
export function validateSpawnChoice(input: { model?: unknown; thinkingLevel?: unknown }): SpawnChoice {
  const out: SpawnChoice = {};
  const hasLevelField = input.thinkingLevel !== undefined;

  if (hasLevelField) {
    if (isThinkingLevel(input.thinkingLevel)) out.thinking = input.thinkingLevel;
    else console.warn(`[dashboard] ignoring invalid thinkingLevel (${typeof input.thinkingLevel})`);
  }
  if (input.model === undefined) return out;

  const candidate = typeof input.model === "string" ? input.model : "";
  const { model, thinking } = hasLevelField ? { model: candidate, thinking: undefined } : splitThinkingSuffix(candidate);
  if (!isValidModel(model)) {
    console.warn("[dashboard] ignoring invalid model choice");
    return out;
  }
  out.model = model;
  if (thinking) out.thinking = thinking;
  return out;
}

/**
 * Resolve the pick carried by a resume of an ENDED session. Pick fields are
 * honoured only for `continue` (a fork keeps the parent model); a model pick
 * without a thinking pick is paired with the session's stored thinking level so
 * a `--model` resume can never reset it.
 */
export function resolveResumeChoice(
  msg: { model?: unknown; thinkingLevel?: unknown },
  mode: "continue" | "fork",
  session: { thinkingLevel?: string },
): SpawnChoice {
  if (mode !== "continue") return {};
  if (msg.model === undefined && msg.thinkingLevel === undefined) return {};
  const choice = validateSpawnChoice(msg);
  if (choice.model && !choice.thinking && isThinkingLevel(session.thinkingLevel)) {
    choice.thinking = session.thinkingLevel;
  }
  return choice;
}

/** Spread-ready `spawnPiSession` option fragment for a validated choice. */
export function choiceToSpawnOptions(choice: SpawnChoice): { model?: string; thinking?: string } {
  return {
    ...(choice.model ? { model: choice.model } : {}),
    ...(choice.thinking ? { thinking: choice.thinking } : {}),
  };
}
