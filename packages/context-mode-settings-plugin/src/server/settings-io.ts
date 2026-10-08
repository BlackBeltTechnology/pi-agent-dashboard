/**
 * Fixed-path IO for the context-mode settings file.
 *
 * The path is `~/.pi/context-mode/settings.json` — never derived from request
 * input or from any setting (design D2). Reads are synchronous + tolerant
 * (spawn paths are synchronous); writes are atomic (temp file + rename).
 *
 * See change: add-context-mode-settings-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONTEXT_SETTINGS } from "../shared/settings-descriptors.js";

const SETTINGS_DIRNAME = "context-mode";
const SETTINGS_FILENAME = "settings.json";

/** Absolute path of the fixed settings file. */
export function resolveSettingsPath(home: string = os.homedir()): string {
  return path.join(home, ".pi", SETTINGS_DIRNAME, SETTINGS_FILENAME);
}

export type ReadResult =
  | { state: "absent"; settings: Record<string, unknown> }
  | { state: "ok"; settings: Record<string, unknown> }
  | { state: "corrupt"; settings: Record<string, unknown>; reason: string };

/** Synchronous tolerant read. Absent/corrupt → empty settings (= defaults). Never throws, never creates files. */
export function readSettingsFile(filePath: string): ReadResult {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent", settings: {} };
    return { state: "corrupt", settings: {}, reason: (e as NodeJS.ErrnoException).code ?? "read_failed" };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { state: "ok", settings: parsed as Record<string, unknown> };
    }
    return { state: "corrupt", settings: {}, reason: "not_an_object" };
  } catch {
    return { state: "corrupt", settings: {}, reason: "invalid_json" };
  }
}

interface FieldView {
  value: unknown;
  default: unknown;
  isDefault: boolean;
}

export interface EffectiveSettings {
  filePath: string;
  exists: boolean;
  raw: Record<string, unknown>;
  fields: Record<string, FieldView>;
}

/** Per-key effective value + default + isDefault. Keys absent from the file are default. */
export function readEffectiveSettings(filePath: string): EffectiveSettings {
  const r = readSettingsFile(filePath);
  const fields: Record<string, FieldView> = {};
  for (const d of CONTEXT_SETTINGS) {
    const present = Object.hasOwn(r.settings, d.key);
    fields[d.key] = { value: present ? r.settings[d.key] : d.default, default: d.default, isDefault: !present };
  }
  return { filePath, exists: r.state !== "absent", raw: r.settings, fields };
}

/** Atomic pretty-JSON write; creates the parent dir; leaves no temp file on failure. */
export function writeSettingsFile(filePath: string, obj: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
    try {
      fs.renameSync(tmp, filePath);
    } catch (e) {
      // Windows refuses to rename over an existing file (EPERM/EEXIST): replace once.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EEXIST") throw e;
      fs.rmSync(filePath, { force: true });
      fs.renameSync(tmp, filePath);
    }
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure — surface the original error
    }
    throw e;
  }
}
