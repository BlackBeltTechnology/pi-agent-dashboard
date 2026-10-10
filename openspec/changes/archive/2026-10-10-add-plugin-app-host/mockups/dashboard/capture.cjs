// Captures the RUNNING dashboard (http://localhost:8000) and rewrites the live DOM to show
// how a plugin app (the voice wall) would render as a folder page with presentation:"content".
// Usage (repo root): NODE_PATH=$PWD/node_modules node openspec/changes/add-plugin-app-host/mockups/dashboard/capture.cjs [folderCwd]
const { chromium } = require('playwright');
const path = require('path');
const OUT = __dirname;
const CWD = process.argv[2] || '/Users/robson/Documents';
const BASE = process.env.DASH || 'http://localhost:8000';
const enc = Buffer.from(CWD).toString('base64url');

// Runs in the page: turn the OpenSpec board into the embedded wall + add the folder tile.
function compose({ cwd, withTile }) {
  const leaf = cwd.split('/').filter(Boolean).pop();
  const dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;flex:none"></span>';
  const mdi = (d, s = '0.8rem') => `<svg viewBox="0 0 24 24" style="width:${s};height:${s}"><path d="${d}" style="fill:currentcolor"></path></svg>`;
  const ICON_PRESENT = 'M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z';
  const ICON_EXT = 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z';
  const ICON_WALL = 'M3,3H11V11H3V3M13,3H21V11H13V3M3,13H11V21H3V13M13,13H21V21H13V13Z';

  // ---- content area: board → wall -------------------------------------------------
  const board = document.querySelector('[data-testid=openspec-board]');
  if (board) {
    board.setAttribute('data-testid', 'embedded-app-wall');
    const top = board.children[0];
    const title = top.querySelector('span.font-semibold');
    title.innerHTML = `Live wall <span class="text-[var(--text-tertiary)] font-normal">· ${leaf}</span>`;
    const chip = document.createElement('span');
    chip.className = 'text-[11px] px-2.5 py-1 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] flex items-center gap-1.5';
    chip.style.borderStyle = 'dashed';
    chip.innerHTML = `${dot}<b>Sprint 42 planning</b><span class="text-[var(--text-tertiary)]">· 00:14:32 · 5 speakers</span>`;
    chip.title = "app HeaderContext";
    title.after(chip);
    const btns = [...top.querySelectorAll('button')].filter(b => b.dataset.testid !== 'board-back');
    const tpl = btns[0];
    btns.forEach(b => b.remove());
    const mk = (icon, label) => { const b = tpl.cloneNode(false); b.removeAttribute('data-testid'); b.innerHTML = mdi(icon, '0.75rem') + ' ' + label; b.style.display = 'inline-flex'; b.style.gap = '4px'; b.style.alignItems = 'center'; return b; };
    top.append(mk(ICON_PRESENT, 'Present'), mk(ICON_EXT, 'Open standalone'));

    // filter bar → wall tabs (app's own router)
    const fb = board.querySelector('[data-testid=board-filterbar]');
    const pillOn = 'text-[10px] px-2.5 py-[3px] rounded-full border text-blue-400 border-blue-500/50 bg-blue-500/8';
    const pillOff = 'text-[10px] px-2.5 py-[3px] rounded-full border text-[var(--text-tertiary)] border-[var(--border-secondary)]';
    fb.innerHTML = `<span class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">View</span><div class="flex gap-1">
      <button class="${pillOn}">Board</button><button class="${pillOff}">Graph</button><button class="${pillOff}">Transcript</button></div>
      <span class="w-px h-[18px] bg-[var(--border-secondary)]"></span>
      <span class="text-[11px] text-[var(--text-tertiary)]">Copilot <b class="text-[var(--text-primary)]">streaming</b> · last event 3s ago</span>`;

    // columns → wall areas
    const cols = board.querySelector('[data-testid=board-columns]');
    const colTpl = cols.querySelector('[data-testid^=board-column-]');
    const cardCls = 'relative bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-[10px] px-2.5 py-2';
    const tag = (t, c) => `<span class="text-[10px] px-1.5 rounded-full border" style="color:${c};border-color:color-mix(in srgb, ${c} 50%, transparent)">${t}</span>`;
    const card = (body, src, fresh) => `<div class="${cardCls}" ${fresh ? 'style="border-color:color-mix(in srgb,#3b82f6 55%,transparent)"' : ''}><div class="text-[var(--text-primary)] text-[12px]">${body}</div>${src ? `<div class="mt-1 text-[11px] text-[var(--text-tertiary)]"><span class="text-blue-400" style="text-decoration:underline" title="host.openSession(copilotId)">${src}</span></div>` : ''}</div>`;
    const areas = [
      ['Agenda', '#22c55e', [card('✓ Scope of sprint 42'), card('→ Logistics API cut-over', null, true), card('Release train dates')]],
      ['Decisions', '#3b82f6', [card(`${tag('decided', '#22c55e')} Cut over on the weekend, not Friday night.`, 'turn 212 · Anna K.', true), card(`${tag('decided', '#22c55e')} Keep the v1 endpoint for 30 days.`, 'turn 188 · Bence T.')]],
      ['Open questions', '#a855f7', [card(`${tag('question', '#60a5fa')} Who signs the runbook?`, 'turn 230 · Robson'), card(`${tag('question', '#60a5fa')} Do we need a DB freeze?`, 'turn 201 · Anna K.')]],
      ['Actions', '#f59e0b', [card(`${tag('action', '#f59e0b')} Bence: draft cut-over checklist`, 'turn 215'), card(`${tag('risk', '#ef4444')} Partner API rate limit unknown`, 'turn 224 · copilot')]],
    ];
    cols.innerHTML = '';
    for (const [name, color, items] of areas) {
      const c = colTpl.cloneNode(true);
      c.removeAttribute('data-testid'); c.style.height = 'auto';
      const head = c.children[0];
      head.children[0].style.background = color;
      head.children[1].textContent = name;
      head.children[2].textContent = String(items.length);
      head.querySelector('.ml-auto')?.remove();
      c.children[1].innerHTML = items.join('');
      [...c.children].slice(2).forEach(x => x.remove());
      cols.append(c);
    }
    const foot = board.lastElementChild;
    foot.textContent = 'Events stream from the meeting copilot (wall_emit). Click a turn link to open the copilot session; Back returns here.';
    // annotation
    const note = document.createElement('div');
    note.style.cssText = 'position:absolute;right:12px;bottom:40px;max-width:calc(100% - 24px);font:11px ui-monospace,monospace;padding:4px 8px;border:1px dashed #a855f7;border-radius:6px;background:var(--bg-secondary);color:var(--text-secondary);z-index:20';
    note.textContent = 'URL /folder/'+encodeURIComponent(leaf)+'…/wall · top bar = <EmbeddedApp> (OpenSpec-board layout) · body = wall <App/> · presentation:"content"';
    board.style.position = 'relative'; board.append(note);
  }

  // ---- sidebar: folder tile (sidebar-folder-section) --------------------------------
  if (withTile) {
    const os = document.querySelector(`[data-testid=folder-openspec-section][data-folder-openspec-section="${cwd}"]`) || document.querySelector('[data-testid=folder-openspec-section]');
    if (os) {
      const t = os.cloneNode(true);
      t.setAttribute('data-testid', 'folder-voice-wall-section');
      const btn = t.querySelector('[role=button]');
      btn.title = 'Open live wall';
      btn.style.borderColor = 'color-mix(in srgb,#ef4444 55%,transparent)';
      btn.style.boxShadow = '0 0 0 2px color-mix(in srgb,#3b82f6 45%,transparent)';
      btn.setAttribute('aria-current', 'page');
      const spans = btn.children;
      spans[0].textContent = 'Live wall';
      spans[1].className = 'shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center';
      spans[1].style.cssText = 'background:color-mix(in srgb,#ef4444 12%,transparent);color:#ef4444';
      spans[1].innerHTML = mdi(ICON_WALL, '0.93rem');
      spans[2].innerHTML = `<span style="display:flex;align-items:center;gap:6px">${dot}live</span><span class="text-[10px] font-semibold text-[var(--text-tertiary)]">00:14</span>`;
      [...spans].slice(3).forEach(x => x.remove());
      os.after(t);
    }
  }
}

