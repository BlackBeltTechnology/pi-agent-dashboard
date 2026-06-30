/**
 * REST API endpoint types.
 */
import type {
  DashboardSession,
  DashboardEvent,
  ApiResponse,
  OpenSpecGroup,
  OpenSpecGroupsFile,
} from "./types.js";

export type { ApiResponse } from "./types.js";
import type { EnrichedRecommendedExtension } from "./recommended-extensions.js";

export type { EnrichedRecommendedExtension } from "./recommended-extensions.js";

// ── Sessions ────────────────────────────────────────────────────────

export interface ListSessionsQuery {
  status?: "active" | "ended";
}

export type ListSessionsResponse = ApiResponse<DashboardSession[]>;

// ── Events ──────────────────────────────────────────────────────────

export type FetchEventContentResponse = ApiResponse<DashboardEvent>;

// ── Session Spawn ───────────────────────────────────────────────────

export interface SpawnSessionRequest {
  cwd: string;
}

export type SpawnSessionResponse = ApiResponse<{ message: string }>;

// ── Aggregate Stats ─────────────────────────────────────────────────

export interface AggregateStats {
  activeSessions: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
}

export type AggregateStatsResponse = ApiResponse<AggregateStats>;

// ── File Read ───────────────────────────────────────────────────────

import type { FileKind } from "./file-kind.js";

export interface FileContentResult {
  type: "file";
  /** Viewer-discrimination class from the shared `fileKind` classifier. */
  kind: FileKind;
  /** Resolved MIME type for the entry. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /**
   * UTF-8 content. Present for text-renderable kinds (`text` / `markdown` /
   * `unknown` → Monaco / Markdown viewers); omitted for `image` / `pdf` /
   * `binary`, which fetch raw bytes via `GET /api/file/raw`.
   * See change: add-internal-monaco-editor-pane.
   */
  content?: string;
}

/**
 * `GET /api/file/raw?cwd=<cwd>&path=<relPath>` streams raw file bytes with a
 * resolved `Content-Type` header and HTTP Range support. Same cwd-allowlist +
 * anti-traversal gate as `/api/file`. Not a JSON envelope — the body is the
 * file itself. Used by image / pdf tabs.
 */
export interface FileRawQuery {
  cwd: string;
  path: string;
}

export interface DirectoryListResult {
  type: "directory";
  entries: string[];
}

export type FileReadResult = FileContentResult | DirectoryListResult;

export type FileReadResponse = ApiResponse<FileReadResult>;

// ── Browse ──────────────────────────────────────────────────────────

export interface BrowseEntry {
  name: string;
  path: string;
  /**
   * Set only when the request used `detect=1`. When the response was
   * produced without `detect=1`, this field is absent (undefined) —
   * meaning "not classified", NOT "classified as not-git". Consumers
   * that need badges SHOULD call `GET /api/browse/flags` to fill in
   * the flags lazily.
   *
   * See change: split-browse-flags.
   */
  isGit?: boolean;
  /** See `isGit` — same opt-in / detect-gated semantics. */
  isPi?: boolean;
}

/**
 * Response shape for `GET /api/browse?path=<dir>&q=<query>&detect=<0|1>`.
 *
 * The optional `q` query parameter, when present and non-empty, causes the
 * server to filter entries by case-insensitive substring on `name` and rank
 * them (exact → prefix → word-boundary → substring) before the 200-entry cap.
 * When omitted or whitespace-only, entries are sorted alphabetically.
 *
 * The optional `detect` query parameter (only the literal string `"1"` is
 * truthy) opts into eager `.git` / `.pi` classification on every entry. When
 * absent (the default), per-entry `isGit` / `isPi` are omitted and no
 * filesystem probes run — use the bulk `GET /api/browse/flags` endpoint to
 * classify entries lazily.
 *
 * See change: split-browse-flags.
 */
export interface BrowseResult {
  entries: BrowseEntry[];
  parent: string | null;
  current: string;
  /**
   * The server's `process.platform` — lets the client use OS-correct path
   * handling (separator, case-sensitivity, drive-letter rules) without
   * having to sniff `navigator.userAgent`. Optional for backward
   * compatibility; consumers fall back to inferring from the `current`
   * path shape when absent.
   *
   * See change: platform-path-normalization.
   */
  platform?: NodeJS.Platform;
}

