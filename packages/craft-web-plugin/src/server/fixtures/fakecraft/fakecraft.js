/*
 * FakeCraft — the test double of the live-control change (design D8). A tiny page-API app that speaks the
 * protocol of an ArtCraft web build: `window.fakecraft.request(method, params)`, a document delivered by the
 * shim's synthetic drop, an in-memory document with a text field, an export button and an in-app Save As.
 * Served ONLY when PI_DASHBOARD_FIXTURE_PLUGINS=1 (packages/craft-web-plugin/src/server/index.ts); never a
 * product feature. Plain ES2020, no imports (it runs under the production CSP: no inline scripts).
 *
 * engine.execute commands: ping (read-only) · echo · sleep{ms} · oversize{bytes} · malformed ·
 *   save · export · saveDialog · setText{text}.
 * Other methods: document.inspect · ui.inspect · ui.screenshot{data} · engine.commands.
 */
(function () {
  "use strict";
  var COMMANDS = [
    { id: "ping", label: "Ping", params: "{} → {pong}", enabled: true },
    { id: "echo", label: "Echo", params: "{…} → the params; records one op", enabled: true },
    { id: "sleep", label: "Sleep", params: "{ms} → {slept}", enabled: true },
    { id: "oversize", label: "Oversize", params: "{bytes?} → a string of that size", enabled: true },
    { id: "malformed", label: "Malformed", params: "{} → a reply JSON cannot carry", enabled: true },
    { id: "save", label: "Save", params: "{} writes the document through the save picker", enabled: true },
    { id: "export", label: "Export", params: "{} downloads export.pdf", enabled: true },
    { id: "saveDialog", label: "Save As dialog", params: "{} opens the in-app Save As", enabled: true },
    { id: "setText", label: "Set text", params: "{text}", enabled: true },
  ];
  var doc = { name: "document.fakecraft", ops: 0, revision: 0 };
  var note = document.getElementById("note");
  var statusEl = document.getElementById("status");
  var dialog = document.getElementById("dialog");
  var dialogOpen = false;

  function setStatus(t) {
    statusEl.textContent = t;
  }
  function touch() {
    doc.revision += 1;
  }
  function digest() {
    return doc.revision + ":" + doc.ops + ":" + note.value;
  }
  function bytes() {
    return new TextEncoder().encode(JSON.stringify({ text: note.value, ops: doc.ops, revision: doc.revision }));
  }

  // The shim delivers the opened file as a synthetic drop; take its name (the save keeps it) and text.
  window.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    doc.name = f.name;
    f.text()
      .then(function (t) {
        try {
          var j = JSON.parse(t);
          if (j && typeof j.text === "string") note.value = j.text;
        } catch (_e) {
          note.value = t.slice(0, 200);
        }
        setStatus("opened " + f.name);
      })
      .catch(function () {});
  });
  note.addEventListener("input", function () {
    touch();
  });

  function saveOwn() {
    return window
      .showSaveFilePicker({ suggestedName: doc.name })
      .then(function (h) {
        return h.createWritable();
      })
      .then(function (w) {
        return w.write(bytes()).then(function () {
          return w.close();
        });
      })
      .then(function () {
        setStatus("saved");
        return { saved: true };
      });
  }

  function exportPdf() {
    var a = document.createElement("a");
    a.download = "export.pdf";
    a.href = URL.createObjectURL(new Blob([bytes()], { type: "application/pdf" }));
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { exported: true };
  }

  function openDialog() {
    dialogOpen = true;
    dialog.className = "open";
    return { pending: "saveDialog" };
  }
  function closeDialog() {
    dialogOpen = false;
    dialog.className = "";
  }
  document.getElementById("dialog-ok").addEventListener("click", function () {
    closeDialog();
    saveOwn().catch(function () {});
  });
  document.getElementById("dialog-cancel").addEventListener("click", closeDialog);
  document.getElementById("export").addEventListener("click", exportPdf);

  function execute(p) {
    var c = p && p.command;
    var a = (p && p.params) || {};
    switch (c) {
      case "ping":
        return { pong: true };
      case "echo":
        doc.ops += 1;
        touch();
        return a;
      case "sleep":
        doc.ops += 1;
        touch();
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve({ slept: a.ms });
          }, Number(a.ms) || 0);
        });
      case "oversize":
        return "x".repeat(Number(a.bytes) || 300 * 1024);
      case "malformed": {
        var cyc = {};
        cyc.self = cyc;
        return cyc;
      }
      case "save":
        // Like the real apps, answer at once: the save settles only when the HOST answers, which can wait on a dialog.
        doc.ops += 1;
        touch();
        saveOwn().catch(function () {});
        return { saving: true };
      case "export":
        return exportPdf();
      case "saveDialog":
        return openDialog();
      case "setText":
        note.value = String(a.text === undefined ? "" : a.text);
        touch();
        return { text: note.value };
      default:
        return Promise.reject(new Error("unknown command " + c));
    }
  }

  function screenshot() {
    var canvas = document.getElementById("stage");
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(10, 10, 120, 80);
    var url = canvas.toDataURL("image/png");
    return { width: canvas.width, height: canvas.height, pngBase64: url.slice(url.indexOf(",") + 1) };
  }

  window.fakecraft = {
    request: function (method, params) {
      return Promise.resolve().then(function () {
        switch (method) {
          case "engine.execute":
            return execute(params);
          case "engine.commands":
            return COMMANDS;
          case "document.inspect":
            return { digest: digest(), text: note.value, ops: doc.ops, revision: doc.revision, name: doc.name };
          case "ui.inspect":
            return { tool: "fake", dialog: dialogOpen, focused: document.activeElement && document.activeElement.id };
          case "ui.screenshot":
            return params && params.data ? screenshot() : { width: 320, height: 200 };
          default:
            throw new Error("unknown method " + method);
        }
      });
    },
  };
})();
