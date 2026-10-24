/*
 * craft-shim.js — iframe-side half of the CraftFrameHost protocol.
 * See change: edit-office-in-pane-with-craft-web (design D4).
 *
 * Plain ES2020, no imports, no build step. The plugin server copies this file
 * verbatim into a Trunk/eframe web build (as `craft-shim-<hash>.js`) and loads it
 * as a classic <script src> BEFORE the app module. The server reads the literal
 * `const SHIM_VERSION = <n>;` below (own line, column 0) — keep that shape, and
 * bump it on every behavioural change so installed trees report `shim-outdated`.
 *
 * Shim -> host (window.parent.postMessage(msg, "*", transfer)):
 *   ready{nonce} opened{nonce,title,confirmed} save{nonce,suggestedName,mime,bytes}
 *   dirty{nonce,value} blocked{nonce,what} csp{nonce,directive}
 *   navigate-blocked{nonce,url} start-failed{nonce,detail}
 *   control-result{nonce,id,ok,result?,error?,code?}   (v3; `code`: "not-ready" | "unsupported")
 * `ready` (v3) also carries `shimVersion` and `control` (profile has a control entry); `save` (v3)
 * carries `msSinceInput` (ms since the last trusted user input in the frame).
 * Host -> shim (accepted only from window.parent with the matching nonce):
 *   open{nonce,name,bytes}  save-result{nonce,ok,error?,own?}   (save-result carries no
 *   id, so results settle pending saves in FIFO order; `own` = an acknowledged
 *   overwrite of the tab's own file.)
 *
 * v3 (change add-craft-live-control, D3): `control{nonce,id,method,params}` (host -> shim) is relayed to the
 * app's page API named by `profile.control` (`page-api`: `window[global].request(method, params)`;
 * `page-command`: only `engine.execute{command,params?}` as `window[global].command(command, JSON text)`).
 * The shim is a relay: policy (allowlists, caps, busy, timeouts) lives on the host and the server.
 *
 * v2 (change extend-craft-web-to-all-apps, D4): reads the app's adapter profile from
 * `window.__CRAFT_PROFILE__` (post-install loads it first): profile title regex;
 * an opened fallback for apps without a title signal (`opened{confirmed:false}`);
 * `start-failed` on a wasm trap / Rust panic before opened; clean after an
 * acknowledged own save for `cleanOnAckedSave` profiles. Without a profile the
 * v1 WordCraft-style title rule applies.
 *
 * `blocked.what` values: "file-input" | "showOpenFilePicker" |
 *   "showDirectoryPicker" | "drop-files" | "paste-files".
 *
 * Module use (tests): `module.exports = { SHIM_VERSION, parseTitle, createShim }`.
 * `createShim(win, doc, opts)` returns `{ start(), dispose() }`; `opts.isTrusted`
 * (event -> boolean, default `event.isTrusted === true`) and `opts.profile`
 * (default `win.__CRAFT_PROFILE__`) are test seams only.
 */
const SHIM_VERSION = 3;

