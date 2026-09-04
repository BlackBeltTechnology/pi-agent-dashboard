/**
 * Node-side store for the custom event groups config file — SPLIT from
 * `custom-event-groups.ts` (browser-safe types + shipped defaults) so client
 * code can value-import the defaults without pulling `node:fs` into the SPA
 * bundle (client bundle purity guard).
 *
 * Conventions follow `tool-registry/overrides.ts`: versioned envelope, lazy
 * load, in-memory cache, atomic tmp+rename persist, malformed file → fail
 * open. One instance per process; restart-to-apply (design D6).
 * See change: add-custom-event-group-filters.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RESERVED_OTHER_GROUP,
  RESERVED_OTHER_GROUP_ID,
  SHIPPED_CUSTOM_EVENT_GROUPS,
  type ClientCustomEventGroup,
  type CustomEventGroup,
} from "./custom-event-groups.js";

/** Path to the groups file. Exposed for tests and logging. */
export function defaultCustomEventGroupsPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "custom-event-groups.json");
}

/** Internal shape persisted to disk. `version` lets us evolve later. */
interface CustomEventGroupsFile {
  version: 1;
  groups: CustomEventGroup[];
  seenShippedIds: string[];
}

export interface CustomEventGroupsStoreDeps {
  filePath?: string;
  /** Logger hook (defaults to console.warn). Tests inject a sink. */
  warn?(message: string): void;
}

/**
 * Validate one user/shipped group entry. Returns null when the entry must be
 * SKIPPED (missing `id`, duplicate `id`, missing/uncompilable `pattern`) —
 * every other entry is retained (fail-open spec requirement).
 */
function validateGroupEntry(
  raw: unknown,
  seenIds: Set<string>,
  warn: (message: string) => void,
): CustomEventGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.id !== "string" || g.id === "") {
    warn("custom event group entry missing `id`; skipping it");
    return null;
  }
  if (seenIds.has(g.id)) {
    warn(`duplicate custom event group id "${g.id}"; keeping the first entry`);
    return null;
  }
  if (typeof g.pattern !== "string") {
    warn(`custom event group "${g.id}" missing \`pattern\`; skipping it`);
    return null;
  }
  try {
    // Uncompilable regex would throw at resolution time; reject at load.
    // eslint-disable-next-line no-new
    new RegExp(g.pattern);
  } catch {
    warn(`custom event group "${g.id}" has an uncompilable pattern; skipping it`);
    return null;
  }
  seenIds.add(g.id);
  // Non-skip fields coerce rather than reject: `label` falls back to the id,
  // an invalid `default` resolves visible (fail-open).
  return {
    id: g.id,
    label: typeof g.label === "string" && g.label !== "" ? g.label : g.id,
    pattern: g.pattern,
    default: g.default !== false,
  };
}

/**
 * Read-through store for the groups file. One instance per process
 * (restart-to-apply, design D6). The disk read is lazy — the file is only
 * touched on first access.
 */
export class CustomEventGroupsStore {
  private readonly filePath: string;
  private readonly warn: (message: string) => void;
  private cache: CustomEventGroup[] | null = null;
  private seenShippedIds: string[] = [];

  constructor(deps: CustomEventGroupsStoreDeps = {}) {
    this.filePath = deps.filePath ?? defaultCustomEventGroupsPath();
    this.warn = deps.warn ?? ((m) => console.warn(`[custom-event-groups] ${m}`));
  }

  /** Configured groups in resolution order, including the reserved `other`. */
  list(): CustomEventGroup[] {
    if (this.cache === null) this.cache = this.load();
    return this.cache;
  }

  /** Client-facing definitions (id/label/default, resolution order — no pattern). */
  definitions(): ClientCustomEventGroup[] {
    return this.list().map((g) => ({ id: g.id, label: g.label, default: g.default }));
  }

  private load(): CustomEventGroup[] {
    let raw: Partial<CustomEventGroupsFile> | undefined;
    let fileExisted = false;
    try {
      if (fs.existsSync(this.filePath)) {
        fileExisted = true;
        const text = fs.readFileSync(this.filePath, "utf-8");
        raw = JSON.parse(text) as Partial<CustomEventGroupsFile>;
      }
    } catch (err) {
      // Fail open: unparseable file → shipped defaults, file left untouched.
      this.warn(
        `failed to read groups file at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}; using shipped defaults`,
      );
      return this.shippedGroups();
    }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.groups)) {
      if (fileExisted) {
        this.warn(`malformed groups file at ${this.filePath}; using shipped defaults`);
        return this.shippedGroups();
      }
      // Absent file → seed it with the shipped defaults and record ids.
      const seeded = this.shippedGroups();
      this.persist(seeded);
      return seeded;
    }

    const seenIds = new Set<string>();
    const groups: CustomEventGroup[] = [];
    for (const entry of raw.groups) {
      const valid = validateGroupEntry(entry, seenIds, this.warn);
      if (valid) groups.push(valid);
    }
    this.seenShippedIds = Array.isArray(raw.seenShippedIds)
      ? raw.seenShippedIds.filter((id): id is string => typeof id === "string")
      : [];

    const merged = this.upgradeMerge(groups);
    if (!merged.groups.some((g) => g.id === RESERVED_OTHER_GROUP_ID)) {
      merged.groups.push({ ...RESERVED_OTHER_GROUP });
    }

    // Persist only when something actually changed (merge ran or ids recorded).
    if (merged.changed) this.persist(merged.groups);
    return merged.groups;
  }

  /**
   * Upgrade-merge (design D5): add a shipped group only when its id is absent
   * from `seenShippedIds`; append merged groups AFTER user-authored entries so
   * an existing broader user rule keeps winning under first-match-wins; always
   * record the shipped id, whether or not the group survived.
   */
  private upgradeMerge(groups: CustomEventGroup[]): { groups: CustomEventGroup[]; changed: boolean } {
    let changed = false;
    const userGroupIds = new Set(groups.map((g) => g.id));
    const appended: CustomEventGroup[] = [];
    for (const shipped of SHIPPED_CUSTOM_EVENT_GROUPS) {
      if (!this.seenShippedIds.includes(shipped.id)) {
        this.seenShippedIds.push(shipped.id);
        changed = true;
        // Only materialize when no user-authored group already claims the id.
        if (!userGroupIds.has(shipped.id)) appended.push({ ...shipped });
      }
    }
    if (appended.length > 0) {
      groups = [...groups, ...appended];
      changed = true;
    }
    return { groups, changed };
  }

  private shippedGroups(): CustomEventGroup[] {
    const groups = [...SHIPPED_CUSTOM_EVENT_GROUPS.map((g) => ({ ...g })), { ...RESERVED_OTHER_GROUP }];
    this.seenShippedIds = SHIPPED_CUSTOM_EVENT_GROUPS.map((g) => g.id);
    return groups;
  }

  /** Atomic tmp+rename persist (same pattern as `tool-registry/overrides.ts`). */
  private persist(groups: CustomEventGroup[]): void {
    const file: CustomEventGroupsFile = {
      version: 1,
      groups,
      seenShippedIds: [...this.seenShippedIds],
    };
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      this.warn(
        `failed to persist groups file at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
