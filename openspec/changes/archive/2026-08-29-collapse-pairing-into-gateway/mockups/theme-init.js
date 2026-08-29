// Lets score_mockup capture the light theme via ?theme=light without a click.
(function () {
  const p = new URLSearchParams(location.search);
  if (p.get("theme") === "light") document.documentElement.dataset.theme = "light";
  window.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const el = document.documentElement;
      el.dataset.theme = el.dataset.theme === "light" ? "" : "light";
      btn.textContent = el.dataset.theme === "light" ? "Dark theme" : "Light theme";
    });
  });
})();
