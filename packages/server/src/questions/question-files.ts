/**
 * Durable per-question files: `~/.pi/dashboard/questions/<id>.json` (mode 0600,
 * atomic tmp+rename). One file per question → no read-modify-write races.
 *
 * Synchronous on purpose: payloads are small (≤ ~12 KB), writes happen once per
 * question + once per brief change, and removal MUST be effective in the same
 * tick as the registry removal (a deferred unlink could race a later write).
 *
 * No timer-based sweep: a file is removed by `remove` (question left the
 * registry / session ended) or by `sweep` at boot for sessions unknown to the
 * persisted store or recorded ended. A live headless session awaiting a
 * quarantined bridge reconnect is still "present", so its files survive.
 * See change: add-pending-question-stack (D6).
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import type { BriefLabel, BriefStatus, QuestionSnapshot } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";

export const QUESTION_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export interface QuestionFile {
  version: 1;
  id: string;
  sessionId: string;
  promptId: string;
  askedAt: number;
  snapshot: QuestionSnapshot;
  brief?: string;
  briefLabel?: BriefLabel;
  briefStatus: BriefStatus;
}

/** How the persisted session store sees a session at boot. */
export type SessionPresence = "present" | "ended" | "unknown";

export interface QuestionFileStore {
  readonly dir: string;
  loadAll(): QuestionFile[];
  write(file: QuestionFile): void;
  remove(id: string): void;
  /** Delete files whose session is unknown or ended; returns the deleted ids. */
  sweep(presence: (sessionId: string) => SessionPresence): string[];
}

function isQuestionFile(v: unknown, id: string): v is QuestionFile {
  if (!v || typeof v !== "object") return false;
  const f = v as Partial<QuestionFile>;
  return (
    f.version === 1 &&
    f.id === id &&
    typeof f.sessionId === "string" &&
    typeof f.promptId === "string" &&
    typeof f.askedAt === "number" &&
    typeof f.briefStatus === "string" &&
    !!f.snapshot &&
    typeof f.snapshot === "object"
  );
}

export function createQuestionFileStore(opts: { dir?: string } = {}): QuestionFileStore {
  const dir = opts.dir ?? path.join(getDashboardConfigDir(), "questions");
  const pathOf = (id: string) => path.join(dir, `${id}.json`);

  function remove(id: string): void {
    if (!QUESTION_ID_RE.test(id)) return;
    try {
      fs.unlinkSync(pathOf(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[questions] remove ${id} failed:`, (err as Error).message);
    }
  }

  return {
    dir,
    loadAll() {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return [];
      }
      const out: QuestionFile[] = [];
      for (const name of names) {
        const id = name.endsWith(".json") ? name.slice(0, -5) : "";
        if (!QUESTION_ID_RE.test(id)) continue;
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(pathOf(id), "utf8"));
          if (isQuestionFile(parsed, id)) out.push(parsed);
          else console.error(`[questions] ignoring malformed question file ${name}`);
        } catch (err) {
          console.error(`[questions] ignoring unreadable question file ${name}:`, (err as Error).message);
        }
      }
      return out;
    },
    write(file) {
      if (!QUESTION_ID_RE.test(file.id)) throw new Error(`invalid question id: ${file.id}`);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${pathOf(file.id)}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
        fs.renameSync(tmp, pathOf(file.id));
      } catch (err) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* tmp never created */
        }
        throw err;
      }
    },
    remove,
    sweep(presence) {
      const deleted: string[] = [];
      for (const file of this.loadAll()) {
        if (presence(file.sessionId) !== "present") {
          remove(file.id);
          deleted.push(file.id);
        }
      }
      return deleted;
    },
  };
}
