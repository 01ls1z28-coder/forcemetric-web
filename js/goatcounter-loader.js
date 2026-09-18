(function () {
  var cfg = window.GUERRA_GOATCOUNTER || {};
  var note = document.getElementById('visitCounterNote');
  if (!cfg.enabled || !cfg.endpoint || /YOUR-CODE/.test(cfg.endpoint)) {
    if (note) {
      note.textContent =
        'Visit counter ready (GoatCounter). Set your site code in js/goatcounter-config.js to activate — privacy-friendly, no ads/cookies. Inactive until configured (no fake counts).';
    }
    return;
  }
  window.goatcounter = { path: location.pathname + location.search + location.hash };
  var s = document.createElement('script');
  s.async = true;
  s.src = cfg.src || 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = cfg.endpoint;
  document.head.appendChild(s);
  if (note) {
    note.textContent = 'Visits counted with GoatCounter (privacy-friendly, no ads).';
  }
})();
