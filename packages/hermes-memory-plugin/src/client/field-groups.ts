/**
 * Presentation metadata for the settings form: the 9 accordion groups (mockup
 * `hermes-settings.html`) and, per `MemoryConfig` key, its human label, help
 * text, and optional unit. The control KIND is derived from the shared
 * `FIELD_DESCRIPTORS` (single source of truth for type/enum/bounds) — this
 * module only carries display copy + grouping.
 *
 * See change: add-hermes-memory-settings-plugin.
 */
import type { MemoryConfig } from "../shared/hermes-config.js";

export interface FieldMeta {
  key: keyof MemoryConfig;
  label: string;
  help: string;
  unit?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldMeta[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Prompt & policy",
    fields: [
      { key: "memoryMode", label: "Memory mode", help: "How memory reaches the prompt. policy-only injects a policy prompt; legacy-inject pastes raw memory." },
      { key: "memoryPolicyStyle", label: "Policy style", help: "Verbosity of the policy prompt when mode is policy-only." },
      { key: "memoryPolicyCustomText", label: "Custom policy text", help: "Used only when policy style is custom." },
    ],
  },
  {
    title: "Store size limits",
    fields: [
      { key: "memoryCharLimit", label: "MEMORY.md limit", help: "Max characters of agent notes before overflow strategy fires.", unit: "chars" },
      { key: "userCharLimit", label: "USER.md limit", help: "Max characters of the user profile.", unit: "chars" },
      { key: "projectCharLimit", label: "Project MEMORY.md limit", help: "Max characters of project-scoped memory.", unit: "chars" },
    ],
  },
  {
    title: "Background review",
    fields: [
      { key: "reviewEnabled", label: "Enable background learning", help: "Periodically review the conversation and extract durable memories." },
      { key: "reviewTransport", label: "Review transport", help: "How the review calls the model — inline (direct) or a child pi -p (subprocess)." },
      { key: "nudgeInterval", label: "Turns between reviews", help: "User turns before a background review triggers.", unit: "turns" },
      { key: "nudgeToolCalls", label: "Tool calls between reviews", help: "Tool calls (in addition to turns) before a review triggers.", unit: "calls" },
      { key: "reviewRecentMessages", label: "Recent messages in review", help: "0 = include the whole conversation.", unit: "msgs (0 = all)" },
    ],
  },
  {
    title: "Flush on compact / shutdown",
    fields: [
      { key: "flushOnCompact", label: "Flush before compaction", help: "Persist memories before the context is compacted." },
      { key: "flushOnShutdown", label: "Flush on shutdown", help: "Persist memories when a session ends." },
      { key: "flushMinTurns", label: "Minimum turns before flush", help: "Skip flush for very short sessions.", unit: "turns" },
      { key: "flushRecentMessages", label: "Recent messages in flush", help: "0 = include the whole conversation.", unit: "msgs (0 = all)" },
    ],
  },
  {
    title: "Overflow & consolidation",
    fields: [
      { key: "memoryOverflowStrategy", label: "Overflow strategy", help: "What happens when a store hits its char limit." },
      { key: "autoConsolidate", label: "Auto-consolidate", help: "Legacy alias for the overflow strategy." },
      { key: "consolidationTimeoutMs", label: "Consolidation timeout", help: "Max time for an auto-consolidation to complete.", unit: "ms" },
    ],
  },
  {
    title: "Correction detection",
    fields: [
      { key: "correctionDetection", label: "Detect corrections", help: "Watch for user corrections and save a memory immediately." },
      { key: "correctionStrongPatterns", label: "Strong patterns", help: "One regex per line. Empty box = use built-in defaults; blank-but-saved = none." },
      { key: "correctionWeakPatterns", label: "Weak patterns", help: "One regex per line." },
      { key: "correctionNegativePatterns", label: "Negative patterns", help: "Suppress a trigger even when a positive pattern matched." },
      { key: "correctionDirectiveWords", label: "Directive words", help: "One word per line; used after a weak pattern." },
    ],
  },
  {
    title: "Failure injection",
    fields: [
      { key: "failureInjectionEnabled", label: "Inject failure memories", help: "Surface recent failures in the system prompt." },
      { key: "failureInjectionMaxAgeDays", label: "Max age", help: "Only inject failures newer than this.", unit: "days" },
      { key: "failureInjectionMaxEntries", label: "Max entries", help: "Cap on injected failure memories.", unit: "entries" },
    ],
  },
  {
    title: "Child LLM (background subprocess)",
    fields: [
      { key: "llmModelOverride", label: "Model override", help: "Model for background consolidation / review subprocesses. Empty = inherit the session's model." },
      { key: "llmThinkingOverride", label: "Thinking override", help: "Thinking level for the child subprocess." },
      { key: "childExtensionPaths", label: "Extra extension paths", help: "One path per line — e.g. a provider-auth adapter the child pi must load." },
    ],
  },
  {
    title: "Storage & search",
    fields: [
      { key: "memoryDir", label: "Memory directory", help: "Override the extension storage directory." },
      { key: "projectsMemoryDir", label: "Projects memory directory", help: "Relative to ~/.pi/agent." },
      { key: "sessionSearch", label: "Session search variant", help: "Search implementation." },
    ],
  },
];
