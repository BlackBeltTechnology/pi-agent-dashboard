/**
 * LiveRegion — the Team view's polite announcements (design D10; task 8.7). The
 * `aria-live="polite"` node is mounted with the view (never lazily with its first
 * text) and fed by `diffSnapshots` through the 4 s announcer: at most one merged
 * summary per window, ids / names / statuses only — never message text, task
 * titles or the team name. The first snapshot of a team is the baseline.
 * See change: add-agent-teams-ui.
 */
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { type Announcer, announcementLines, createAnnouncer, diffSnapshots } from "./announcements.js";
import { useViewT } from "./view-kit.js";

export function LiveRegion({ snapshot }: { snapshot: TeamUiSnapshot | undefined }): ReactElement {
  const t = useViewT();
  const [text, setText] = useState("");
  const previous = useRef<TeamUiSnapshot | undefined>(undefined);
  const announcer = useRef<Announcer | undefined>(undefined);

  useEffect(() => {
    const made = createAnnouncer((summary) => setText(announcementLines(summary).map((line) => t(line.key, line.vars)).join(". ")));
    announcer.current = made;
    return () => {
      made.dispose();
      announcer.current = undefined;
    };
  }, [t]);

  useEffect(() => {
    if (!snapshot) return;
    const before = previous.current;
    previous.current = snapshot;
    if (!before || before.id !== snapshot.id) return; // baseline
    announcer.current?.push(diffSnapshots(before, snapshot));
  }, [snapshot]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="team-live-region">
      {text}
    </div>
  );
}
