/**
 * ForceMetric Drag Racing — dual-lane setup + arcade race playback
 */
(function () {
  'use strict';

  var Physics = window.ForceMetricPhysics;
  var STORAGE_KEY = 'forcemetric-race-vehicle';
  var TRACK_FT = 1320;

  var garageData = (window.GARAGE_DATA || []).slice();
  var filteredOpp = garageData.slice();
  var selectedOppIdx = -1;

  // ---- Dual chart (Canvas2D) ----
  function DualChart(canvas, mode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode || 'time'; // 'time' | 'distance'
    this.seriesA = [];
    this.seriesB = [];
    this.labelA = 'You';
    this.labelB = 'Opp';
    this.colorA = '#b8ff3c';
    this.colorB = '#22d3ee';
    this.xMax = mode === 'distance' ? TRACK_FT : 20;
    this.yMax = 200;
    this.playT = null;
    this._cssW = 0;
    this._cssH = 0;
    var self = this;
    this._onResize = function () { self.resize(); };
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(canvas.parentElement);
    }
    this.resize();
  }

  DualChart.prototype.resize = function () {
    var parent = this.canvas.parentElement;
    var cssW = (parent && parent.clientWidth) || 400;
    var cssH = (parent && parent.clientHeight) || 220;
    var dpr = window.devicePixelRatio || 1;
    this._cssW = cssW;
    this._cssH = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  DualChart.prototype.setSeries = function (stepsA, stepsB, labelA, labelB) {
    var self = this;
    function sample(steps) {
      var out = [];
      if (!steps || !steps.length) return out;
      var every = 8;
      var vmax = 0;
      var xmax = 0;
      for (var i = 0; i < steps.length; i++) {
        if (i % every !== 0 && i !== steps.length - 1) continue;
        var s = steps[i];
        var x = self.mode === 'distance' ? s.DistanceFt : s.Time;
        var v = s.SpeedMph;
        if (!isFinite(x) || !isFinite(v)) continue;
        if (self.mode === 'distance' && x > TRACK_FT * 1.02) continue;
        out.push({ x: x, v: v });
        if (v > vmax) vmax = v;
        if (x > xmax) xmax = x;
      }
      return { points: out, vmax: vmax, xmax: xmax };
    }
    var a = sample(stepsA);
    var b = sample(stepsB);
    this.seriesA = a.points;
    this.seriesB = b.points;
    this.labelA = labelA || 'You';
    this.labelB = labelB || 'Opp';
    this.yMax = Math.max(200, a.vmax + 20, b.vmax + 20);
    if (this.mode === 'distance') {
      this.xMax = TRACK_FT;
    } else {
      this.xMax = Math.max(10, a.xmax * 1.05, b.xmax * 1.05);
    }
    this.playT = null;
    this.draw();
  };

  DualChart.prototype.setPlayback = function (tOrFt) {
    this.playT = (tOrFt == null || !isFinite(tOrFt)) ? null : tOrFt;
    this.draw();
  };

  DualChart.prototype.draw = function () {
    var ctx = this.ctx;
    var W = this._cssW;
    var H = this._cssH;
    if (!W || !H) return;
    var PAD = { l: 46, r: 14, t: 14, b: 34 };
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, W, H);
    var rect = { x: PAD.l, y: PAD.t, w: Math.max(1, W - PAD.l - PAD.r), h: Math.max(1, H - PAD.t - PAD.b) };

    function mapX(x) { return rect.x + (x / this.xMax) * rect.w; }
    function mapY(v) { return rect.y + rect.h - (v / this.yMax) * rect.h; }
    mapX = mapX.bind(this);
    mapY = mapY.bind(this);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = '#8b93a1';
    ctx.font = '11px Segoe UI, system-ui, sans-serif';
    ctx.lineWidth = 1;
    var i, x, y, v;
    for (i = 0; i <= 5; i++) {
      x = mapX((this.xMax * i) / 5);
      ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var xv = (this.xMax * i) / 5;
      ctx.fillText(this.mode === 'distance' ? String(Math.round(xv)) : (xv < 10 ? xv.toFixed(1) : String(Math.round(xv))), x, rect.y + rect.h + 6);
    }
    for (i = 0; i <= 4; i++) {
      v = (this.yMax * i) / 4;
      y = mapY(v);
      ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(v)), rect.x - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(this.mode === 'distance' ? 'Distance (ft)' : 'Time (s)', rect.x + rect.w / 2, H - 2);
    ctx.save();
    ctx.translate(12, rect.y + rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Speed [mph]', 0, 0);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    function strokeSeries(pts, color) {
      if (!pts || pts.length < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      for (var j = 0; j < pts.length; j++) {
        var px = mapX(Math.min(pts[j].x, this.xMax));
        var py = mapY(pts[j].v);
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
    strokeSeries = strokeSeries.bind(this);
    strokeSeries(this.seriesA, this.colorA);
    strokeSeries(this.seriesB, this.colorB);

    // legend
    ctx.font = '11px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = this.colorA;
    ctx.fillText(this.labelA, rect.x + 8, rect.y + 6);
    ctx.fillStyle = this.colorB;
    ctx.fillText(this.labelB, rect.x + 8, rect.y + 22);

    if (this.playT != null && this.mode === 'time') {
      var pt = Math.min(this.playT, this.xMax);
      x = mapX(pt);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
    }
  };

  // ---- DOM helpers ----
  function $(id) { return document.getElementById(id); }

  function mapTireIndex(idx) {
    switch (idx) {
      case 0: return Physics.TireType.Street;
      case 1: return Physics.TireType.DragTire;
      case 2: return Physics.TireType.Slick;
      default: return Physics.TireType.Street;
    }
  }

  function tireLabelFromEnum(t) {
    if (t === 1 || t === 'DragTire') return '1';
    if (t === 2 || t === 'Slick') return '2';
    return '0';
  }

  function getDrive(prefix) {
    if ($(prefix + 'AWD') && $(prefix + 'AWD').checked) return 'AWD';
    if ($(prefix + 'FWD') && $(prefix + 'FWD').checked) return 'FWD';
    return 'RWD';
  }

  function setDrive(prefix, dt) {
    var v = String(dt || 'RWD').toUpperCase();
    if (v !== 'FWD' && v !== 'RWD' && v !== 'AWD') v = 'RWD';
    $(prefix + 'FWD').checked = (v === 'FWD');
    $(prefix + 'RWD').checked = (v === 'RWD');
    $(prefix + 'AWD').checked = (v === 'AWD');
  }

  function parseNum(el, name) {
    var v = parseFloat(String(el.value).trim());
    if (!isFinite(v)) throw new Error('Invalid value for ' + name + '.');
    return v;
  }

  function fmt2(n) { return (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(2); }
  function fmt1(n) { return (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(1); }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shortName(name) {
    var n = String(name || '').trim();
    if (!n) return 'Custom';
    if (n.length <= 28) return n;
    return n.slice(0, 26) + '…';
  }

  function looksLikeEv(name) {
    var n = String(name || '').toLowerCase();
    return /\btesla\b|\blucid\b|\brivian\b|\bpolestar\b|\brimac\b|\btaycan\b|\bcybertruck\b|\bplaid\b|e-tron|ioniq|\beq[sbe]\b|mach-e|\bev\b|electric|ariya|solterra|bz4x|lyriq|blazer ev|fisker|kona electric|niro ev|id\.4|ex90|gv60|lightning/.test(n);
  }

  // ---- Fill lane from snapshot / car ----
  function applyTune(prefix, snap) {
    if (!snap) return;
    $(prefix + 'Name').value = snap.Name || snap.name || 'Custom setup';
    $(prefix + 'Hp').value = snap.Horsepower != null ? snap.Horsepower : (snap.hp != null ? snap.hp : 450);
    $(prefix + 'Weight').value = snap.WeightLbs != null ? snap.WeightLbs : (snap.weight != null ? snap.weight : 3800);
    $(prefix + 'Cd').value = snap.DragCoefficient != null ? snap.DragCoefficient : (snap.cd != null ? snap.cd : 0.32);
    $(prefix + 'Area').value = snap.FrontalAreaSqFt != null ? snap.FrontalAreaSqFt : (snap.area != null ? snap.area : 22);
    $(prefix + 'Loss').value = snap.DrivetrainLossPercent != null ? snap.DrivetrainLossPercent : (snap.loss != null ? snap.loss : 15);
    var tire = snap.TireType != null ? snap.TireType : (snap.tireType != null ? snap.tireType : 0);
    if (typeof tire === 'string') tire = parseInt(tire, 10) || 0;
    $(prefix + 'Tire').value = String(tire);
    var evOn = !!(snap.isEv || snap.chkEv);
    if (!evOn && looksLikeEv(snap.Name || snap.name)) evOn = true;
    $(prefix + 'Ev').checked = evOn;
    if (evOn) {
      $(prefix + 'NA').checked = false;
      $(prefix + 'FI').checked = false;
      $(prefix + 'NA').disabled = true;
      $(prefix + 'FI').disabled = true;
    } else {
      $(prefix + 'NA').checked = !!(snap.isNA || snap.chkNA);
      $(prefix + 'FI').checked = !!(snap.isFI || snap.chkFI);
      $(prefix + 'NA').disabled = false;
      $(prefix + 'FI').disabled = false;
    }
    setDrive(prefix, snap.DriveType || snap.driveType || 'RWD');
    updateLaneLabel(prefix);
  }

  function updateLaneLabel(prefix) {
    var name = $(prefix + 'Name').value || (prefix === 'you' ? 'Custom setup' : 'Opponent');
    if (prefix === 'you') {
      $('youNameLabel').textContent = name;
    } else {
      $('oppNameLabel').textContent = name || 'Pick from garage';
    }
  }

  function readLane(prefix) {
    return {
      Name: String($(prefix + 'Name').value || '').trim() || (prefix === 'you' ? 'Your car' : 'Opponent'),
      hp: parseNum($(prefix + 'Hp'), prefix + ' HP'),
      weightLbs: parseNum($(prefix + 'Weight'), prefix + ' Weight'),
      Cd: parseNum($(prefix + 'Cd'), prefix + ' Cd'),
      frontalAreaSqFt: parseNum($(prefix + 'Area'), prefix + ' Area'),
      drivetrainLoss: parseNum($(prefix + 'Loss'), prefix + ' Loss'),
      tireType: mapTireIndex(parseInt($(prefix + 'Tire').value, 10)),
      driveType: getDrive(prefix),
      isNA: $(prefix + 'NA').checked,
      isFI: $(prefix + 'FI').checked,
      isEv: $(prefix + 'Ev').checked
    };
  }

  // ---- Garage opponent picker ----
  function renderOppList() {
    var html = '';
    for (var i = 0; i < filteredOpp.length; i++) {
      var sel = i === selectedOppIdx ? ' selected' : '';
      html += '<li class="' + sel.trim() + '" data-idx="' + i + '">' + escapeHtml(filteredOpp[i].Name) + '</li>';
    }
    $('oppCarList').innerHTML = html || '<li style="color:#666;cursor:default">No matches</li>';
  }

  function loadOppSelected() {
    if (selectedOppIdx < 0 || selectedOppIdx >= filteredOpp.length) {
      alert('Select an opponent from the garage list first.');
      return;
    }
    var car = filteredOpp[selectedOppIdx];
    applyTune('opp', {
      Name: car.Name,
      Horsepower: car.Horsepower,
      WeightLbs: car.WeightLbs,
      DragCoefficient: car.DragCoefficient,
      FrontalAreaSqFt: car.FrontalAreaSqFt,
      DrivetrainLossPercent: car.DrivetrainLossPercent,
      TireType: tireLabelFromEnum(car.TireType),
      DriveType: car.DriveType || 'RWD',
      isNA: false,
      isFI: false,
      isEv: looksLikeEv(car.Name)
    });
  }

  // ---- Weather ----
  function syncWeatherPreset() {
    switch (parseInt($('weatherPreset').value, 10)) {
      case 1:
        $('temp').value = '59'; $('humidity').value = '0'; $('pressure').value = '29.92';
        break;
      case 2:
        $('temp').value = '90'; $('humidity').value = '60'; $('pressure').value = '29.50';
        break;
      case 3:
        $('temp').value = '50'; $('humidity').value = '40'; $('pressure').value = '30.10';
        break;
    }
  }

  // ---- Race state ----
  var chartTime = null;
  var chartDist = null;
  var raceYou = null;
  var raceOpp = null;
  var raceMeta = null;
  var playbackRaf = null;
  var playbackRunning = false;
  var playbackStart = 0;

  function stopPlayback() {
    playbackRunning = false;
    if (playbackRaf) {
      cancelAnimationFrame(playbackRaf);
      playbackRaf = null;
    }
  }

  function stepAtTime(steps, t) {
    if (!steps || !steps.length) return null;
    var lo = 0;
    var hi = steps.length - 1;
    if (t <= steps[0].Time) return steps[0];
    if (t >= steps[hi].Time) return steps[hi];
    // linear scan from last-ish — steps are dense; binary search
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (steps[mid].Time <= t) lo = mid;
      else hi = mid - 1;
    }
    return steps[lo];
  }

  function leadText(youFt, oppFt, youT, oppT, finished) {
    var dFt = youFt - oppFt;
    var absFt = Math.abs(dFt);
    if (absFt < 0.5 && !finished) return 'Dead even — side by side';
    var leader = dFt > 0 ? raceMeta.youName : raceMeta.oppName;
    var behind = dFt > 0 ? raceMeta.oppName : raceMeta.youName;
    // time gap: time for trailing car to reach leader's distance (approx from trailing speed)
    var trailSteps = dFt > 0 ? raceOpp.Steps : raceYou.Steps;
    var leadSteps = dFt > 0 ? raceYou.Steps : raceOpp.Steps;
    var leadDist = Math.max(youFt, oppFt);
    var leadTimeAt = null;
    var trailTimeAt = null;
    for (var i = 0; i < leadSteps.length; i++) {
      if (leadSteps[i].DistanceFt >= leadDist) { leadTimeAt = leadSteps[i].Time; break; }
    }
    for (var j = 0; j < trailSteps.length; j++) {
      if (trailSteps[j].DistanceFt >= leadDist) { trailTimeAt = trailSteps[j].Time; break; }
    }
    var gapS = null;
    if (leadTimeAt != null && trailTimeAt != null) gapS = Math.abs(trailTimeAt - leadTimeAt);
    else {
      // approximate from relative speed
      var trailSp = dFt > 0 ? (stepAtTime(raceOpp.Steps, oppT) || {}).SpeedMph : (stepAtTime(raceYou.Steps, youT) || {}).SpeedMph;
      var fps = ((trailSp || 60) * 5280) / 3600;
      gapS = fps > 1 ? absFt / fps : null;
    }
    var gapStr = gapS != null ? (' · ' + gapS.toFixed(2) + ' s') : '';
    return leader + ' leads by ' + absFt.toFixed(1) + ' ft' + gapStr + '  ·  ' + behind + ' trailing';
  }

  function updateLive(elapsed) {
    var ys = stepAtTime(raceYou.Steps, elapsed);
    var os = stepAtTime(raceOpp.Steps, elapsed);
    if (!ys || !os) return;

    var youFt = Math.min(ys.DistanceFt, TRACK_FT);
    var oppFt = Math.min(os.DistanceFt, TRACK_FT);
    var youPct = (youFt / TRACK_FT) * 100;
    var oppPct = (oppFt / TRACK_FT) * 100;

    $('youFill').style.width = youPct.toFixed(2) + '%';
    $('oppFill').style.width = oppPct.toFixed(2) + '%';
    $('youMarker').style.left = youPct.toFixed(2) + '%';
    $('oppMarker').style.left = oppPct.toFixed(2) + '%';

    var youDone = ys.DistanceFt >= TRACK_FT;
    var oppDone = os.DistanceFt >= TRACK_FT;
    // Freeze lane mph at true 1320 trap once past finish (don't keep climbing with wall-clock Steps)
    var youMph = ys.SpeedMph;
    var oppMph = os.SpeedMph;
    if (youDone && raceMeta && raceMeta.youTrapMph != null) youMph = raceMeta.youTrapMph;
    if (oppDone && raceMeta && raceMeta.oppTrapMph != null) oppMph = raceMeta.oppTrapMph;
    $('youSpeed').textContent = Math.round(youMph) + ' mph';
    $('oppSpeed').textContent = Math.round(oppMph) + ' mph';
    $('youDist').textContent = Math.round(youFt) + ' ft';
    $('oppDist').textContent = Math.round(oppFt) + ' ft';
    var bothDone = youDone && oppDone;
    // Also end when sim time past both finish ETs
    var youET = raceMeta.youET1320;
    var oppET = raceMeta.oppET1320;
    var raceOver = false;
    if (youET != null && oppET != null) {
      raceOver = elapsed >= Math.max(youET, oppET) + 0.15;
    } else if (youET != null || oppET != null) {
      var et = youET != null ? youET : oppET;
      raceOver = elapsed >= et + 0.5;
    } else {
      raceOver = bothDone || elapsed >= Math.max(raceYou.Steps[raceYou.Steps.length - 1].Time, raceOpp.Steps[raceOpp.Steps.length - 1].Time);
    }

    $('leadCallout').textContent = leadText(ys.DistanceFt, os.DistanceFt, ys.Time, os.Time, raceOver);

    if (chartTime) chartTime.setPlayback(elapsed);
    if (chartDist) {
      // playhead on distance chart not used; charts show full curves
    }

    return raceOver;
  }

  function marker(result, ft) {
    var d = result.DistanceMarkers && result.DistanceMarkers[ft];
    if (!d || d.Time < 0) return null;
    return d;
  }

  function gapAtMark(youRes, oppRes, ft) {
    var a = marker(youRes, ft);
    var b = marker(oppRes, ft);
    if (!a || !b) return null;
    return a.Time - b.Time; // positive => you slower (opp ahead)
  }

  function buildResultsCards() {
    var you = raceYou;
    var opp = raceOpp;
    var yn = raceMeta.youName;
    var on = raceMeta.oppName;

    function card(side, res, name, gapsHtml) {
      var m660 = marker(res, 660);
      var m1320 = marker(res, 1320);
      var html = '';
      html += '<div class="result-card ' + side + '">';
      html += '<h3>' + escapeHtml(name) + '</h3>';
      html += '<div class="stat-grid">';
      html += '<div class="stat-pill"><span class="lbl">0–60</span><span class="val">' + (res.ZeroToSixty != null ? fmt2(res.ZeroToSixty) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">0–100</span><span class="val">' + (res.ZeroToHundred != null ? fmt2(res.ZeroToHundred) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/8 mile ET</span><span class="val">' + (m660 ? fmt2(m660.Time) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/8 trap</span><span class="val">' + (m660 ? fmt1(m660.SpeedMph) + ' mph' : '—') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/4 mile ET</span><span class="val">' + (m1320 ? fmt2(m1320.Time) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/4 trap</span><span class="val">' + (m1320 ? fmt1(m1320.SpeedMph) + ' mph' : '—') + '</span></div>';
      html += '</div>';
      html += '<div class="gap-row">' + gapsHtml + '</div>';
      html += '</div>';
      return html;
    }

    var g60 = null;
    if (you.ZeroToSixty != null && opp.ZeroToSixty != null) g60 = you.ZeroToSixty - opp.ZeroToSixty;
    var g100 = null;
    if (you.ZeroToHundred != null && opp.ZeroToHundred != null) g100 = you.ZeroToHundred - opp.ZeroToHundred;
    var g660 = gapAtMark(you, opp, 660);
    var g1320 = gapAtMark(you, opp, 1320);

    function gapLine(label, g) {
      if (g == null) return label + ': n/a';
      if (Math.abs(g) < 0.005) return label + ': dead even';
      if (g < 0) return label + ': ' + yn + ' ahead by ' + Math.abs(g).toFixed(2) + ' s';
      return label + ': ' + on + ' ahead by ' + Math.abs(g).toFixed(2) + ' s';
    }

    var gapsHtml = gapLine('0–60', g60) + '<br/>' +
      gapLine('0–100', g100) + '<br/>' +
      gapLine('1/8 mile', g660) + '<br/>' +
      gapLine('1/4 mile', g1320);

    $('resultsBoard').innerHTML =
      card('you', you, yn, gapsHtml) +
      card('opp', opp, on, gapsHtml);
  }

  function showWinner() {
    var banner = $('winnerBanner');
    banner.classList.remove('show', 'win-you', 'win-opp', 'win-tie');
    var youET = raceMeta.youET1320;
    var oppET = raceMeta.oppET1320;
    var text;
    if (youET == null && oppET == null) {
      text = 'DNF — neither reached 1320 ft';
      banner.classList.add('win-tie');
    } else if (youET == null) {
      text = 'WINNER · ' + raceMeta.oppName + '  (you DNF)';
      banner.classList.add('win-opp');
    } else if (oppET == null) {
      text = 'WINNER · ' + raceMeta.youName + '  (opponent DNF)';
      banner.classList.add('win-you');
    } else {
      var gap = Math.abs(youET - oppET);
      if (gap < 0.005) {
        text = 'TIE · 1/4 mile ' + fmt2(youET) + ' s';
        banner.classList.add('win-tie');
      } else if (youET < oppET) {
        text = 'WINNER · ' + raceMeta.youName + '  ·  by ' + gap.toFixed(2) + ' s';
        banner.classList.add('win-you');
      } else {
        text = 'WINNER · ' + raceMeta.oppName + '  ·  by ' + gap.toFixed(2) + ' s';
        banner.classList.add('win-opp');
      }
    }
    banner.textContent = text;
    // force reflow then show
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function playbackTick(now) {
    if (!playbackRunning) return;
    var elapsed = (now - playbackStart) / 1000.0;
    var over = updateLive(elapsed);
    if (over) {
      // snap to finish
      var endT = Math.max(
        raceMeta.youET1320 != null ? raceMeta.youET1320 : 0,
        raceMeta.oppET1320 != null ? raceMeta.oppET1320 : 0
      );
      updateLive(Math.max(elapsed, endT));
      stopPlayback();
      showWinner();
      return;
    }
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function startPlayback() {
    stopPlayback();
    $('winnerBanner').classList.remove('show', 'win-you', 'win-opp', 'win-tie');
    $('winnerBanner').textContent = '';
    $('youFill').style.width = '0%';
    $('oppFill').style.width = '0%';
    $('youMarker').style.left = '0%';
    $('oppMarker').style.left = '0%';
    $('leadCallout').textContent = 'Green light — GO!';
    playbackStart = performance.now();
    playbackRunning = true;
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function launchRace() {
    try {
      var you = readLane('you');
      var opp = readLane('opp');
      if (!String($('oppName').value || '').trim()) {
        alert('Pick an opponent from the garage (or type a name) before launching.');
        return;
      }
      var tempF = parseNum($('temp'), 'Temp');
      var humidity = parseNum($('humidity'), 'Humidity');
      var pressure = parseNum($('pressure'), 'Pressure');

      var weather = {
        tempF: tempF,
        humidity: humidity,
        pressureInHg: pressure,
        densityAltitudeFtInput: NaN
      };

      raceYou = Physics.calculate({
        hp: you.hp,
        weightLbs: you.weightLbs,
        tireType: you.tireType,
        Cd: you.Cd,
        frontalAreaSqFt: you.frontalAreaSqFt,
        drivetrainLoss: you.drivetrainLoss,
        driveType: you.driveType,
        isEv: you.isEv,
        isNA: you.isNA,
        isFI: you.isFI,
        timestamp: new Date(),
        tempF: weather.tempF,
        humidity: weather.humidity,
        pressureInHg: weather.pressureInHg,
        densityAltitudeFtInput: weather.densityAltitudeFtInput
      });

      raceOpp = Physics.calculate({
        hp: opp.hp,
        weightLbs: opp.weightLbs,
        tireType: opp.tireType,
        Cd: opp.Cd,
        frontalAreaSqFt: opp.frontalAreaSqFt,
        drivetrainLoss: opp.drivetrainLoss,
        driveType: opp.driveType,
        isEv: opp.isEv,
        isNA: opp.isNA,
        isFI: opp.isFI,
        timestamp: new Date(),
        tempF: weather.tempF,
        humidity: weather.humidity,
        pressureInHg: weather.pressureInHg,
        densityAltitudeFtInput: weather.densityAltitudeFtInput
      });

      var youM = marker(raceYou, 1320);
      var oppM = marker(raceOpp, 1320);
      raceMeta = {
        youName: you.Name,
        oppName: opp.Name,
        youET1320: youM ? youM.Time : null,
        oppET1320: oppM ? oppM.Time : null,
        youTrapMph: youM ? youM.SpeedMph : null,
        oppTrapMph: oppM ? oppM.SpeedMph : null
      };

      $('setupView').classList.add('hidden');
      $('raceView').classList.remove('hidden');
      $('liveYouName').textContent = you.Name;
      $('liveOppName').textContent = opp.Name;
      $('stripYouLabel').textContent = shortName(you.Name).toUpperCase();
      $('stripOppLabel').textContent = shortName(opp.Name).toUpperCase();

      if (!chartTime) chartTime = new DualChart($('chartTime'), 'time');
      if (!chartDist) chartDist = new DualChart($('chartDist'), 'distance');
      chartTime.setSeries(raceYou.Steps, raceOpp.Steps, shortName(you.Name), shortName(opp.Name));
      chartDist.setSeries(raceYou.Steps, raceOpp.Steps, shortName(you.Name), shortName(opp.Name));
      setTimeout(function () {
        chartTime.resize();
        chartDist.resize();
      }, 30);

      buildResultsCards();
      startPlayback();
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  function rematch() {
    stopPlayback();
    $('raceView').classList.add('hidden');
    $('setupView').classList.remove('hidden');
  }

  // ---- Init from sessionStorage ----
  function loadIncomingVehicle() {
    var snap = null;
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) snap = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    // query fallback ?car=Name
    var params = new URLSearchParams(window.location.search || '');
    var qName = params.get('car');
    if (!snap && qName && garageData.length) {
      for (var i = 0; i < garageData.length; i++) {
        if (garageData[i].Name === qName) {
          snap = {
            Name: garageData[i].Name,
            Horsepower: garageData[i].Horsepower,
            WeightLbs: garageData[i].WeightLbs,
            DragCoefficient: garageData[i].DragCoefficient,
            FrontalAreaSqFt: garageData[i].FrontalAreaSqFt,
            DrivetrainLossPercent: garageData[i].DrivetrainLossPercent,
            TireType: garageData[i].TireType,
            DriveType: garageData[i].DriveType,
            isNA: false, isFI: false, isEv: looksLikeEv(garageData[i].Name)
          };
          break;
        }
      }
    }

    if (snap) {
      applyTune('you', snap);
      if (isFinite(snap.tempF)) $('temp').value = snap.tempF;
      if (isFinite(snap.humidity)) $('humidity').value = snap.humidity;
      if (isFinite(snap.pressureInHg)) $('pressure').value = snap.pressureInHg;
      if (snap.weatherPreset != null) $('weatherPreset').value = String(snap.weatherPreset);
      $('setupHint').textContent = 'Loaded your car from VelocityBench. Pick an opponent and LAUNCH.';
    } else {
      // default first garage car as "your" suggestion
      if (garageData.length) {
        applyTune('you', {
          Name: garageData[0].Name,
          Horsepower: garageData[0].Horsepower,
          WeightLbs: garageData[0].WeightLbs,
          DragCoefficient: garageData[0].DragCoefficient,
          FrontalAreaSqFt: garageData[0].FrontalAreaSqFt,
          DrivetrainLossPercent: garageData[0].DrivetrainLossPercent,
          TireType: garageData[0].TireType,
          DriveType: garageData[0].DriveType
        });
      }
      $('setupHint').textContent = 'No vehicle was passed from Test — using first garage car. Retune or pick both sides here.';
    }

    // default opponent: Camaro ZL1 if present, else second car
    var oppDefault = null;
    for (var j = 0; j < garageData.length; j++) {
      if (garageData[j].Name.indexOf('Camaro ZL1') !== -1) { oppDefault = garageData[j]; break; }
    }
    if (!oppDefault && garageData.length > 2) oppDefault = garageData[2];
    if (oppDefault) {
      applyTune('opp', {
        Name: oppDefault.Name,
        Horsepower: oppDefault.Horsepower,
        WeightLbs: oppDefault.WeightLbs,
        DragCoefficient: oppDefault.DragCoefficient,
        FrontalAreaSqFt: oppDefault.FrontalAreaSqFt,
        DrivetrainLossPercent: oppDefault.DrivetrainLossPercent,
        TireType: oppDefault.TireType,
        DriveType: oppDefault.DriveType
      });
    }
  }

  // NA/FI mutual exclusion + EV
  function wireEngine(prefix) {
    $(prefix + 'NA').addEventListener('change', function () {
      if ($(prefix + 'NA').checked) $(prefix + 'FI').checked = false;
    });
    $(prefix + 'FI').addEventListener('change', function () {
      if ($(prefix + 'FI').checked) $(prefix + 'NA').checked = false;
    });
    $(prefix + 'Ev').addEventListener('change', function () {
      if ($(prefix + 'Ev').checked) {
        $(prefix + 'NA').checked = false;
        $(prefix + 'FI').checked = false;
        $(prefix + 'NA').disabled = true;
        $(prefix + 'FI').disabled = true;
        $(prefix + 'Loss').value = '8';
        $(prefix + 'Tire').value = '2'; // Slick
      } else {
        $(prefix + 'NA').disabled = false;
        $(prefix + 'FI').disabled = false;
      }
    });
    $(prefix + 'Name').addEventListener('input', function () { updateLaneLabel(prefix); });
  }

  // ---- Boot ----
  wireEngine('you');
  wireEngine('opp');

  $('weatherPreset').addEventListener('change', syncWeatherPreset);
  syncWeatherPreset();

  $('oppSearch').addEventListener('input', function () {
    var q = ($('oppSearch').value || '').toLowerCase();
    filteredOpp = garageData.filter(function (c) {
      return String(c.Name).toLowerCase().indexOf(q) !== -1;
    });
    selectedOppIdx = -1;
    renderOppList();
  });

  $('oppCarList').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-idx]');
    if (!li) return;
    selectedOppIdx = parseInt(li.getAttribute('data-idx'), 10);
    renderOppList();
  });

  $('oppCarList').addEventListener('dblclick', function (e) {
    var li = e.target.closest('li[data-idx]');
    if (!li) return;
    selectedOppIdx = parseInt(li.getAttribute('data-idx'), 10);
    loadOppSelected();
  });

  $('btnLoadOpp').addEventListener('click', loadOppSelected);
  $('btnLaunch').addEventListener('click', launchRace);
  $('btnReplayRace').addEventListener('click', function () {
    if (!raceYou || !raceOpp) return;
    startPlayback();
  });
  $('btnRematch').addEventListener('click', rematch);

  renderOppList();
  loadIncomingVehicle();
})();
