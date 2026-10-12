// The authored prose layer. Each entry carries two review stamps, written by `stamp`:
//   descHash — hash of the frontmatter description when the entry was last reviewed
//   bodyHash — hash of the SKILL.md body (frontmatter stripped) at that moment
// plus a body snapshot in <dir>/.stamps/<id>.md so drift can be shown as a diff.
//   reviewed    — every bodyHash this entry was ever stamped against (last MAX_REVIEWED = 8)
//   stampedPath — which copy was shown when it was stamped
// If the shown copy changes (other primary project, new install) to a text that was already
// reviewed, nothing is flagged; to a new text, drift says "shown copy switched".
// An entry may also carry `redo: true` (set by `redo`) to force a rewrite.
import fs from 'node:fs';
import path from 'node:path';
import { sha, isSafeId } from './scan.mjs';

export const CATEGORIES = ['Research', 'Knowledge & memory', 'Rigor & review', 'Spec workflow',
  'Frontend & design', 'Coding', 'Media & docs', 'Workspace & tooling'];
export const COSTS = ['free', 'tokens', 'credits'];
export const DRIFT_RATIO = 0.10;   // body drift counts as work at >= 10% of lines changed
export const MAX_DIFF_CELLS = 4e6;
export const MAX_REVIEWED = 8;     // remembered reviewed body versions per entry // LCS table cap (~2000x2000 lines); larger -> no diff, re-read

export const bodyOf = raw => String(raw).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
export const descHash = d => sha(d || '').slice(0, 12);
export const bodyHash = raw => sha(bodyOf(raw)).slice(0, 12);
const headingsOf = body => [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim());
// Defence in depth: ids come from third-party frontmatter. Reject unsafe shapes, then verify
// the resolved path is still inside <dir>/.stamps before any read or write.
export function snapPath(dir, id) {
  if (!isSafeId(id)) throw new Error('unsafe skill id refused for file use: ' + JSON.stringify(id));
  const base = path.resolve(dir, '.stamps');
  const p = path.resolve(base, id + '.md');
  if (path.dirname(p) !== base) throw new Error('stamp path escapes .stamps/: ' + JSON.stringify(id));
  return p;
}

// Line diff via LCS. Bodies are a few hundred lines, so O(n*m) is fine.
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return { ops: null, added: NaN, removed: NaN, tooLarge: true };
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', A[i++]]);
    else ops.push(['+', B[j++]]);
  }
  while (i < n) ops.push(['-', A[i++]]);
  while (j < m) ops.push(['+', B[j++]]);
  const added = ops.filter(o => o[0] === '+' && o[1].trim()).length;
  const removed = ops.filter(o => o[0] === '-' && o[1].trim()).length;
  return { ops, added, removed };
}

// Compact unified-style rendering: changed lines with `ctx` lines of context.
export function renderDiff(ops, ctx = 1, maxLines = 120) {
  const keep = new Set();
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -ctx; d <= ctx; d++) keep.add(k + d); });
  const out = [];
  let last = -2;
  for (let k = 0; k < ops.length; k++) {
    if (!keep.has(k)) continue;
    if (k !== last + 1) out.push('@@');
    out.push(ops[k][0] + ' ' + ops[k][1]);
    last = k;
  }
  return out.length > maxLines ? out.slice(0, maxLines).concat('… (' + (out.length - maxLines) + ' more diff lines)') : out;
}

// Classify body drift of one skill against its stamp.
export function drift(dir, s, m) {
  if (!m || !m.bodyHash) return null;
  const cur = bodyHash(s.raw);
  if (m.bodyHash === cur || (m.reviewed || []).includes(cur)) return null;
  const switched = m.stampedPath && m.stampedPath !== s.path
    ? 'shown copy switched from ' + m.stampedPath + ' — ' : '';
  const now = bodyOf(s.raw);
  if (!isSafeId(s.id)) return { id: s.id, major: true, note: switched + 'unsafe id — no snapshot kept, re-read the whole body' };
  const sp = snapPath(dir, s.id);
  if (!fs.existsSync(sp)) return { id: s.id, major: true, switched: !!switched, note: switched + 'no snapshot — re-read the whole body' };
  const then = fs.readFileSync(sp, 'utf8');
  const { ops, added, removed, tooLarge } = diffLines(then, now);
  if (tooLarge) return { id: s.id, major: true, switched: !!switched, note: switched + 'body too large to diff — re-read the whole body' };
  const headingsChanged = headingsOf(then).join('\n') !== headingsOf(now).join('\n');
  const lines = Math.max(now.split('\n').length, 1);
  const ratio = (added + removed) / lines;
  // a copy switch to unreviewed text is always review-worthy, however small the diff
  return { id: s.id, major: !!switched || headingsChanged || ratio >= DRIFT_RATIO, added, removed, lines,
           headingsChanged, ratio, ops, switched: !!switched,
           note: switched + '+' + added + '/-' + removed + ' of ' + lines + ' lines' + (headingsChanged ? ', headings changed' : '') };
}

