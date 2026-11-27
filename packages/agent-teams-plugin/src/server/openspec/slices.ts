/**
 * The ONE file later slices edit: each profile module (group, apply, lock, launcher, sync, gate, …) exports
 * `register(api: OpenspecApi)` from its own file and gets a one-line entry here. `initOpenspec` runs them in
 * order after the foundation is wired; a slice that throws is logged and skipped (a broken optional feature
 * must not stop core teams).
 * See change: add-agent-teams-openspec.
 */
import { registerApply } from "./apply.js";
import { register as registerLauncher } from "./launcher.js";
import { register as registerLock } from "./lock.js";
import type { OpenspecApi } from "./profiles.js";
import { registerGroup } from "./seed-group.js";

export type OpenspecSlice = (api: OpenspecApi) => void;

export const SLICES: ReadonlyArray<readonly [name: string, register: OpenspecSlice]> = [["group", registerGroup], ["launcher", registerLauncher], ["lock", registerLock], ["apply", registerApply]];
