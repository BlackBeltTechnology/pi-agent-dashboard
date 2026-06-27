// Renders an Obsidian-style frontmatter Properties panel from a data array.
// Mockup-only: mirrors the intended FrontmatterProperties component behaviour.
const IC = {
  text:'<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  para:'<path d="M4 6h16M4 12h16M4 18h10"/>',
  num:'<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  date:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bool:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  status:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  obj:'<path d="M20 6H4M20 12H4M20 18H4"/>',
};
const svg = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${IC[name]||IC.text}</svg>`;
const check = on => `<span class="check ${on?'':'no'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${on?'<path d="M5 12l5 5L20 6"/>':'<path d="M6 6l12 12M18 6L6 18"/>'}</svg>${on}</span>`;

function valHtml(p){
  switch(p.type){
    case 'num':   return `<span class="val num">${p.value}</span>`;
    case 'date':  return `<span class="val date">${p.value}${p.rel?` <span style="color:var(--text-muted)">· ${p.rel}</span>`:''}</span>`;
    case 'list':  return `<span class="val"><span class="chips">${p.value.map(v=>`<span class="chip">${v}</span>`).join('')}</span></span>`;
    case 'bool':  return `<span class="val">${check(p.value)}</span>`;
    case 'link':  return `<span class="val"><a href="${p.value}">${p.label||p.value}</a></span>`;
    case 'status':return `<span class="val"><span class="badge ${p.value}"><span class="dot"></span>${p.value}</span></span>`;
    case 'obj':   return `<span class="val"><span class="nested">${Object.entries(p.value).map(([k,v])=>`<span class="nk">${k}</span><span class="nv">${v}</span>`).join('')}</span></span>`;
    case 'empty': return `<span class="val empty">${p.value||'—'}</span>`;
    case 'text':  return `<span class="val text">${p.value}</span>`;
    default:      return `<span class="val">${p.value}</span>`;
  }
}
const iconFor = p => p.type==='status'?'status':p.type==='para'?'para':p.type==='obj'?'obj':p.type==='link'?'link':p.type;

function renderProps(el, fields, {collapsed=true, warn=null}={}){
  const rows = fields.map(p=>`<div class="row"><div class="key">${svg(iconFor(p))}<span class="kname">${p.key}</span></div>${valHtml(p)}</div>`).join('');
  el.innerHTML = `<div class="props ${collapsed?'collapsed':''}">
    <div class="props-head"><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      Properties <span class="count">${fields.length} field${fields.length===1?'':'s'}</span></div>
    ${warn?`<div class="parse-warn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>${warn}</div>`:''}
    <div class="props-body">${rows}</div>
  </div>`;
  el.querySelector('.props-head').onclick = e => e.currentTarget.parentElement.classList.toggle('collapsed');
}
function toggleTheme(){const r=document.documentElement;r.setAttribute('data-theme',r.getAttribute('data-theme')==='dark'?'light':'dark');}
