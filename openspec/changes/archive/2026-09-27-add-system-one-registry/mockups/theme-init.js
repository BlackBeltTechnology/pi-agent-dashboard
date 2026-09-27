// Lets score_mockup capture the light theme via ?theme=light without a click.
(function () {
  const p = new URLSearchParams(location.search);
  if (p.get("theme") === "light") document.documentElement.dataset.theme = "light";
})();
