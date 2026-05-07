/**
 * Seed bridge events — ONE WebSocket connection per session.
 * Keeps all sessions alive like real production.
 */
import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9999';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function newConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 10000);
  });
}

const S = (ws, msg) => ws.send(JSON.stringify(msg));

async function createSession(cwd, source, model, thinking, name, startedOffset, gitBranch, gitUrl, pr, phase, change, active, tool, idle = false) {
  const ws = await newConnection();
  const sid = `seed-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${ Date.now().toString(36)}`;
  const now = Date.now();
  
  S(ws, { type: 'session_register', sessionId: sid, cwd, source, model, thinkingLevel: thinking,
    startedAt: now - startedOffset, pid: 9000 + Math.floor(Math.random() * 1000), registerReason: 'spawn' });
  await sleep(100);
  S(ws, { type: 'replay_complete', sessionId: sid });
  await sleep(100);
  S(ws, { type: 'event_forward', sessionId: sid, event: { eventType: 'agent_start', timestamp: now - startedOffset + 500, data: {} } });
  await sleep(50);
  
  if (name) { S(ws, { type: 'session_name_update', sessionId: sid, name }); await sleep(50); }
  if (gitBranch) { S(ws, { type: 'git_info_update', sessionId: sid, gitBranch, gitBranchUrl: gitUrl, gitPrNumber: pr, gitPrUrl: pr ? `https://github.com/dev/my-project/pull/${pr}` : undefined }); await sleep(50); }
  
  // For idle sessions: end agent BEFORE openspec (agent_end clears openspec)
  if (idle) {
    S(ws, { type: 'event_forward', sessionId: sid, event: { eventType: 'agent_end', timestamp: now - startedOffset + 2000, data: {} } });
    await sleep(30);
  }
  
  if (phase) {
    const suffix = phase === 'apply' ? 'apply-change' : phase === 'archive' ? 'archive-change' : phase;
    S(ws, { type: 'event_forward', sessionId: sid, event: { eventType: 'tool_execution_start', timestamp: now - 80000,
      data: { toolName: 'Read', args: { path: `.pi/skills/openspec-${suffix}/SKILL.md` } } } });
    await sleep(30);
  }
  if (change) {
    S(ws, { type: 'event_forward', sessionId: sid, event: { eventType: 'tool_execution_start', timestamp: now - 60000,
      data: { toolName: active ? 'Write' : 'Read', args: { path: `openspec/changes/${change}/proposal.md` } } } });
    await sleep(30);
  }
  if (tool) {
    S(ws, { type: 'event_forward', sessionId: sid, event: { eventType: 'tool_execution_start', timestamp: now - 3000,
      data: { toolName: tool, args: {} } } });
    await sleep(30);
  }
  
  // Don't close — keep alive
  ws.on('close', () => {});
  console.log(`[seed] ${name}: ${sid.slice(0,20)} idle=${idle} phase=${phase||'-'} tool=${tool||'-'} git=${gitBranch||'-'}`);
  return ws;
}

async function main() {
  // Wait for dashboard
  for (let i = 0; i < 60; i++) {
    try { await newConnection(); break; }
    catch { await sleep(1000); }
  }
  console.log('[seed] Dashboard ready, creating sessions...');
  
  // Project dirs
  const P1 = '/home/pi/dev/my-project';
  const W1 = '/home/pi/dev/worktrees/shadow-refactor';
  const W2 = '/home/pi/dev/worktrees/shadow-darkmode';
  const P2 = '/home/pi/dev/other-project';

  // ── Session 1: Streaming + Read + Apply + full git + worktree ──
  await createSession(W1, 'dashboard', 'anthropic/claude-sonnet-4-20250514', 'high',
    'Refactor API client', 300000, 'shadow/refactor-api', 'https://github.com/dev/my-project/tree/shadow/refactor-api', 42,
    'apply', 'refactor-api-client', true, 'Read');

  // ── Session 2: ask_user + Explore + git + worktree ──
  await createSession(W2, 'tui', 'anthropic/claude-sonnet-4-20250514', 'high',
    'Add dark mode', 600000, 'shadow/dark-mode', 'https://github.com/dev/my-project/tree/shadow/dark-mode', undefined,
    'explore', 'add-dark-mode', false, 'ask_user');

  // ── Session 3: Streaming + Bash + Archive + attached ──
  await createSession(P1, 'dashboard', 'anthropic/claude-opus-4-20250514', 'medium',
    'Archive old changes', 400000, 'main', 'https://github.com/dev/my-project/tree/main', undefined,
    'archive', 'old-feature', true, 'Bash');

  // ── Session 4: Streaming + Write + New phase ──
  await createSession(P1, 'dashboard', 'openai/gpt-4.1', undefined,
    'New feature: real-time sync', 500000, 'feature/real-time-sync', undefined, undefined,
    'new', 'real-time-sync', true, 'Write');

  // ── Session 5: Idle + Propose + git + tmux ──
  await createSession(P1, 'tmux', 'openai/gpt-4o', undefined,
    'Fix auth middleware', 900000, 'feature/fix-auth', 'https://github.com/dev/my-project/tree/feature/fix-auth', undefined,
    'propose', 'fix-auth-middleware', true, undefined, true);

  // ── Session 6: Idle + Verify + source=zed ──
  await createSession(P1, 'zed', 'anthropic/claude-sonnet-4-20250514', 'high',
    'Verify release v2.0', 700000, 'release/v2.0', 'https://github.com/dev/my-project/tree/release/v2.0', undefined,
    'verify', 'release-v2', true, undefined, true);

  // ── Session 7: Idle + minimal (no git, no openspec, terminal, cost=0) ──
  await createSession(P1, 'terminal', 'google/gemini-2.5-pro', undefined,
    'Quick script', 1800000, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, true);

  // ── Session 8: Idle + tmux + minimal ──
  await createSession(P1, 'tmux', 'anthropic/claude-haiku-4-20250514', undefined,
    undefined, 3600000, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, true);

  // ── Session 9: Other project + Streaming + git ──
  await createSession(P2, 'dashboard', 'google/gemini-2.5-flash', undefined,
    'Refactor lib', 300000, 'main', 'https://github.com/dev/other-project/tree/main', undefined,
    undefined, undefined, undefined, 'Read');

  // ── Session 10: Other project + Idle ──
  await createSession(P2, 'tui', 'anthropic/claude-sonnet-4-20250514', 'high',
    'Update README', 600000, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, true);

  console.log('[seed] All 10 sessions alive with dedicated connections');
  // Keep process alive forever
  await new Promise(() => {});
}

main().catch(err => { console.error('[seed] Fatal:', err); process.exit(1); });
