/*
 * craft-worker.js — worker trampoline for sandboxed (opaque-origin) craft web builds.
 * See change: extend-craft-web-to-all-apps (design D5).
 *
 * Plain ES2020 classic script, no imports, no build. Post-install copies it as `craft-worker-<hash>.js`
 * and loads it FIRST (before the profile and the shim) for profiles with `workerTrampoline: true`.
 *
 * `new Worker(httpUrl)` fails from origin `null` (same-origin rule, not CSP). The wrapper replaces an
 * http(s) URL by a `blob:` bootstrap whose whole body is ONE `import <abs>;` (module) or
 * `importScripts(<abs>);` (classic) of the JSON-escaped absolute URL. A worker created from a `blob:`
 * URL inherits the frame's CSP (CSP3), so `script-src` still limits the import to the mount base and
 * `connect-src` is unchanged: no new origin, credential or storage reach. `blob:`/`data:` URLs pass
 * through untouched. `SharedWorker` is not wrapped.
 *
 * Module use (tests): `module.exports = { bootstrapSource, installWorkerTrampoline }`.
 */
(function () {
  "use strict";

  /** Body of the bootstrap worker for absolute URL `abs`. */
  function bootstrapSource(abs, type) {
    var lit = JSON.stringify(String(abs));
    return type === "module" ? "import " + lit + ";" : "importScripts(" + lit + ");";
  }

  /** Wrap `win.Worker`; returns an uninstall function. */
  function installWorkerTrampoline(win) {
    var Orig = win.Worker;
    if (typeof Orig !== "function") return function () {};
    function Trampoline(url, options) {
      var raw = url && typeof url === "object" && typeof url.href === "string" ? url.href : String(url);
      var abs = raw;
      try {
        abs = new win.URL(raw, (win.document && win.document.baseURI) || win.location.href).href;
      } catch (_e) {
        /* leave as given: the native constructor reports the error */
      }
      if (!/^https?:/i.test(abs)) return new Orig(url, options);
      var type = options && options.type === "module" ? "module" : "classic";
      var blob = new win.Blob([bootstrapSource(abs, type)], { type: "text/javascript" });
      return new Orig(win.URL.createObjectURL(blob), options);
    }
    Trampoline.prototype = Orig.prototype;
    win.Worker = Trampoline;
    return function () {
      win.Worker = Orig;
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { bootstrapSource: bootstrapSource, installWorkerTrampoline: installWorkerTrampoline };
  } else if (typeof window !== "undefined") {
    installWorkerTrampoline(window);
  }
})();
