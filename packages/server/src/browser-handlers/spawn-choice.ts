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
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { type RoleConfig, resolveModelRef, THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

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

export interface SpawnChoiceInput {
  model?: unknown;
  thinkingLevel?: unknown;
  /** ACP agent id. With an agent no pi model/thinking applies. */
  agent?: unknown;
}

export interface ResolveSpawnChoiceContext {
  /** Settings `defaultModel`, paired with a thinking-only choice. */
  defaultModel?: string;
  /** Role config reader; called ONLY for `@role` refs. Defaults to `~/.pi/agent/providers.json`. */
  readRoles?: () => Pick<RoleConfig, "roles">;
}

export interface ResolvedSpawnChoice {
  choice: SpawnChoice;
  /** Human-readable reasons a requested model/role/thinking choice was dropped. */
  warnings: string[];
}

/** Empty string counts as absent (the composer / CLI may send `""`). */
function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/**
 * The single spawn-time choice resolver shared by every spawn road (browser WS,
 * REST, plugin hook, bridge `spawn_new_session`).
 *
 * - Literal refs keep `validateSpawnChoice` semantics (explicit `thinkingLevel`
 *   disables `:<level>` suffix splitting).
 * - `@role[:level]` resolves ONCE against the roles file; the concrete
 *   `provider/id` is validated with no level, and the thinking level follows
 *   explicit field > ref suffix > role-assigned level.
 * - A thinking-only choice pairs with `ctx.defaultModel`.
 * - `agent` with a model/thinking choice → empty choice + warning (an ACP agent
 *   takes no pi argv). `agent` alone → no warning.
 *
 * Never throws; every drop is reported in `warnings` (and `console.warn`).
 * See change: add-spawn-model-choice (design D1).
 */
export function resolveSpawnChoice(input: SpawnChoiceInput, ctx: ResolveSpawnChoiceContext = {}): ResolvedSpawnChoice {
  const warnings: string[] = [];
  const hasModel = present(input.model);
  const hasLevel = present(input.thinkingLevel);
  if (present(input.agent)) {
    if (hasModel || hasLevel) {
      const w = "model choice ignored for ACP agent";
      console.warn(`[dashboard] ${w}`);
      warnings.push(w);
    }
    return { choice: {}, warnings };
  }
  if (!hasModel && !hasLevel) return { choice: {}, warnings };

  let choice: SpawnChoice;
  if (hasModel && typeof input.model === "string" && input.model.trim().startsWith("@")) {
    choice = resolveRoleChoice(input.model, hasLevel ? input.thinkingLevel : undefined, ctx, warnings);
  } else {
    choice = validateSpawnChoice({
      ...(hasModel ? { model: input.model } : {}),
      ...(hasLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    });
    if (hasModel && !choice.model) warnings.push("invalid model choice ignored");
    if (hasLevel && !isThinkingLevel(input.thinkingLevel)) warnings.push("invalid thinkingLevel ignored");
  }

  if (choice.thinking && !choice.model && ctx.defaultModel) {
    const fallback = validateSpawnChoice({ model: ctx.defaultModel, thinkingLevel: choice.thinking });
    if (fallback.model) choice.model = fallback.model;
  }
  return { choice, warnings };
}

function resolveRoleChoice(
  ref: string,
  levelField: unknown,
  ctx: ResolveSpawnChoiceContext,
  warnings: string[],
): SpawnChoice {
  const out: SpawnChoice = {};
  let roles: Pick<RoleConfig, "roles">;
  try {
    roles = (ctx.readRoles ?? readRoleConfigFromDisk)();
  } catch {
    roles = { roles: {} };
  }
  const resolved = resolveModelRef(ref, roles);
  if (resolved.unresolved || !resolved.model) {
    const w = resolved.unresolved ?? `role ref '${ref}' did not resolve`;
    console.warn(`[dashboard] ignoring model choice: ${w}`);
    warnings.push(w);
  } else {
    // No level and no thinkingLevel → never re-fed as `provider/id:level`.
    const v = validateSpawnChoice({ model: resolved.model, thinkingLevel: undefined });
    if (v.model && v.model === resolved.model) out.model = v.model;
    else warnings.push(`role '${resolved.role}' is assigned an invalid model`);
  }
  if (levelField !== undefined) {
    if (isThinkingLevel(levelField)) out.thinking = levelField;
    else {
      console.warn(`[dashboard] ignoring invalid thinkingLevel (${typeof levelField})`);
      warnings.push("invalid thinkingLevel ignored");
      if (out.model && isThinkingLevel(resolved.level)) out.thinking = resolved.level;
    }
  } else if (out.model && isThinkingLevel(resolved.level)) {
    out.thinking = resolved.level;
  }
  return out;
}