export type BrowseResponse = ApiResponse<BrowseResult>;

// ── Browse flags (bulk classifier) ──────────────────────────────────

/**
 * Per-path classification record returned by `GET /api/browse/flags`.
 * Booleans only — any probe failure (ENOENT, EACCES, ELOOP, race-on-
 * deletion, …) maps to `false` for that flag, never an error.
 *
 * See change: split-browse-flags.
 */
export interface BrowseFlagEntry {
  isGit: boolean;
  isPi: boolean;
}

/**
 * Wire shape passed via the `paths` query parameter on
 * `GET /api/browse/flags?paths=<json-array>`. The value MUST be a
 * URL-encoded JSON array of absolute path strings (length ≤ 100).
 * Provided here for type-only documentation — the request itself is a
 * GET, so this interface is not serialized as a body.
 */
export interface BrowseFlagsRequest {
  paths: string[];
}

/** Successful response payload for `GET /api/browse/flags`. */
export interface BrowseFlagsResult {
  /**
   * Map keyed by the absolute paths that were requested. The key set
   * SHALL equal the input `paths` set — one classification per input
   * path, no extras, no omissions.
   */
  flags: Record<string, BrowseFlagEntry>;
}

export type BrowseFlagsResponse = ApiResponse<BrowseFlagsResult>;

/** Request body for `POST /api/browse/mkdir`. */
export interface MkdirRequest {
  parent: string;
  name: string;
}

export interface MkdirResult {
  path: string;
}

export type MkdirResponse = ApiResponse<MkdirResult>;

// ── Tunnel Status ───────────────────────────────────────────────────

export interface TunnelWatchdogPublicStatus {
  running: boolean;
  intervalMs: number;
  failureThreshold: number;
  probeTimeoutMs: number;
  lastProbeAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  lastRecycleAt: number | null;
  recycleCount: number;
}

export type TunnelStatus =
  | { status: "active"; url: string; serverOs: string; watchdog?: TunnelWatchdogPublicStatus }
  | { status: "inactive"; serverOs: string }
  | { status: "unavailable"; serverOs: string };

export type TunnelStatusResponse = ApiResponse<TunnelStatus>;

// ── Pi Resources ────────────────────────────────────────────────────

export interface PiResource {
  name: string;
  description?: string;
  filePath: string;
  type: "extension" | "skill" | "prompt";
}

export interface PiResourceScope {
  extensions: PiResource[];
  skills: PiResource[];
  prompts: PiResource[];
}

export interface PiPackageInfo {
  name: string;
  description?: string;
  source: string; // e.g. "npm:pi-web-access", "git:github.com/user/repo", "../relative"
  resources: PiResourceScope;
  /** Which scope this package was resolved from */
  scope?: "local" | "global";
}

export interface PiResourcesResult {
  local: PiResourceScope;
  global: PiResourceScope;
  packages: PiPackageInfo[];
}

export type PiResourcesResponse = ApiResponse<PiResourcesResult>;

// ── Git Operations ──────────────────────────────────────────────────

export interface GitBranchEntry {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
}

export interface GitBranchesResult {
  current: string;
  detached: boolean;
  branches: GitBranchEntry[];
}

export type GitBranchesResponse = ApiResponse<GitBranchesResult>;

export interface GitCheckoutRequest {
  cwd: string;
  branch: string;
  stash?: boolean;
}

export type GitCheckoutResponse =
  | ApiResponse<{ stashed?: boolean }>
  | ApiResponse<never> & { success: false; dirty: true; files: string[] };

export interface GitInitRequest {
  cwd: string;
}

export type GitInitResponse = ApiResponse<void>;

export interface GitStashPopResult {
  conflicts: boolean;
}

export type GitStashPopResponse = ApiResponse<GitStashPopResult>;

// ── Pull Requests ─────────────────────────────────────────────────────────

export interface PullRequestInfo {
  number: number;
  title: string;
  headRefName: string;
  headRefOid: string;
  author: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  checkRollup: "passing" | "failing" | "pending" | "none";
}

export type PullRequestListResponse = ApiResponse<PullRequestInfo[]>;

// ── Provider Auth ─────────────────────────────────────────────────────────

