/* BPMN Package Explorer — buildless viewer shell logic.
 * Loads package-data.json, mounts bpmn-js / dmn-js / the form adapter, and
 * wires the side panel, drill-down, participant switcher, roles and diagnostics.
 * No bundler, no install, no network. */
(function () {
  'use strict';

  var ROLE_CLASSES = ['role-0', 'role-1', 'role-2', 'role-3'];
  var DEPTH_LIMIT = 20;

  var els = {
    canvas: document.getElementById('canvas'),
    panel: document.getElementById('panel'),
    panelTitle: document.getElementById('panel-title'),
    panelPath: document.getElementById('panel-path'),
    panelBody: document.getElementById('panel-body'),
    panelClose: document.getElementById('panel-close'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    zoomReset: document.getElementById('zoom-reset'),
    switcher: document.getElementById('switcher'),
    switcherSelect: document.getElementById('switcher-select'),
    legend: document.getElementById('legend'),
    diagnostics: document.getElementById('diagnostics'),
    diagList: document.getElementById('diag-list'),
    ofAttribution: document.getElementById('of-attribution'),
  };

  var state = { data: null, viewer: null, dmn: null, navStack: [], currentFile: null };

  function diag(msgs) {
    if (!msgs || !msgs.length) return;
    for (var i = 0; i < msgs.length; i++) {
      var li = document.createElement('li');
      li.textContent = msgs[i];
      els.diagList.appendChild(li);
    }
    els.diagnostics.classList.remove('hidden');
  }

  function assetLoadFailed() {
    // 7.3b — if a bundle did not load, the package was likely served outside the
    // render root (asset root not on this origin). Diagnose instead of showing a
    // diagram with missing icons.
    if (typeof window.BpmnJS === 'undefined') {
      document.body.innerHTML =
        '<div style="padding:24px;font-family:system-ui">' +
        '<h3>Viewer assets failed to load</h3>' +
        '<p>The vendored bpmn-js bundle was not served under this origin. ' +
        'Serve the assembled <em>render root</em> (which symlinks the shared asset root) ' +
        'rather than the package directory directly.</p></div>';
      return true;
    }
    return false;
  }

  function bindingsFor(file) {
    return (state.data.bindings || []).filter(function (b) {
      if (b.kind === 'participant') return false;
      return (b.in || state.data.entry) === file;
    });
  }
  function rolesFor(file) {
    return (state.data.roles || []).filter(function (r) {
      return (r.in || state.data.entry) === file;
    });
  }

  function fetchText(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return r.text();
    });
  }
  function xmlHasDI(xml) { return /<(\w+:)?BPMNDiagram[\s>]/.test(xml) || /<bpmndi:/.test(xml); }

  // ── main bpmn mount ─────────────────────────────────────────────────────
  function mountProcess(file, push) {
    return fetchText(file).then(function (xml) {
      if (!xmlHasDI(xml)) {
        // 7.14 — a navigated-to file with no DI is a diagnostic, not a blank canvas.
        diag(['Called process "' + file + '" carries no layout (DI) and cannot be rendered here; generate it through the pipeline first.']);
        return;
      }
      if (state.viewer) state.viewer.destroy();
      state.viewer = new window.BpmnJS({ container: els.canvas });
      state.currentFile = file;
      return state.viewer.importXML(xml).then(function () {
        var canvas = state.viewer.get('canvas');
        canvas.zoom('fit-viewport'); // 7.21 fit on load
        // Leave headroom for the top-left toolbar / switcher overlay so the
        // diagram's top row is never hidden beneath (and clickable) them.
        canvas.scroll({ dx: 0, dy: 72 });
        applyRoles(file);
        wireClicks(file);
      });
    });
  }

  function wireClicks(file) {
    var binds = bindingsFor(file);
    var byElement = {};
    binds.forEach(function (b) { byElement[b.element] = b; });
    state.viewer.on('element.click', function (e) {
      var id = e.element.id;
      var b = byElement[id];
      if (!b) return; // 7.11 unbound element is inert
      if (b.kind === 'process') return drillDown(b, e.element.name || id);
      openPanel(b, e.element.name || id);
    });
  }

  // ── side panel (decision / form) ────────────────────────────────────────
  function openPanel(binding, elementName) {
    els.panelTitle.textContent = elementName;
    els.panelPath.textContent = binding.ref;
    els.panelBody.innerHTML = '';
    els.panel.classList.add('open');
    document.body.classList.add('panel-open');
    if (binding.kind === 'decision') return mountDecision(binding.ref);
    if (binding.kind === 'form') return mountForm(binding.ref);
  }
  function closePanel() {
    els.panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    if (state.dmn) { state.dmn.destroy(); state.dmn = null; }
    els.panelBody.innerHTML = '';
  }

  function mountDecision(ref) {
    return fetchText(ref).then(function (xml) {
      if (state.dmn) state.dmn.destroy();
      state.dmn = new window.DmnJS({ container: els.panelBody });
      return state.dmn.importXML(xml).then(function (res) {
        // 7.7 — a multi-decision DRD without DI is refused at manifest validation,
        // so anything reaching here is renderable; surface any dmn-js warnings.
        if (res && res.warnings && res.warnings.length) {
          diag(res.warnings.map(function (w) { return 'DMN: ' + (w.message || w); }));
        }
      }).catch(function (err) {
        els.panelBody.innerHTML = '<div class="placeholder">Could not render decision: ' + err.message + '</div>';
      });
    });
  }

  // ── form mount behind a SINGLE adapter (7.18) ───────────────────────────
  function mountForm(ref) {
    return fetchText(ref).then(function (text) {
      var schema; try { schema = JSON.parse(text); } catch (e) { schema = null; }
      var mount = document.createElement('div');
      mount.className = 'form-mount';
      els.panelBody.appendChild(mount);
      // The one and only call site for the form renderer. Renegotiating the
      // entry point touches only this block.
      if (window.OpenFormsMui && typeof window.OpenFormsMui.render === 'function' && schema) {
        try {
          window.OpenFormsMui.render(mount, schema, { readOnly: true, locale: 'hu' });
          els.ofAttribution.hidden = false; // 7.22 OpenForms attribution when a form renders
          return;
        } catch (e) { /* fall through to placeholder */ }
      }
      // 7.19 — absent renderer: a legible placeholder, no console error, no break.
      var ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.innerHTML = '<strong>Form: ' + ref + '</strong><br/>The binding is valid. ' +
        'The OpenForms form renderer is not installed, so the form is not displayed.';
      mount.appendChild(ph);
    });
  }

  // ── drill-down (kind: process) ──────────────────────────────────────────
  function drillDown(binding, callerName) {
    if (state.navStack.length >= DEPTH_LIMIT) {
      diag(['Navigation depth limit reached (' + DEPTH_LIMIT + '); stopping drill-down.']);
      return;
    }
    var visited = state.navStack.map(function (s) { return s.file; }).concat(state.currentFile);
    if (visited.indexOf(binding.ref) !== -1) {
      // 7.13 — recursion notice instead of an unbounded stack.
      diag(['Recursion: "' + binding.ref + '" is already open in this navigation path. Not re-entering.']);
      return;
    }
    state.navStack.push({ file: state.currentFile, callerName: state.currentFile });
    addReturnControl(callerName);
    mountProcess(binding.ref, true);
  }
  function addReturnControl(callerName) {
    var existing = document.getElementById('return-control');
    if (existing) existing.remove();
    var btn = document.createElement('button');
    btn.id = 'return-control';
    btn.textContent = '← Back to ' + callerName;
    btn.onclick = function () {
      var prev = state.navStack.pop();
      if (!prev) return;
      if (!state.navStack.length) btn.remove();
      mountProcess(prev.file, false);
    };
    document.getElementById('return-zone').appendChild(btn);
  }

  // ── participant switcher (7.15) ─────────────────────────────────────────
  function buildSwitcher() {
    var participants = (state.data.bindings || []).filter(function (b) { return b.kind === 'participant'; });
    if (!participants.length) return;
    els.switcher.hidden = false;
    var opt = document.createElement('option');
    opt.value = state.data.entry; opt.textContent = state.data.name || state.data.entry;
    els.switcherSelect.appendChild(opt);
    participants.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.ref; o.textContent = p.name || p.ref;
      els.switcherSelect.appendChild(o);
    });
    els.switcherSelect.onchange = function () {
      state.navStack = [];
      var rc = document.getElementById('return-control'); if (rc) rc.remove();
      mountProcess(els.switcherSelect.value, false);
    };
  }

  // ── roles (7.17) ────────────────────────────────────────────────────────
  var roleIndex = {};
  function applyRoles(file) {
    var roles = rolesFor(file);
    if (!roles.length) { els.legend.hidden = true; return; }
    var canvas = state.viewer.get('canvas');
    var reg = state.viewer.get('elementRegistry');
    var names = [];
    roles.forEach(function (r) {
      if (!(r.role in roleIndex)) { roleIndex[r.role] = Object.keys(roleIndex).length % ROLE_CLASSES.length; names.push(r.role); }
      if (reg.get(r.element)) {
        canvas.addMarker(r.element, 'role-marker');
        canvas.addMarker(r.element, ROLE_CLASSES[roleIndex[r.role]]);
      }
    });
    renderLegend();
  }
  function renderLegend() {
    var keys = Object.keys(roleIndex);
    if (!keys.length) return;
    els.legend.hidden = false;
    els.legend.innerHTML = '<h4>Roles</h4>';
    keys.forEach(function (role) {
      var row = document.createElement('div'); row.className = 'row';
      var sw = document.createElement('span'); sw.className = 'swatch';
      var cls = ROLE_CLASSES[roleIndex[role]];
      var color = { 'role-0': '#1f77b4', 'role-1': '#d62728', 'role-2': '#2ca02c', 'role-3': '#9467bd' }[cls];
      var dash = { 'role-0': 'solid', 'role-1': 'dashed', 'role-2': 'dotted', 'role-3': 'dash-dot' }[cls];
      sw.style.border = '3px ' + (dash === 'solid' ? 'solid' : dash === 'dotted' ? 'dotted' : 'dashed') + ' ' + color;
      row.appendChild(sw);
      row.appendChild(document.createTextNode(role + ' (' + dash + ')'));
      els.legend.appendChild(row);
    });
  }

  // ── controls ────────────────────────────────────────────────────────────
  function zoom(delta) { if (!state.viewer) return; var c = state.viewer.get('canvas'); c.zoom(c.zoom() + delta); }
  els.zoomIn.onclick = function () { zoom(0.2); };
  els.zoomOut.onclick = function () { zoom(-0.2); };
  els.zoomReset.onclick = function () { if (state.viewer) state.viewer.get('canvas').zoom('fit-viewport'); };
  els.panelClose.onclick = closePanel;
  els.diagnostics.querySelector('.dismiss').onclick = function () { els.diagnostics.classList.add('hidden'); };

  // Load the OpenForms renderer only when vendored (avoids a 404 / console error).
  function loadFormRenderer(data) {
    return new Promise(function (resolve) {
      if (!data.formsRenderer) { window.__ofMissing = true; return resolve(); }
      var s = document.createElement('script');
      s.src = 'assets/openforms/openforms-mui.iife.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { window.__ofMissing = true; resolve(); };
      document.head.appendChild(s);
    });
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  if (assetLoadFailed()) return;
  fetchText('package-data.json').then(function (t) {
    state.data = JSON.parse(t);
    return loadFormRenderer(state.data);
  }).then(function () {
    // surface generation/validation diagnostics
    var d = state.data.diagnostics;
    if (d) {
      var msgs = [];
      (d.errors || []).forEach(function (e) { msgs.push('ERROR [' + e.code + '] ' + e.message); });
      (d.warnings || []).forEach(function (w) { msgs.push('[' + w.code + '] ' + w.message); });
      diag(msgs);
    }
    buildSwitcher();
    // 8.4 standalone .dmn: mount the decision viewer on the main canvas.
    if (state.data.entryKind === 'dmn') {
      state.dmn = new window.DmnJS({ container: els.canvas });
      return fetchText(state.data.entry).then(function (xml) { return state.dmn.importXML(xml); });
    }
    return mountProcess(state.data.entry, false);
  }).catch(function (err) {
    diag(['Failed to load package: ' + err.message]);
  });
})();