function addMenu({ cwd }) {
  const panel = document.querySelector(`[role=menu][aria-label="Folder actions"]`);
  if (!panel) return false;
  const itemTpl = panel.querySelector('[role=menuitem]');
  const headTpl = panel.querySelector('div[aria-hidden=true].uppercase, div.uppercase');
  const grp = document.createElement('div');
  grp.setAttribute('data-testid', 'folder-menu-group-open');
  const h = headTpl.cloneNode(true); h.textContent = 'Open'; grp.append(h);
  for (const [label, hint, live] of [['Live wall', 'voice-wall · /folder/…/wall', true], ['Open wall standalone', 'projector window', false], ['Share live wall…', 'voice-wall', false], ['Open copilot', 'voice-assistant', false]]) {
    const b = itemTpl.cloneNode(false); b.removeAttribute('data-testid');
    b.innerHTML = `${live ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444"></span>' : '<span style="width:8px"></span>'}<span class="truncate">${label}</span><span class="ml-auto shrink-0 pl-2 text-[10px] text-[var(--text-muted)]">${hint}</span>`;
    if (live) b.style.background = 'var(--bg-hover)';
    grp.append(b);
  }
  const sep = document.createElement('div'); sep.className = 'mx-1 my-1 h-px bg-[var(--border-subtle)]'; grp.append(sep);
  panel.prepend(grp);
  return true;
}