export interface ProviderAuthInfo {
  id: string;
  name: string;
  flowType: "auth_code" | "device_code";
}

export interface ProviderAuthStatus {
  id: string;
  name: string;
  flowType: "auth_code" | "device_code" | "api_key";
  authenticated: boolean;
  expires?: number;
  maskedKey?: string;
  /** Name of the env var pi-ai consults for this provider (api-key rows only). */
  envVar?: string;
  /** True when configured via ambient credential chain (AWS profile / GCP ADC). */
  ambient?: boolean;
}

export interface AuthorizeResponse {
  flowId: string;
  authUrl: string;
}

export interface DeviceCodeResponse {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

// ── Package Management ──────────────────────────────────────────────

/** A single result from the npm registry search. */
export interface NpmPackageResult {
  name: string;
  description?: string;
  version: string;
  keywords: string[];
  date: string;
  publisher?: { username: string; email?: string };
  links?: { npm?: string; homepage?: string; repository?: string };
  downloads?: { weekly: number; monthly: number };
  /** Derived from keywords: extension, skill, theme, prompt */
  types: string[];
}

export interface NpmSearchResponse {
  packages: NpmPackageResult[];
  total: number;
}

export type NpmSearchApiResponse = ApiResponse<NpmSearchResponse>;

export interface NpmReadmeResponse {
  readme: string;
  name: string;
  version: string;
}

export type NpmReadmeApiResponse = ApiResponse<NpmReadmeResponse>;

/** An installed pi package as returned by the list endpoint. */
export interface InstalledPackage {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  /** Set after check-updates: true if newer version available */
  updateAvailable?: boolean;
  /** Version read from `<installedPath>/package.json#version`. Undefined if missing/unreadable. */
  version?: string;
  /** Description read from `<installedPath>/package.json#description`. */
  description?: string;
  /** Friendly name. From RECOMMENDED_EXTENSIONS displayName when matched, else basename of source. */
  displayName?: string;
  /** True when this row matches a RECOMMENDED_EXTENSIONS entry (via sourcesMatch). */
  isRecommended?: boolean;
  /** True when isRecommended AND id is in BUNDLED_EXTENSION_IDS AND bundle subtree exists. */
  isBundled?: boolean;
}

export type InstalledPackagesResponse = ApiResponse<InstalledPackage[]>;

/** Request body for install / remove / update operations. */
export interface PackageOperationRequest {
  source: string;
  scope: "global" | "local";
  cwd?: string;
}

/** Response returned immediately (202) when an operation starts. */
export interface PackageOperationResponse {
  operationId: string;
}

export type PackageOperationApiResponse = ApiResponse<PackageOperationResponse>;

/** Result of check-updates. */
export interface PackageUpdateInfo {
  source: string;
  displayName: string;
  type: "npm" | "git";
}

export type CheckUpdatesResponse = ApiResponse<PackageUpdateInfo[]>;

// ── Pi core version check ────────────────────────────────────

/** A core pi ecosystem CLI package (not managed by pi's PackageManager). */
export interface PiCorePackage {
  name: string;
  displayName: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  installSource: "global" | "managed";
}

export interface PiCoreStatus {
  packages: PiCorePackage[];
  updatesAvailable: number;
  lastChecked: string;
}

export type PiCoreVersionsResponse = ApiResponse<PiCoreStatus>;

/** Request body for POST /api/pi-core/update. Empty packages = update all. */
export interface PiCoreUpdateRequest {
  packages?: string[];
}

/** Result of a single package update. */
export interface PiCoreUpdateResult {
  name: string;
  success: boolean;
  error?: string;
}

/** Response from POST /api/pi-core/update (completes synchronously). */
export interface PiCoreUpdateResponse {
  results: PiCoreUpdateResult[];
  sessionsReloaded: number;
}

export type PiCoreUpdateApiResponse = ApiResponse<PiCoreUpdateResponse>;

// ── Known Servers ─────────────────────────────────────────────

import type { KnownServer } from "./config.js";

export type KnownServersListResponse = ApiResponse<KnownServer[]>;

export interface AddKnownServerRequest {
  host: string;
  port: number;
  label?: string;
}

export interface RemoveKnownServerRequest {
  host: string;
  port: number;
}

export interface DiscoveredServerInfo {
  host: string;
  port: number;
  piPort: number;
  version: string;
  pid: number;
  isLocal: boolean;
}

export type DiscoverServersResponse = ApiResponse<DiscoveredServerInfo[]>;

/** Detected network interface for trusted networks UI. */
export interface NetworkInterface {
  name: string;
  address: string;
  netmask: string;
  cidr: string;
}

// ── Recommended extensions ───────────────────────────

export type ListRecommendedExtensionsResponse = ApiResponse<{
  recommended: EnrichedRecommendedExtension[];
}>;

// ── Tool registry ────────────────────

import type { Resolution } from "./tool-registry/types.js";
export type { Resolution, Source, TriedEntry } from "./tool-registry/types.js";

export type ListToolsResponse = ApiResponse<{ tools: Resolution[] }>;
export type GetToolResponse = ApiResponse<Resolution>;

export interface RescanToolsRequest {
  name?: string;
}

export interface SetToolOverrideRequest {
  path: string;
}

// ── Model Proxy: wire-protocol types ────────────────────────────────

/** OpenAI Chat Completions request shape (subset relevant to the proxy). */
export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: OpenAITool[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stop?: string | string[];
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: "assistant"; content?: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface OpenAIChatCompletionStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: "assistant";
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: { index: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason: string | null;
  }[];
}

export interface OpenAIModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  "x-pi"?: {
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    cost?: { input?: number; output?: number };
    input?: string[];
  };
}