(function () {
  "use strict";

  var RTC_GLOBALS = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCRtpSender"];
  var MODIFIER_KEYS = { Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1, OS: 1 };
  var DROP_FALLBACK_MS = 3000;
  var DROP_SETTLE_MS = 250;
  var MIME_BY_EXT = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
  };
  var TITLE_RE = /Unhandled egui viewport command: Title\("((?:[^"\\]|\\.)*)"\)/;
  /** v1 rule (no profile): `<name>[ •] - <App>Craft`, dash, en dash or em dash. */
  var LEGACY_TITLE = { pattern: "^(.*?)(?: \u2022)? [-\u2013\u2014] [A-Za-z0-9]*Craft$", dirtyMarker: "\u2022" };
  var PANIC_RE = /panicked at/;
  /** Longest wait for the app's page-API global to appear after `opened` (then `unsupported`). */
  var CONTROL_GLOBAL_WAIT_MS = 2000;
  var CONTROL_GLOBAL_POLL_MS = 100;
  /** `msSinceInput` of a save when the user never touched the frame. */
  var NO_INPUT_MS = 1e9;

  function stripExt(s) {
    return s.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  }

  function normStem(s) {
    return String(s).normalize("NFC").toLowerCase();
  }

  /** Raw title of a console.warn payload (string or args array), or null when it is not an egui Title command. */
  function titleText(input) {
    var text = Array.isArray(input)
      ? input
          .map(function (a) {
            return typeof a === "string" ? a : "";
          })
          .join(" ")
      : String(input);
    var m = TITLE_RE.exec(text);
    return m ? m[1].replace(/\\(["\\])/g, "$1") : null;
  }

  /**
   * Parse a raw title with a profile title spec `{pattern, dirtyMarker?}` (default: the v1 rule) into
   * `{ raw, name, clean }`, or null when the pattern does not match. `name` = capture 1 with the dirty
   * marker stripped; `clean` = the marker is absent from the whole title.
   */
  function parseRawTitle(raw, spec) {
    spec = spec || LEGACY_TITLE;
    var m;
    try {
      m = new RegExp(spec.pattern).exec(raw);
    } catch (_e) {
      return null;
    }
    if (!m) return null;
    var marker = spec.dirtyMarker || "";
    var name = String(m[1] === undefined ? raw : m[1]);
    if (marker) name = name.split(marker).join("");
    name = name.replace(/\s+/g, " ").trim();
    return { raw: raw, name: name, clean: !marker || raw.indexOf(marker) === -1 };
  }

  /** console.warn payload → `{ raw, name, clean }` (see parseRawTitle), or null. */
  function parseTitle(input, spec) {
    var raw = titleText(input);
    return raw === null ? null : parseRawTitle(raw, spec);
  }

  function createShim(win, doc, opts) {
    opts = opts || {};
    var isTrusted =
      opts.isTrusted ||
      function (e) {
        return e && e.isTrusted === true;
      };
    var cleanups = [];
    var profile = opts.profile !== undefined ? opts.profile : win.__CRAFT_PROFILE__ || null;
    /** Title spec: the profile's, none (profile without title), or the v1 rule (no profile). */
    var titleSpec = profile ? profile.title || null : LEGACY_TITLE;
    var fallbackMs = profile && !profile.title && typeof profile.openedFallbackMs === "number" ? profile.openedFallbackMs : null;
    var cleanOnAck = profile?.cleanOnAckedSave === true;
    var nonceMatch = /[#&]n=([^&]*)/.exec((win.location && win.location.hash) || "");
    var nonce = nonceMatch ? decodeURIComponent(nonceMatch[1]) : null;

    // ---- state -------------------------------------------------------------
    var awaitingName = null; // normalized open-name stem(s) once `open` was handled
    var openHandled = false;
    var appTicked = false;
    var deliverDrop = null;
    var opened = false;
    var prevTitle = null;
    var titleClean = true;
    var inputAfterTitle = false;
    var pointerPending = false;
    var lastDirty = null;
    var ownDrop = false;
    var pendingSaves = [];
    var readySent = false;
    var openName = null; // delivered file name
    var startFailed = false;
    var leaving = false;
    var lastInputAt = null; // Date.now() of the last trusted user input (control: msSinceInput)
    var control = profile && profile.control ? profile.control : null;

    function post(type, fields, transfer) {
      if (nonce === null) return;
      var msg = { type: type, nonce: nonce };
      for (var k in fields) msg[k] = fields[k];
      var parent = win.parent;
      if (!parent) return;
      parent.postMessage(msg, "*", transfer || []);
    }

    function listen(target, type, fn, capture) {
      target.addEventListener(type, fn, capture === undefined ? true : capture);
      cleanups.push(function () {
        target.removeEventListener(type, fn, capture === undefined ? true : capture);
      });
    }

    function patch(obj, key, value) {
      var had = Object.prototype.hasOwnProperty.call(obj, key);
      var prev = obj[key];
      obj[key] = value;
      cleanups.push(function () {
        if (had) obj[key] = prev;
        else delete obj[key];
      });
    }

    // ---- WebRTC removal (E23) ------------------------------------------------
    function removeWebRtc() {
      RTC_GLOBALS.forEach(function (name) {
        try {
          delete win[name];
        } catch (_e) {
          /* non-configurable: fall through */
        }
        if (win[name] !== undefined) {
          try {
            Object.defineProperty(win, name, { value: undefined, configurable: true, writable: true });
          } catch (_e) {
            /* nothing more can be done */
          }
        }
      });
    }

    // ---- bytes helpers -------------------------------------------------------
    function blobBytes(blob) {
      if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then(toU8);
      return new Promise(function (resolve, reject) {
        var r = new win.FileReader();
        r.onload = function () {
          resolve(new Uint8Array(r.result));
        };
        r.onerror = function () {
          reject(r.error);
        };
        r.readAsArrayBuffer(blob);
      });
    }

    function toU8(data) {
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return new Uint8Array(data);
    }

    function chunkBytes(data) {
      if (typeof data === "string") return Promise.resolve(new TextEncoder().encode(data));
      if (data && typeof data === "object" && (typeof data.arrayBuffer === "function" || typeof data.size === "number" && typeof data.slice === "function"))
        return blobBytes(data);
      return Promise.resolve(toU8(data));
    }

    // ---- ready (ordering: TrunkApplicationStarted -> canvas -> one frame) ----
    function raf(cb) {
      return (win.requestAnimationFrame || function (f) {
        return win.setTimeout(f, 16);
      }).call(win, cb);
    }

    function getCanvas() {
      return doc.querySelector("canvas");
    }

    function onStarted() {
      if (readySent) return;
      (function waitCanvas() {
        if (readySent) return;
        if (!getCanvas()) {
          raf(waitCanvas);
          return;
        }
        raf(function () {
          if (readySent) return;
          readySent = true;
          post("ready", { shimVersion: SHIM_VERSION, control: control !== null });
        });
      })();
    }

    // ---- open: synthetic drop ---------------------------------------------------
    function handleOpen(msg) {
      if (openHandled) return;
      var name = typeof msg.name === "string" ? msg.name : "";
      if (!name || !msg.bytes) return;
      openHandled = true;
      openName = name;
      var stem = normStem(stripExt(name));
      awaitingName = { full: normStem(name), stem: stem };
      var file = new win.File([toU8(msg.bytes)], name, {
        type: MIME_BY_EXT[(/\.([A-Za-z0-9]+)$/.exec(name) || [])[1]] || "application/octet-stream",
      });
      var dt;
      try {
        dt = new win.DataTransfer();
        dt.items.add(file);
      } catch (_e) {
        dt = null;
      }
      if (!dt) dt = { files: [file], items: [{ kind: "file", type: file.type, getAsFile: function () { return file; } }], types: ["Files"] };
      deliverDrop = function () {
        var canvas = getCanvas();
        var target = canvas || win;
        var rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        var x = rect ? rect.left + rect.width / 2 : 0;
        var y = rect ? rect.top + rect.height / 2 : 0;
        ownDrop = true;
        try {
          ["dragenter", "dragover", "drop"].forEach(function (type) {
            var Ctor = win.DragEvent || win.MouseEvent || win.Event;
            var ev;
            try {
              ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
            } catch (_e) {
              ev = new win.Event(type, { bubbles: true, cancelable: true });
            }
            if (!ev.dataTransfer) {
              try {
                Object.defineProperty(ev, "dataTransfer", { value: dt });
              } catch (_e) {
                /* ignore */
              }
            }
            target.dispatchEvent(ev);
          });
        } finally {
          ownDrop = false;
        }
        if (fallbackMs !== null) win.setTimeout(openedFallback, fallbackMs);
      };
      // The app drops files that arrive before its first update tick (measured with WordCraft 0.8.0:
      // a drop right after `ready` is ignored). Its first viewport-title signal proves the loop runs;
      // deliver after that, or after DROP_FALLBACK_MS when no such signal ever comes.
      if (appTicked) scheduleDrop();
      else win.setTimeout(scheduleDrop, DROP_FALLBACK_MS);
    }

    function scheduleDrop() {
      var deliver = deliverDrop;
      if (!deliver) return;
      deliverDrop = null;
      raf(function () {
        raf(function () {
          win.setTimeout(deliver, DROP_SETTLE_MS);
        });
      });
    }

    // ---- opened fallback (apps without a title signal, D4) --------------------------
    function openedFallback() {
      if (opened || startFailed || leaving) return;
      var canvas = getCanvas();
      if (!canvas || (typeof doc.documentElement?.contains === "function" && !doc.documentElement.contains(canvas))) return;
      opened = true;
      titleClean = true;
      inputAfterTitle = false;
      post("opened", { title: openName, confirmed: false });
      reportDirty(); // an unmodified, just-opened document counts as saved until input
    }

    // ---- start failure (wasm trap / Rust panic before opened) -------------------------
    function failStart(detail) {
      if (opened || startFailed || leaving) return;
      startFailed = true;
      post("start-failed", { detail: String(detail || "").slice(0, 200) });
    }

    /** `WebAssembly.RuntimeError` (any realm, by name) or a message naming a trap / panic. */
    function isTrap(err) {
      if (!err) return false;
      if (err.name === "RuntimeError") return true;
      var msg = String(err.message || err);
      return /\bunreachable\b/.test(msg) || PANIC_RE.test(msg);
    }

    function installStartFailure() {
      listen(
        win,
        "error",
        function (e) {
          var err = e && (e.error || e.message);
          if (isTrap(err)) failStart(err?.message || err);
        },
        false,
      );
      listen(
        win,
        "unhandledrejection",
        function (e) {
          if (isTrap(e?.reason)) failStart(e.reason?.message || e.reason);
        },
        false,
      );
      listen(
        win,
        "pagehide",
        function () {
          leaving = true;
        },
        false,
      );
      var c = win.console;
      if (!c) return;
      var orig = c.error;
      patch(c, "error", function () {
        try {
          var text = Array.prototype.map
            .call(arguments, function (a) {
              return typeof a === "string" ? a : a?.message || "";
            })
            .join(" ");
          if (PANIC_RE.test(text)) failStart(text);
        } catch (_e) {
          /* never break the app's logging */
        }
        return orig.apply(this, arguments);
      });
    }

    // ---- title / dirty ------------------------------------------------------------
    function reportDirty() {
      var value = !(titleClean && !inputAfterTitle);
      if (value === lastDirty) return;
      lastDirty = value;
      post("dirty", { value: value });
    }

    function namesDocument(t) {
      if (!awaitingName) return false;
      var n = normStem(t.name);
      return n === awaitingName.stem || n === awaitingName.full || normStem(stripExt(t.name)) === awaitingName.stem;
    }

    function onTitleText(raw) {
      if (!appTicked) {
        appTicked = true;
        scheduleDrop();
      }
      if (!titleSpec) return; // the app reports no document title (opened via the fallback)
      var t = parseRawTitle(raw, titleSpec);
      if (t) onTitle(t);
    }

    function onTitle(t) {
      if (!opened) {
        if (startFailed || !namesDocument(t)) return;
        opened = true;
        prevTitle = t;
        titleClean = t.clean;
        inputAfterTitle = false;
        pointerPending = false;
        post("opened", { title: t.name, confirmed: true });
        reportDirty();
        return;
      }
      if (!prevTitle) {
        prevTitle = t;
        return;
      }
      if (t.raw === prevTitle.raw) return;
      var nameChanged = t.name !== prevTitle.name;
      prevTitle = t;
      titleClean = t.clean;
      inputAfterTitle = pointerPending && nameChanged; // a click changed more than the marker
      pointerPending = false;
      reportDirty();
    }

    function markInput() {
      lastInputAt = Date.now();
      for (var i = 0; i < pendingSaves.length; i++) pendingSaves[i].inputAfter = true;
      if (!opened) return;
      inputAfterTitle = true;
      reportDirty();
    }

    /** `cleanOnAckedSave`: an acknowledged own-file save with no input since the request is clean. */
    function onAckedOwnSave(entry) {
      if (!cleanOnAck || !opened || entry.inputAfter) return;
      titleClean = true;
      inputAfterTitle = false;
      pointerPending = false;
      reportDirty();
    }

    function wrapConsoleWarn() {
      var c = win.console;
      if (!c) return;
      var orig = c.warn;
      patch(c, "warn", function () {
        try {
          var raw = titleText(Array.prototype.slice.call(arguments));
          if (raw !== null) onTitleText(raw);
        } catch (_e) {
          /* never break the app's logging */
        }
        return orig.apply(this, arguments);
      });
    }

    // ---- saves ---------------------------------------------------------------
    function mimeFor(name, hinted) {
      if (hinted) return hinted;
      return MIME_BY_EXT[(/\.([A-Za-z0-9]+)$/.exec(name) || [])[1] || ""] || "application/octet-stream";
    }

    function abortError(message) {
      return new win.DOMException(message || "The user aborted a request.", "AbortError");
    }

    function postSave(name, mime, buffer) {
      return new Promise(function (resolve, reject) {
        pendingSaves.push({ resolve: resolve, reject: reject, inputAfter: false });
        var msSinceInput = lastInputAt === null ? NO_INPUT_MS : Math.max(0, Date.now() - lastInputAt);
        post("save", { suggestedName: name, mime: mime, bytes: buffer, msSinceInput: msSinceInput }, [buffer]);
      });
    }

    function createWritable(name, mime) {
      var buf = new Uint8Array(0);
      var size = 0;
      var pos = 0;
      var closed = false;
      var chain = Promise.resolve();

      function ensure(n) {
        if (n <= buf.length) return;
        var next = new Uint8Array(Math.max(n, buf.length * 2));
        next.set(buf.subarray(0, size));
        buf = next;
      }

      function apply(chunk) {
        if (chunk && typeof chunk === "object" && typeof chunk.type === "string" && !("size" in chunk && typeof chunk.slice === "function")) {
          if (chunk.type === "seek") {
            pos = chunk.position;
            return Promise.resolve();
          }
          if (chunk.type === "truncate") {
            truncate(chunk.size);
            return Promise.resolve();
          }
          if (chunk.type === "write") {
            if (typeof chunk.position === "number") pos = chunk.position;
            return chunkBytes(chunk.data).then(put);
          }
        }
        return chunkBytes(chunk).then(put);
      }

      function put(bytes) {
        ensure(pos + bytes.length);
        buf.set(bytes, pos);
        pos += bytes.length;
        if (pos > size) size = pos;
      }

      function truncate(n) {
        ensure(n);
        if (n > size) buf.fill(0, size, n);
        size = n;
        if (pos > n) pos = n;
      }

      function queue(fn) {
        var p = chain.then(fn);
        chain = p.catch(function () {});
        return p;
      }

      return {
        write: function (chunk) {
          if (closed) return Promise.reject(new TypeError("stream closed"));
          return queue(function () {
            return apply(chunk);
          });
        },
        seek: function (p) {
          return queue(function () {
            pos = p;
          });
        },
        truncate: function (n) {
          return queue(function () {
            truncate(n);
          });
        },
        abort: function () {
          closed = true;
          buf = new Uint8Array(0);
          size = 0;
          return Promise.resolve();
        },
        close: function () {
          if (closed) return Promise.reject(new TypeError("stream closed"));
          return queue(function () {
            closed = true;
            var out = new ArrayBuffer(size);
            new Uint8Array(out).set(buf.subarray(0, size));
            return postSave(name, mime, out);
          });
        },
      };
    }

    function installSavePicker() {
      patch(win, "showSaveFilePicker", function (options) {
        var name = (options && options.suggestedName) || "untitled";
        var hinted = null;
        var types = options && options.types;
        if (types && types[0] && types[0].accept) hinted = Object.keys(types[0].accept)[0] || null;
        var mime = mimeFor(name, hinted);
        return Promise.resolve({
          kind: "file",
          name: name,
          createWritable: function () {
            return Promise.resolve(createWritable(name, mime));
          },
          queryPermission: function () {
            return Promise.resolve("granted");
          },
          requestPermission: function () {
            return Promise.resolve("granted");
          },
        });
      });
    }

    function dataUrlBytes(href) {
      var comma = href.indexOf(",");
      var meta = href.slice(5, comma);
      var payload = href.slice(comma + 1);
      var mime = meta.split(";")[0] || "application/octet-stream";
      var bin = /;base64$/i.test(meta) ? win.atob(payload) : decodeURIComponent(payload);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
      return { mime: mime, buffer: out.buffer };
    }

    var nativeFetch = win.fetch ? win.fetch.bind(win) : null;

    function isDownloadAnchor(a) {
      return !!a && a.nodeName === "A" && a.hasAttribute("download") && !!a.getAttribute("href");
    }

    function interceptAnchor(a) {
      var href = a.href;
      var name = a.getAttribute("download") || "download";
      if (/^data:/i.test(href)) {
        // data: is not in connect-src; decode locally
        var d = dataUrlBytes(href);
        postSave(name, d.mime, d.buffer).catch(function () {});
        return;
      }
      if (!nativeFetch) return;
      // fetch() is issued synchronously, in the click handler: a blob URL is resolved
      // at call time, so a revokeObjectURL right after the click cannot lose the bytes.
      var res = nativeFetch(href);
      res
        .then(function (r) {
          return r.arrayBuffer().then(function (buffer) {
            var type = r.headers && r.headers.get && r.headers.get("content-type");
            return postSave(name, mimeFor(name, type), buffer);
          });
        })
        .catch(function () {});
    }

    // A link that would replace the frame's document. The Navigation API cannot be relied on for this: an
    // opaque-origin sandboxed frame never gets a `navigate` event (measured, Chromium), so links are
    // stopped where they start. `location.href = …` cannot be intercepted; that residual is documented.
    function isNavigatingAnchor(a) {
      if (!a || a.nodeName !== "A" || a.hasAttribute("download")) return false;
      var raw = a.getAttribute("href");
      if (!raw || raw.charAt(0) === "#") return false;
      var target = String(a.target || "").toLowerCase();
      if (target && target !== "_self") return false; // sandbox without allow-popups already blocks it
      var href = String(a.href || "");
      return !/^(blob:|data:|javascript:)/i.test(href) && href.split("#")[0] !== String(doc.URL || "").split("#")[0];
    }

    function blockNavigation(url) {
      post("navigate-blocked", { url: String(url || "") });
    }

    function installAnchorInterception() {
      listen(doc, "click", function (e) {
        var a = e.target && e.target.closest ? e.target.closest("a") : null;
        if (isDownloadAnchor(a)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          interceptAnchor(a);
        } else if (isNavigatingAnchor(a)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          blockNavigation(a.href);
        }
      });
      var proto = win.HTMLAnchorElement.prototype;
      var origClick = proto.click;
      patch(proto, "click", function () {
        if (isDownloadAnchor(this)) {
          interceptAnchor(this);
          return;
        }
        if (isNavigatingAnchor(this)) {
          blockNavigation(this.href);
          return;
        }
        return origClick.apply(this, arguments);
      });
      patch(win, "open", function (url) {
        blockNavigation(url);
        return null;
      });
    }

    // ---- blocked opens ---------------------------------------------------------------
    function refuse(e, what) {
      if (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      post("blocked", { what: what });
    }

    function isFileInput(el) {
      return !!el && el.nodeName === "INPUT" && String(el.type).toLowerCase() === "file";
    }

    function hasFiles(dt) {
      if (!dt) return false;
      if (dt.files && dt.files.length > 0) return true;
      if (dt.types && Array.prototype.indexOf.call(dt.types, "Files") !== -1) return true;
      if (dt.items) {
        for (var i = 0; i < dt.items.length; i++) if (dt.items[i].kind === "file") return true;
      }
      return false;
    }

    function installOpenBlocking() {
      listen(doc, "click", function (e) {
        if (isFileInput(e.target)) refuse(e, "file-input");
      });
      var inputProto = win.HTMLInputElement.prototype;
      var origInputClick = inputProto.click;
      patch(inputProto, "click", function () {
        if (isFileInput(this)) {
          post("blocked", { what: "file-input" });
          return;
        }
        return origInputClick.apply(this, arguments);
      });
      if (typeof inputProto.showPicker === "function") {
        var origShow = inputProto.showPicker;
        patch(inputProto, "showPicker", function () {
          if (isFileInput(this)) {
            post("blocked", { what: "file-input" });
            return;
          }
          return origShow.apply(this, arguments);
        });
      }
      patch(win, "showOpenFilePicker", function () {
        post("blocked", { what: "showOpenFilePicker" });
        return Promise.reject(abortError());
      });
      patch(win, "showDirectoryPicker", function () {
        post("blocked", { what: "showDirectoryPicker" });
        return Promise.reject(abortError());
      });
      listen(win, "drop", function (e) {
        if (ownDrop || !isTrusted(e)) return;
        if (hasFiles(e.dataTransfer)) refuse(e, "drop-files");
        else markInput();
      });
      listen(win, "paste", function (e) {
        if (!isTrusted(e)) return;
        if (hasFiles(e.clipboardData)) refuse(e, "paste-files");
        else markInput();
      });
    }

    // ---- input tracking ---------------------------------------------------------------
    function isSaveChord(e) {
      return (e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "s";
    }

    function installInputTracking() {
      listen(win, "keydown", function (e) {
        if (isSaveChord(e)) {
          e.preventDefault(); // the app saves through the stubbed picker; no browser dialog
          return;
        }
        if (!isTrusted(e) || MODIFIER_KEYS[e.key]) return;
        markInput();
      });
      listen(win, "cut", function (e) {
        if (isTrusted(e)) markInput();
      });
      listen(win, "pointerdown", function (e) {
        if (!isTrusted(e)) return;
        pointerPending = true;
        lastInputAt = Date.now();
      });
    }

    // ---- csp / navigation -----------------------------------------------------------
    function installCspAndNavigation() {
      listen(
        doc,
        "securitypolicyviolation",
        function (e) {
          post("csp", { directive: e.effectiveDirective || e.violatedDirective || "" });
        },
        false,
      );
      var nav = win.navigation;
      if (nav && typeof nav.addEventListener === "function") {
        listen(
          nav,
          "navigate",
          function (e) {
            var sameDoc = e.destination && e.destination.sameDocument;
            if (!e.cancelable || sameDoc || e.hashChange || e.downloadRequest != null) return;
            e.preventDefault();
            post("navigate-blocked", { url: e.destination ? String(e.destination.url) : "" });
          },
          false,
        );
      }
    }

    // ---- control relay (v3) -----------------------------------------------------------
    function controlReply(id, fields) {
      var msg = { id: id };
      for (var k in fields) msg[k] = fields[k];
      try {
        post("control-result", msg);
      } catch (_e) {
        // the page API resolved with something structured clone refuses (function, symbol…)
        post("control-result", { id: id, ok: false, error: "the app's reply is not serializable" });
      }
    }

    function errText(err) {
      var m = err && typeof err === "object" && "message" in err ? err.message : err;
      return typeof m === "string" ? m : JSON.stringify(m === undefined ? null : m) || "error";
    }

    /** Call `fn` with the app global once it exists (≤ CONTROL_GLOBAL_WAIT_MS), else `onMissing`. */
    function withGlobal(name, fnName, fn, onMissing) {
      var waited = 0;
      (function poll() {
        var g = win[name];
        if (g && typeof g[fnName] === "function") return fn(g);
        if (waited >= CONTROL_GLOBAL_WAIT_MS) return onMissing();
        waited += CONTROL_GLOBAL_POLL_MS;
        win.setTimeout(poll, CONTROL_GLOBAL_POLL_MS);
      })();
    }

    /** Settle a page-API promise into `control-result` (`parse`: the app answered JSON text). */
    function settleControl(id, p, parse) {
      p.then(
        function (value) {
          if (!parse) return controlReply(id, { ok: true, result: value });
          try {
            controlReply(id, { ok: true, result: JSON.parse(value) });
          } catch (_e) {
            controlReply(id, { ok: false, error: "the app's reply is not JSON" });
          }
        },
        function (err) {
          controlReply(id, { ok: false, error: errText(err) });
        },
      );
    }

    function controlMissing(id) {
      controlReply(id, { ok: false, code: "unsupported", error: "the app's page API is not available" });
    }

    /** `page-command` apps: only `engine.execute{command, params?}` as `window[global].command(command, JSON text)`. */
    function relayPageCommand(id, method, p) {
      if (method !== "engine.execute" || !p || typeof p !== "object" || typeof p.command !== "string")
        return controlReply(id, { ok: false, code: "unsupported", error: method + " is not available on a page-command app" });
      withGlobal(
        control.global,
        "command",
        function (g) {
          var text;
          try {
            text = JSON.stringify(p.params === undefined ? {} : p.params);
          } catch (_e) {
            return controlReply(id, { ok: false, error: "params are not serializable" });
          }
          try {
            settleControl(id, Promise.resolve(g.command(p.command, text)), true);
          } catch (err) {
            controlReply(id, { ok: false, error: errText(err) });
          }
        },
        function () {
          controlMissing(id);
        },
      );
    }

    /** `page-api` apps: `window[global].request(method, params)`. */
    function relayPageApi(id, method, params) {
      withGlobal(
        control.global,
        "request",
        function (g) {
          try {
            settleControl(id, Promise.resolve(g.request(method, params)), false);
          } catch (err) {
            controlReply(id, { ok: false, error: errText(err) });
          }
        },
        function () {
          controlMissing(id);
        },
      );
    }

    function handleControl(msg) {
      var id = msg.id;
      if (!control) return controlReply(id, { ok: false, code: "unsupported", error: "this app has no live control" });
      if (!opened) return controlReply(id, { ok: false, code: "not-ready", error: "the document is not open yet" });
      var method = typeof msg.method === "string" ? msg.method : "";
      if (control.kind === "page-command") return relayPageCommand(id, method, msg.params);
      relayPageApi(id, method, msg.params);
    }

    // ---- host messages -----------------------------------------------------------------
    function onMessage(e) {
      if (e.source !== win.parent) return;
      var d = e.data;
      if (!d || typeof d !== "object" || nonce === null || d.nonce !== nonce) return;
      if (d.type === "open") handleOpen(d);
      else if (d.type === "control") handleControl(d);
      else if (d.type === "save-result") {
        var p = pendingSaves.shift();
        if (!p) return;
        if (d.ok) {
          if (d.own === true) onAckedOwnSave(p);
          p.resolve();
        } else p.reject(abortError(d.error));
      }
    }

    function start() {
      win.__CRAFT_SHIM_VERSION__ = SHIM_VERSION;
      removeWebRtc();
      installStartFailure();
      wrapConsoleWarn();
      installSavePicker();
      installAnchorInterception();
      installOpenBlocking();
      installInputTracking();
      installCspAndNavigation();
      listen(win, "message", onMessage, false);
      listen(win, "TrunkApplicationStarted", onStarted, false);
    }

    function dispose() {
      while (cleanups.length) cleanups.pop()();
    }

    return { start: start, dispose: dispose };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SHIM_VERSION: SHIM_VERSION, parseTitle: parseTitle, createShim: createShim };
  } else if (typeof window !== "undefined") {
    createShim(window, document).start();
  }
})();