// Idle: no meeting running. No LIVE WALL tile; voice-assistant MEETINGS tile; wall route empty state.
function composeIdle({ cwd, page }) {
  const leaf = cwd.split('/').filter(Boolean).pop();
  const mdi = (d, s = '0.8rem') => `<svg viewBox="0 0 24 24" style="width:${s};height:${s}"><path d="${d}" style="fill:currentcolor"></path></svg>`;
  const ICON_MIC = 'M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z';
  const ICON_WALL = 'M3,3H11V11H3V3M13,3H21V11H13V3M3,13H11V21H3V13M13,13H21V21H13V13Z';
  const os = document.querySelector(`[data-testid=folder-openspec-section][data-folder-openspec-section="${cwd}"]`) || document.querySelector('[data-testid=folder-openspec-section]');
  if (os) {
    const t = os.cloneNode(true); t.setAttribute('data-testid', 'folder-voice-meetings-section');
    const btn = t.querySelector('[role=button]'); btn.title = 'Meetings & knowledge';
    const sp = btn.children;
    sp[0].textContent = 'Meetings';
    sp[1].className = 'shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center';
    sp[1].style.cssText = 'background:color-mix(in srgb,#14b8a6 12%,transparent);color:#14b8a6';
    sp[1].innerHTML = mdi(ICON_MIC, '0.93rem');
    sp[2].innerHTML = `<span>3</span><span class="text-[10px] font-semibold text-[var(--text-tertiary)]">archived</span>`;
    [...sp].slice(3).forEach(x => x.remove());
    os.after(t);
  }
  if (!page) return;
  const board = document.querySelector('[data-testid=openspec-board]');
  const top = board.children[0];
  top.querySelector('span.font-semibold').innerHTML = `Live wall <span class="text-[var(--text-tertiary)] font-normal">· ${leaf}</span>`;
  [...top.querySelectorAll('button')].filter(b => b.dataset.testid !== 'board-back').forEach(b => b.remove());
  board.querySelector('[data-testid=board-filterbar]').remove();
  const cols = board.querySelector('[data-testid=board-columns]');
  const colTpl = cols.querySelector('[data-testid^=board-column-]');
  const cardCls = 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-[10px] px-2.5 py-2 text-[12px] text-[var(--text-primary)]';
  cols.className = 'flex flex-col items-center gap-4 p-8 flex-1 min-h-0 overflow-y-auto';
  const btnP = 'text-[12px] px-3 py-1.5 rounded-md border text-blue-400 border-blue-500/40 bg-blue-500/5 inline-flex items-center gap-1.5';
  const btnS = 'text-[12px] px-3 py-1.5 rounded-md border border-[var(--border-secondary)] text-[var(--text-secondary)] inline-flex items-center gap-1.5';
  const empty = document.createElement('div');
  empty.className = 'flex flex-col items-center text-center gap-2 max-w-[520px] mt-6';
  empty.innerHTML = `<span class="w-[44px] h-[44px] rounded-xl flex items-center justify-center" style="background:var(--bg-tertiary);color:var(--text-tertiary)">${mdi(ICON_WALL, '1.4rem')}</span>
    <div class="text-[15px] font-semibold text-[var(--text-primary)]">No live meeting in ${leaf}</div>
    <div class="text-[12px] text-[var(--text-tertiary)]">The live wall fills in while a meeting runs: agenda, decisions, open questions and actions from the meeting copilot.</div>
    <div class="flex gap-2 mt-2"><button class="${btnP}">${mdi(ICON_MIC, '0.8rem')} Start meeting…</button><button class="${btnS}">Meetings &amp; knowledge</button></div>`;
  // last meeting, read-only
  const last = document.createElement('div');
  last.className = 'w-full max-w-[980px] mt-4';
  last.innerHTML = `<div class="flex items-center gap-2 mb-2 text-[12px]"><span class="font-semibold text-[var(--text-primary)]">Last meeting · Sprint 41 review</span><span class="text-[var(--text-tertiary)]">2026-09-28 · 42 min · read-only</span><span class="text-[10px] px-1.5 rounded-full border border-[var(--border-secondary)] text-[var(--text-tertiary)]">archived</span><span class="flex-1"></span><span class="text-blue-400 underline">Open meeting notes</span></div><div class="flex gap-3 items-start" data-k="cols"></div>`;
  const row = last.querySelector('[data-k=cols]');
  const tag = (t, c) => `<span class="text-[10px] px-1.5 rounded-full border" style="color:${c};border-color:color-mix(in srgb, ${c} 50%, transparent)">${t}</span>`;
  for (const [name, color, items] of [
    ['Decisions', '#3b82f6', [`${tag('decided', '#22c55e')} Freeze the invoice schema until v2.`, `${tag('decided', '#22c55e')} Drop the CSV export.`]],
    ['Open questions', '#a855f7', [`${tag('question', '#60a5fa')} Who owns the partner sandbox?`]],
    ['Actions', '#f59e0b', [`${tag('action', '#f59e0b')} Anna: migration plan by Friday`]],
  ]) {
    const c = colTpl.cloneNode(true); c.removeAttribute('data-testid'); c.style.opacity = '0.8'; c.style.flex = '1 1 0'; c.style.maxWidth = 'none';
    const head = c.children[0]; head.children[0].style.background = color; head.children[1].textContent = name; head.children[2].textContent = String(items.length); head.querySelector('.ml-auto')?.remove();
    c.children[1].innerHTML = items.map(i => `<div class="${cardCls}">${i}</div>`).join('');
    [...c.children].slice(2).forEach(x => x.remove());
    row.append(c);
  }
  cols.innerHTML = ''; cols.append(empty, last);
  board.lastElementChild.textContent = 'Stale link or reload with no meeting running: the page stays (no redirect). Last meeting replayed from docs/meetings/<date>-<slug>.wall.jsonl.';
}

