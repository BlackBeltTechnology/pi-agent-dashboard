/**
 * Fixture state definitions for deterministic visual testing.
 *
 * All dates, IDs, paths, and content are fixed so screenshots produce
 * identical results on every run against the fixture dashboard.
 */

/** Fixed point in time for all fixture timestamps (ms since epoch). */
export const FIXTURE_NOW = 1714771200000; // 2024-05-03T20:00:00.000Z

/** Fixture session IDs — stable across runs. */
export const SESSION_IDS = {
  active: "fixture-session-active",
  ended: "fixture-session-ended",
} as const;

/** Fixture CWD paths (resolved under the runtime directory by the launcher). */
export const FIXTURE_CWDS = {
  active: "__fixture__/projects/my-app",
  ended: "__fixture__/projects/legacy-app",
} as const;

export interface FixtureSession {
  sessionId: string;
  cwd: string;
  name: string;
  source: "pi" | "dashboard";
  model: string;
  thinkingLevel: string;
  startedAt: number;
  endedAt: number | null;
  status: "active" | "ended";
  eventCount: number;
  pid: number;
  firstMessage: string;
  gitBranch: string;
  gitBranchUrl: string | null;
  registerReason: "spawn";
}

export interface FixtureEvent {
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export const FIXTURE_SESSIONS: FixtureSession[] = [
  {
    sessionId: SESSION_IDS.active,
    cwd: FIXTURE_CWDS.active,
    name: "Add user authentication",
    source: "pi",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "high",
    startedAt: FIXTURE_NOW - 600_000, // 10 min ago
    endedAt: null,
    status: "active",
    eventCount: 6,
    pid: 90001,
    firstMessage: "Add user authentication to the login flow",
    gitBranch: "feature/user-auth",
    gitBranchUrl: "https://github.com/fixture/my-app/tree/feature/user-auth",
    registerReason: "spawn",
  },
  {
    sessionId: SESSION_IDS.ended,
    cwd: FIXTURE_CWDS.ended,
    name: "Fix navigation bug",
    source: "pi",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "medium",
    startedAt: FIXTURE_NOW - 3_600_000, // 1 hour ago
    endedAt: FIXTURE_NOW - 1_800_000, // 30 min ago
    status: "ended",
    eventCount: 4,
    pid: 90002,
    firstMessage: "Fix the navigation bug when switching between tabs",
    gitBranch: "fix/nav-bug",
    gitBranchUrl: "https://github.com/fixture/legacy-app/tree/fix/nav-bug",
    registerReason: "spawn",
  },
];

/**
 * Production-shaped event rows for the active session.
 * These are deterministic chat/tool messages designed to produce
 * recognizable but UI-safe content for visual screenshots.
 */
export const FIXTURE_EVENTS: Record<string, FixtureEvent[]> = {
  [SESSION_IDS.active]: [
    {
      eventType: "message_start",
      timestamp: FIXTURE_NOW - 590_000,
      data: {
        role: "user",
        content: "Add user authentication to the login flow",
        nonce: "fixture-msg-1",
      },
    },
    {
      eventType: "message_end",
      timestamp: FIXTURE_NOW - 580_000,
      data: {
        role: "assistant",
        content:
          "I'll add user authentication to the login flow. Let me start by examining the current login component and then add JWT-based auth.",
        nonce: "fixture-msg-2",
      },
    },
    {
      eventType: "tool_start",
      timestamp: FIXTURE_NOW - 570_000,
      data: {
        toolName: "read",
        toolCallId: "fixture-tool-1",
        input: { path: "src/components/Login.tsx" },
      },
    },
    {
      eventType: "tool_end",
      timestamp: FIXTURE_NOW - 560_000,
      data: {
        toolName: "read",
        toolCallId: "fixture-tool-1",
        output: "export default function Login() {\n  return <form>...</form>;\n}",
      },
    },
    {
      eventType: "message_start",
      timestamp: FIXTURE_NOW - 550_000,
      data: {
        role: "assistant",
        content:
          "I've reviewed the login component. The auth flow will use JWT tokens stored in localStorage with refresh token rotation.",
        nonce: "fixture-msg-3",
      },
    },
    {
      eventType: "message_end",
      timestamp: FIXTURE_NOW - 540_000,
      data: {
        role: "assistant",
        content: "The implementation is complete. Here's what was added:\n\n- JWT token generation and validation\n- Refresh token rotation\n- Protected route middleware",
        nonce: "fixture-msg-4",
      },
    },
  ],
  [SESSION_IDS.ended]: [
    {
      eventType: "message_start",
      timestamp: FIXTURE_NOW - 3_590_000,
      data: {
        role: "user",
        content: "Fix the navigation bug when switching between tabs",
        nonce: "fixture-ended-msg-1",
      },
    },
    {
      eventType: "message_end",
      timestamp: FIXTURE_NOW - 3_580_000,
      data: {
        role: "assistant",
        content: "The navigation bug was caused by stale state in the tab switcher. The fix ensures the active tab index resets on route change.",
        nonce: "fixture-ended-msg-2",
      },
    },
    {
      eventType: "tool_start",
      timestamp: FIXTURE_NOW - 3_570_000,
      data: {
        toolName: "edit",
        toolCallId: "fixture-ended-tool-1",
        input: { path: "src/components/NavTabs.tsx" },
      },
    },
    {
      eventType: "tool_end",
      timestamp: FIXTURE_NOW - 3_560_000,
      data: {
        toolName: "edit",
        toolCallId: "fixture-ended-tool-1",
        output: "Applied fix — reset tab index on route change.",
      },
    },
  ],
};

/**
 * Git info updates that the test-pi bridge sends after session_register.
 */
export const FIXTURE_GIT_UPDATES: Record<string, { gitBranch: string; gitBranchUrl: string | null }> = {
  [SESSION_IDS.active]: {
    gitBranch: "feature/user-auth",
    gitBranchUrl: "https://github.com/fixture/my-app/tree/feature/user-auth",
  },
  [SESSION_IDS.ended]: {
    gitBranch: "fix/nav-bug",
    gitBranchUrl: "https://github.com/fixture/legacy-app/tree/fix/nav-bug",
  },
};