export interface OpenAIModelsResponse {
  object: "list";
  data: OpenAIModelEntry[];
}

/** Anthropic Messages request shape (subset relevant to the proxy). */
export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  tools?: AnthropicTool[];
  stop_sequences?: string[];
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
  [key: string]: unknown;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicMessagesStreamEvent {
  type: string;
  message?: AnthropicMessagesResponse;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: { type: string; text?: string; partial_json?: string; thinking?: string; [key: string]: unknown };
  usage?: { output_tokens: number };
}

// ── Model Proxy: API key management ─────────────────────────────────

export interface ModelProxyApiKeysCreateRequest {
  label: string;
  scopes?: string[];
  expiresAt?: number;
}

export interface ModelProxyApiKeyEntry {
  id: string;
  label: string;
  createdBy?: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  hash: string; // redacted to "***" in list responses
}

export type ModelProxyApiKeysListResponse = ApiResponse<{
  keys: ModelProxyApiKeyEntry[];
  revoked: ModelProxyApiKeyEntry[];
}>;

export type ModelProxyApiKeysCreateResponse = ApiResponse<{
  id: string;
  label: string;
  createdBy?: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  key: string; // cleartext, revealed ONCE
}>;

// ── OpenSpec Change Grouping ────────────────────────────────────────
// See change: add-openspec-change-grouping (tasks 1.6, 5.x).
// Endpoints under `/api/openspec/groups[?cwd=…]`.

export type GetOpenSpecGroupsResponse = ApiResponse<OpenSpecGroupsFile>;

export interface CreateOpenSpecGroupRequest {
  name: string;
  color?: string;
}
export type CreateOpenSpecGroupResponse = ApiResponse<OpenSpecGroup>;

export interface UpdateOpenSpecGroupRequest {
  name?: string;
  color?: string;
  order?: number;
}
export type UpdateOpenSpecGroupResponse = ApiResponse<OpenSpecGroup>;

export type DeleteOpenSpecGroupResponse = ApiResponse<void>;

export interface SetOpenSpecGroupAssignmentRequest {
  changeName: string;
  /** `null` removes the assignment (change becomes Ungrouped). */
  groupId: string | null;
}
export type SetOpenSpecGroupAssignmentResponse = ApiResponse<void>;

/** PUT `/api/openspec/groups/change-order?cwd=` — persist the manual ordering
 *  of changes within one group (or the implicit Ungrouped column).
 *  See change: redesign-openspec-board. */
export interface SetOpenSpecChangeOrderRequest {
  /** Target group id, or `OPENSPEC_UNGROUPED_KEY` for Ungrouped. */
  groupId: string;
  /** Ordered list of `changeName` for this group. */
  order: string[];
}
export type SetOpenSpecChangeOrderResponse = ApiResponse<void>;