function idleMenu() {
  const panel = document.querySelector(`[role=menu][aria-label="Folder actions"]`);
  if (!panel) return false;
  const itemTpl = panel.querySelector('[role=menuitem]');
  const headTpl = panel.querySelector('div.uppercase');
  const mkGroup = (title, items) => {
    const g = document.createElement('div');
    const h = headTpl.cloneNode(true); h.textContent = title; g.append(h);
    for (const [label, hint] of items) {
      const b = itemTpl.cloneNode(false); b.removeAttribute('data-testid');
      b.innerHTML = `<span style="width:8px"></span><span class="truncate">${label}</span><span class="ml-auto shrink-0 pl-2 text-[10px] text-[var(--text-muted)]">${hint}</span>`;
      g.append(b);
    }
    const sep = document.createElement('div'); sep.className = 'mx-1 my-1 h-px bg-[var(--border-subtle)]'; g.append(sep);
    return g;
  };
  panel.prepend(mkGroup('Create', [['Start meeting…', 'voice-assistant'], ['Dry run…', 'not archived']]), mkGroup('Open', [['Meetings & knowledge', 'voice-assistant']]));
  return true;
}

(async () => {
  const b = await chromium.launch();
  // desktop
  let p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/folder/${enc}/openspec`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  await p.evaluate(compose, { cwd: CWD, withTile: true });
  await p.screenshot({ path: path.join(OUT, 'desktop.png') });
  // folder menu
  await p.click(`[data-testid="folder-actions-menu-${CWD}"]`); await p.waitForTimeout(500);
  await p.evaluate(addMenu, { cwd: CWD });
  await p.screenshot({ path: path.join(OUT, 'menu.png') });
  await p.close();
  // mobile
  p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(`${BASE}/folder/${enc}/openspec`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  await p.evaluate(compose, { cwd: CWD, withTile: false });
  await p.screenshot({ path: path.join(OUT, 'mobile.png') });
  // idle (no meeting): folder + menu, and stale /folder/<cwd>/wall
  p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/folder/${enc}/openspec`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  await p.evaluate(composeIdle, { cwd: CWD, page: true });
  await p.screenshot({ path: path.join(OUT, 'idle-wall.png') });
  await p.click(`[data-testid="folder-actions-menu-${CWD}"]`); await p.waitForTimeout(500);
  await p.evaluate(idleMenu);
  await p.screenshot({ path: path.join(OUT, 'idle-menu.png') });
  await b.close();
  console.log('ok', OUT);
})().catch(e => { console.error(e); process.exit(1); });
