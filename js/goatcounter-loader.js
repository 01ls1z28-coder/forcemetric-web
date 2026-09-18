(function () {
  var cfg = window.GUERRA_GOATCOUNTER || {};
  /* Inactive until enabled + real endpoint — no UI prompts, no fake counts. */
  if (!cfg.enabled || !cfg.endpoint || /YOUR-CODE/.test(cfg.endpoint)) {
    return;
  }
  window.goatcounter = { path: location.pathname + location.search + location.hash };
  var s = document.createElement('script');
  s.async = true;
  s.src = cfg.src || 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = cfg.endpoint;
  document.head.appendChild(s);
})();
