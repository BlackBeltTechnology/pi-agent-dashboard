/**
 * The set of cwds the OpenSpec reconciliation pulls (`openspec_get`) for.
 * Extracted from App so the attachment-folder widening is unit-testable.
 * See changes: fix-connect-snapshot-frame-loss (D7), resolve-archived-attached-proposal (D8).
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { matchArchiveEntries } from "./resolve-attachment.js";

export interface RenderedCwdsInput {
  sessions: Iterable<DashboardSession>;
  pinnedDirectories: Iterable<string>;
  selectedId?: string | null;
  selectedSession?: DashboardSession;
  /** Route surfaces that need their own folder's data. */
  routeCwds: ReadonlyArray<string | null | undefined>;
  /** Archive route folder + its (cached) listing, for candidate sessions. */
  archive?: { cwd: string; entries: readonly ArchiveEntry[] } | null;
}

function addAttachmentFolders(set: Set<string>, s: DashboardSession): void {
  set.add(s.cwd);
  const main = s.gitWorktree?.mainPath;
  if (main) set.add(main);
}

/** Archive-route candidates: sessions in the folder whose name matches an entry. */
function addArchiveCandidates(set: Set<string>, sessions: DashboardSession[], archive: NonNullable<RenderedCwdsInput["archive"]>): void {
  set.add(archive.cwd);
  for (const s of sessions) {
    if (!s.attachedProposal) continue;
    const inFolder = s.cwd === archive.cwd || s.gitWorktree?.mainPath === archive.cwd;
    if (inFolder && matchArchiveEntries(archive.entries, s.attachedProposal).length > 0) addAttachmentFolders(set, s);
  }
}

export function computeRenderedCwds(input: RenderedCwdsInput): string[] {
  const set = new Set<string>();
  const sessions = [...input.sessions];
  for (const s of sessions) {
    if (s.status !== "ended") set.add(s.cwd);
    // Attached sessions (ended included) need their folder + main checkout
    // settled so active-vs-archived is decided on real data.
    if (s.attachedProposal && !s.hidden) addAttachmentFolders(set, s);
  }
  for (const p of input.pinnedDirectories) set.add(p);
  if (input.selectedSession) set.add(input.selectedSession.cwd);
  for (const c of input.routeCwds) if (c) set.add(c);
  if (input.archive) addArchiveCandidates(set, sessions, input.archive);
  return Array.from(set);
}