export function check(dir, payload, summaries) {
  const ids = new Set(payload.skills.map(s => s.id));
  const r = { missing: [], stale: [], redo: [], drifted: [], minorDrift: [], unstamped: [], invalid: [], orphans: [], driftInfo: {} };
  for (const s of payload.skills) {
    const m = summaries[s.id];
    if (!m) { r.missing.push(s.id); continue; }
    if (m.redo) r.redo.push(s.id);
    if (!m.descHash || !m.bodyHash) r.unstamped.push(s.id);
    if (m.descHash && m.descHash !== descHash(s.description)) r.stale.push(s.id);
    const d = drift(dir, s, m);
    if (d) { (d.major ? r.drifted : r.minorDrift).push(s.id); r.driftInfo[s.id] = d; }
    const bad = [];
    for (const k of ['oneLiner', 'summary', 'useWhen', 'category', 'cost']) if (!m[k]) bad.push('no ' + k);
    if (m.category && !CATEGORIES.includes(m.category)) bad.push('unknown category "' + m.category + '"');
    if (m.cost && !COSTS.includes(m.cost)) bad.push('unknown cost "' + m.cost + '"');
    if (!Array.isArray(m.keySteps) || !m.keySteps.length) bad.push('no keySteps');
    if (m.id && m.id !== s.id) bad.push('id field "' + m.id + '" != key');
    if (!isSafeId(s.id)) bad.push('unsafe skill id — cannot be stamped');
    if (bad.length) r.invalid.push(s.id + ': ' + bad.join(', '));
  }
  r.orphans = Object.keys(summaries).filter(k => !ids.has(k)).sort();
  return r;
}

// Work that blocks `check` (exit 1). Minor drift and unstamped are reported, not blocking.
export const needsWork = r => r.missing.length + r.stale.length + r.redo.length + r.drifted.length + r.invalid.length > 0;

// Record "I re-read these against the current SKILL.md, they are accurate":
// both hashes, a fresh body snapshot, and clear any redo flag.
// `only` = ids to stamp, or the string 'ALL' (explicit --all). Unsafe ids are skipped.
export function stamp(dir, payload, summaries, only) {
  const want = only === 'ALL' ? null : new Set(only || []);
  if (want && !want.size) throw new Error('stamp needs skill ids, or --all');
  const done = [], refused = [];
  fs.mkdirSync(path.join(dir, '.stamps'), { recursive: true });
  for (const s of payload.skills) {
    const m = summaries[s.id];
    if (!m || (want && !want.has(s.id))) continue;
    if (!isSafeId(s.id)) { refused.push(s.id); continue; }
    const dh = descHash(s.description), bh = bodyHash(s.raw);
    const sp = snapPath(dir, s.id), body = bodyOf(s.raw);
    const snapOk = fs.existsSync(sp) && fs.readFileSync(sp, 'utf8') === body;
    const rev = (m.reviewed || []).filter(h => h !== bh).concat(bh).slice(-MAX_REVIEWED);
    if (m.descHash === dh && m.bodyHash === bh && !m.redo && snapOk && m.stampedPath === s.path &&
        JSON.stringify(rev) === JSON.stringify(m.reviewed || [])) continue;
    m.descHash = dh; m.bodyHash = bh; m.reviewed = rev; m.stampedPath = s.path; delete m.redo;
    fs.writeFileSync(sp, body);
    done.push(s.id);
  }
  return { done, refused };
}

export function markRedo(summaries, ids) {
  const done = [], unknown = [];
  for (const id of ids) {
    if (!summaries[id]) { unknown.push(id); continue; }
    summaries[id].redo = true;
    done.push(id);
  }
  return { done, unknown };
}

// Stable on-disk form: keys sorted, 2-space indent, trailing newline.
export function serialize(summaries) {
  const out = {};
  for (const k of Object.keys(summaries).sort()) out[k] = summaries[k];
  return JSON.stringify(out, null, 2) + '\n';
}
