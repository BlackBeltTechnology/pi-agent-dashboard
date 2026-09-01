// Shared chrome for the mockup set: surface nav + theme toggle.
// Theme switching flips [data-theme] on <html>, exactly as the real client does.
(function () {
  var SURFACES = [
    ["index.html", "Overview"],
    ["a-quarantine.html", "A · Quarantine"],
    ["b-session-card.html", "B · Session card"],
    ["c-config.html", "C · Configuration"],
    ["d-remote-list.html", "D · Remote list"],
    ["e-preflight.html", "E · Preflight"],
    ["f-claim.html", "F · Claim"],
    ["g-backfill.html", "G · Backfill"],
  ];

  var here = location.pathname.split("/").pop() || "index.html";
  var qs = new URLSearchParams(location.search).get("theme");
  var saved = qs || localStorage.getItem("mockup-theme");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");

  document.addEventListener("DOMContentLoaded", function () {
    var host = document.querySelector("[data-chrome]");
    if (!host) return;
    var title = host.getAttribute("data-title") || "";
    var sub = host.getAttribute("data-sub") || "";

    var bar = document.createElement("div");
    bar.className = "topbar";
    bar.innerHTML =
      '<div><h1>' + title + '</h1><div class="sub">' + sub + "</div></div>" +
      '<div class="spacer"></div>' +
      '<button class="btn btn-sm" id="themeBtn" type="button" aria-live="polite"></button>';
    host.appendChild(bar);

    var nav = document.createElement("nav");
    nav.className = "surfnav";
    nav.setAttribute("aria-label", "Mockup surfaces");
    nav.innerHTML = SURFACES.map(function (s) {
      var cur = s[0] === here ? ' aria-current="page"' : "";
      return '<a href="' + s[0] + '"' + cur + ">" + s[1] + "</a>";
    }).join("");
    host.appendChild(nav);

    var btn = document.getElementById("themeBtn");
    function label() {
      var light = document.documentElement.getAttribute("data-theme") === "light";
      btn.textContent = light ? "◑ Light" : "◐ Dark";
      btn.setAttribute("aria-label", "Theme: " + (light ? "light" : "dark") + ". Activate to switch.");
    }
    btn.addEventListener("click", function () {
      var light = document.documentElement.getAttribute("data-theme") === "light";
      if (light) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("mockup-theme", "dark");
      } else {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("mockup-theme", "light");
      }
      label();
    });
    label();
  });
})();
