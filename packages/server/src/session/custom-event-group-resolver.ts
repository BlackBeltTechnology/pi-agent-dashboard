/**
 * First-match-wins resolver: `customType → groupId` over the ordered groups
 * from `custom-event-groups.json`, with the reserved `other` catch-all.
 *
 * Design D3/D4 (see change: add-custom-event-group-filters):
 *   - Every pattern test runs through the bounded `CustomEventGroupMatcher`
 *     (worker thread + kill timeout). A group whose match is abandoned is
 *     QUARANTINED for the process lifetime — quarantine is applied before
 *     resuming at the next index, so the worker can be killed at most once
 *     per configured group (no respawn storm).
 *   - Resolution is memoized per distinct `customType` for the process
 *     lifetime: pattern matching is never re-executed per rendered row.
 *   - A plugin-declared entry type (`replayEntryTypes`, via `isPluginEntryType`)
 *     is excluded entirely — no group, no matcher call (its plugin owns its
 *     rendering path). Core names no type. See change: update-flows-plugin (D3).
 */
import {
  RESERVED_OTHER_GROUP_ID,
  type CustomEventGroup,
} from "@blackbelt-technology/pi-dashboard-shared/custom-event-groups.js";
import type { CustomEventGroupMatcher } from "./custom-event-group-matcher.js";

export interface CustomEventGroupResolverDeps {
  /** Logger hook (defaults to console.warn). Tests inject a sink. */
  warn?(message: string): void;
  /** True for a plugin-declared entry type (never grouped). Default: none. */
  isPluginEntryType?(customType: string): boolean;
}

export class CustomEventGroupResolver {
  private readonly groups: CustomEventGroup[];
  private readonly matcher: CustomEventGroupMatcher;
  private readonly warn: (message: string) => void;
  private readonly isPluginEntryType: (customType: string) => boolean;
  private readonly memo = new Map<string, Promise<string | undefined>>();
  private readonly quarantined = new Set<string>();

  constructor(
    groups: CustomEventGroup[],
    matcher: CustomEventGroupMatcher,
    deps: CustomEventGroupResolverDeps = {},
  ) {
    this.groups = groups;
    this.matcher = matcher;
    this.warn = deps.warn ?? ((m) => console.warn(`[custom-event-groups] ${m}`));
    this.isPluginEntryType = deps.isPluginEntryType ?? (() => false);
  }

  /**
   * Resolve `customType` to its group id, or `undefined` when the type must
   * not be grouped at all (a plugin-declared entry type). Unmatched types
   * resolve to the reserved `other` group.
   */
  resolve(customType: string): Promise<string | undefined> {
    if (this.isPluginEntryType(customType)) return Promise.resolve(undefined);
    const hit = this.memo.get(customType);
    if (hit) return hit;
    const p = this.run(customType);
    this.memo.set(customType, p);
    return p;
  }

  /** Test seam: whether a group is currently quarantined. */
  isQuarantined(groupId: string): boolean {
    return this.quarantined.has(groupId);
  }

  private async run(customType: string): Promise<string> {
    for (const g of this.groups) {
      // The catch-all is the fallback below, never a walked candidate.
      if (g.id === RESERVED_OTHER_GROUP_ID) break;
      if (this.quarantined.has(g.id)) continue;
      let matched: boolean;
      try {
        matched = await this.matcher.match(g.pattern, customType);
      } catch (err) {
        // Timeout / worker death → this group is quarantined for the process
        // lifetime; the user fixes the pattern in the file (restart-to-apply).
        this.quarantined.add(g.id);
        this.warn(
          `group "${g.id}" quarantined: pattern evaluation did not complete ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
        continue;
      }
      if (matched) return g.id;
    }
    return RESERVED_OTHER_GROUP_ID;
  }
}
