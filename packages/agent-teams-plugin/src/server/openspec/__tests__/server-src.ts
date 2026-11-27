/**
 * Loader of the dashboard server's own modules for tests that must run the REAL route code (the tasks.md
 * parser/writer, the openspec routes, the network guard). Loaded by absolute path at run time, NOT through a
 * static import: this package's `tsc` project must not pull the whole server tree into its program.
 * See change: add-agent-teams-openspec.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../server/src");

interface ServerTask {
  id: string;
  text: string;
  done: boolean;
  line: number;
  group: string;
}

export interface ServerTasksModule {
  parseTasksMarkdown(content: string): ServerTask[];
  readTasks(cwd: string, change: string): Promise<ServerTask[]>;
  toggleTask(cwd: string, change: string, id: string, done: boolean, line: number): Promise<ServerTask>;
  NotFoundError: new () => Error;
  LineMismatchError: new () => Error;
  NotACheckboxError: new () => Error;
}

export const loadServer = async <T>(rel: string): Promise<T> => (await import(/* @vite-ignore */ path.join(SERVER_SRC, rel))) as T;

/** The real `tasks.md` parser/writer of the dashboard server. */
export const serverTasks: ServerTasksModule = await loadServer<ServerTasksModule>("openspec/openspec-tasks.ts");
