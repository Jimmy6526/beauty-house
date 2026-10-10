/* Light is the default for the whole system; dark (night) only when the user chose it. Runs before first paint. */
(function () {
  var t = 'light';
  try { if (localStorage.getItem('bh_theme') === 'dark') t = 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
