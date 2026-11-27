/**
 * Prompt files of a teammate (design D5): the agent definition prompt and the template member prompt are
 * rendered to `<dataDir>/prompts/<teamId>/<member>.agent.md` / `.member.md` and appended to the spawn's
 * `appendSystemPrompt` list by the spawn contributor. Sync + atomic (tmp + rename, dir mode 0700) so a
 * write failure never leaves a half-written file; `prunePromptDirs` removes the dirs of teams that no
 * longer exist (closed-team retention, at start).
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";

export type PromptKind = "agent" | "member";

/** A path segment that cannot escape the prompts dir. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export class PromptWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptWriteError";
  }
}

const promptsRoot = (dataDir: string): string => path.join(dataDir, "prompts");

/** `<dataDir>/prompts/<teamId>`. */
export function promptDirFor(dataDir: string, teamId: string): string {
  if (!SAFE_SEGMENT.test(teamId)) throw new PromptWriteError("team id is not a safe path segment");
  return path.join(promptsRoot(dataDir), teamId);
}

/** `<dataDir>/prompts/<teamId>/<member>.<kind>.md`. */
function promptPathFor(dataDir: string, teamId: string, member: string, kind: PromptKind): string {
  if (!SAFE_SEGMENT.test(member)) throw new PromptWriteError("member name is not a safe path segment");
  return path.join(promptDirFor(dataDir, teamId), `${member}.${kind}.md`);
}

/**
 * Write one prompt file atomically (private dir 0700, file 0600); returns its absolute path. Any failure
 * removes the temp file and throws `PromptWriteError` (the target is never half-written).
 */
export function writePromptFile(dataDir: string, teamId: string, member: string, kind: PromptKind, text: string): string {
  const file = promptPathFor(dataDir, teamId, member, kind);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return file;
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best effort: the temp file is private and carries a unique name
    }
    throw new PromptWriteError(`could not write ${path.basename(file)}: ${(err as Error).message}`);
  }
}

/**
 * Remove `<dataDir>/prompts/<id>` for every team that is neither in memory nor on disk any more
 * (`hasTeam(id)`), i.e. that closed-team retention pruned at load. Returns the removed ids; never throws.
 */
export function prunePromptDirs(dataDir: string, hasTeam: (teamId: string) => boolean): string[] {
  let root: string;
  let entries: string[];
  try {
    root = promptsRoot(dataDir);
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const id of entries) {
    if (hasTeam(id)) continue;
    try {
      fs.rmSync(path.join(root, id), { recursive: true, force: true });
      removed.push(id);
    } catch {
      // retried on the next start
    }
  }
  return removed;
}
