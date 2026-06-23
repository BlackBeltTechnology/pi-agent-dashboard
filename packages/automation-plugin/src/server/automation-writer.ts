/**
 * Create/update `automation.yaml` (+ `prompt.md` for prompt actions) from a
 * structured request. Used by the create-automation REST route.
 *
 * See change: add-automation-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { AutomationConfig } from "../shared/automation-types.js";

export interface WriteAutomationInput {
  /** Scope base dir: repo root (folder scope) or home dir (global scope). */
  scopeBase: string;
  /** Automation folder name (kebab recommended). */
  name: string;
  config: AutomationConfig;
  /** Prompt body written to prompt.md when action.kind === "prompt". */
  promptBody?: string;
  /**
   * Write intent. `create` (default) rejects an existing name so a create
   * never silently clobbers; `update` requires the automation to already
   * exist and overwrites it in place. See change:
   * redesign-automation-editor-and-board.
   */
  intent?: "create" | "update";
}

export interface WriteAutomationResult {
  dir: string;
  yamlPath: string;
  promptPath?: string;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Reject names that would escape the automation dir or collide with `runs`. */
export function isValidAutomationName(name: string): boolean {
  return NAME_RE.test(name) && name !== "runs" && name !== "." && name !== "..";
}

export function writeAutomation(input: WriteAutomationInput): WriteAutomationResult {
  if (!isValidAutomationName(input.name)) {
    throw new Error(`invalid automation name: "${input.name}"`);
  }
  const dir = path.join(input.scopeBase, ".pi", "automation", input.name);
  const intent = input.intent ?? "create";
  const existed = fs.existsSync(path.join(dir, "automation.yaml"));
  if (intent === "create" && existed) {
    throw new Error(`automation "${input.name}" already exists in this scope`);
  }
  if (intent === "update" && !existed) {
    throw new Error(`automation "${input.name}" does not exist in this scope`);
  }
  fs.mkdirSync(dir, { recursive: true });

  const config: AutomationConfig = { ...input.config };
  let promptPath: string | undefined;

  if (config.action.kind === "prompt") {
    // Normalize the prompt path to the durable sibling file and write it.
    config.action = { kind: "prompt", prompt: "./prompt.md" };
    promptPath = path.join(dir, "prompt.md");
    fs.writeFileSync(promptPath, (input.promptBody ?? "").trim() + "\n");
  }

  const yamlPath = path.join(dir, "automation.yaml");
  const tmp = yamlPath + ".tmp";
  fs.writeFileSync(tmp, stringifyYaml(config));
  fs.renameSync(tmp, yamlPath);

  return { dir, yamlPath, ...(promptPath ? { promptPath } : {}) };
}

/** Delete an automation directory (best-effort). */
export function deleteAutomation(scopeBase: string, name: string): boolean {
  if (!isValidAutomationName(name)) return false;
  const dir = path.join(scopeBase, ".pi", "automation", name);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
