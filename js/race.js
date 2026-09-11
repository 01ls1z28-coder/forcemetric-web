/**
 * ForceMetric Drag Racing — dual-lane setup + arcade race playback
 * Phase 15: full parity with main sim (TX/DCT, Dual layout, driver 200, bake load, brass charts)
 * Phase 16: setup-compare — lead delta, dial/bracket, DA/air strip, swap/copy, photo-finish, roll race
 * HARD RULE: both lanes always leave at exact same t=0 (no RT / foul / holeshot)
 */
(function () {
  'use strict';

  var Physics = window.ForceMetricPhysics;
  var STORAGE_KEY = 'forcemetric-race-vehicle';
  var TRACK_FT = 1320;
  var DEFAULT_DRIVER_WEIGHT_LBS = 200;
  var DIST_MARKS_FT = [60, 330, 660, 1000, 1320];
  var LEAD_DELTA_MARKS = [60, 330, 660, 1320];
  var EIGHTH_FT = 660;
  var MPH_PER_KMH = 1 / 1.609344;
  var ROLL_START_MPH = 100 * MPH_PER_KMH;
  var ROLL_END_MPH = 200 * MPH_PER_KMH;
  var TREE_STEP_MS = 400;

  var garageData = (window.GARAGE_DATA || []).slice();
  var filteredOpp = garageData.slice();
  var selectedOppIdx = -1;

  // ---- Chart helpers (mirror speed-chart brass + nice ticks) ----
  function niceStep(rough) {
    if (!isFinite(rough) || rough <= 0) return 1;
    var exp = Math.floor(Math.log(rough) / Math.LN10);
    var base = Math.pow(10, exp);
    var f = rough / base;
    var nf;
    if (f <= 1) nf = 1;
    else if (f <= 2) nf = 2;
    else if (f <= 2.5) nf = 2.5;
    else if (f <= 5) nf = 5;
    else nf = 10;
    return nf * base;
  }

  function buildTicks(maxVal, targetCount) {
    var count = targetCount || 5;
    var step = niceStep(maxVal / count);
    if (step <= 0) step = 1;
    var niceMax = Math.ceil(maxVal / step) * step;
    if (niceMax < step) niceMax = step;
    var ticks = [];
    for (var v = 0; v <= niceMax + step * 0.001; v += step) ticks.push(v);
    return { ticks: ticks, max: niceMax, step: step };
  }

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
      if (!steps || !steps.length) return { points: out, vmax: 0, xmax: 0 };
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

    var yRaw = Math.max(100, a.vmax * 1.06, b.vmax * 1.06, 200);
    var yPlan = buildTicks(yRaw, 5);
    this.yMax = yPlan.max;

    if (this.mode === 'distance') {
      this.xMax = TRACK_FT;
    } else {
      var xRaw = Math.max(10, a.xmax * 1.05, b.xmax * 1.05);
      var xPlan = buildTicks(xRaw, 5);
      this.xMax = xPlan.max;
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

    // Brass / champagne dark radial face (parity with main speed-chart)
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.15, 8, W * 0.5, H * 0.55, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#12161c');
    bg.addColorStop(0.55, '#07090c');
    bg.addColorStop(1, '#050607');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var rect = { x: PAD.l, y: PAD.t, w: Math.max(1, W - PAD.l - PAD.r), h: Math.max(1, H - PAD.t - PAD.b) };

    function mapX(x) { return rect.x + (x / this.xMax) * rect.w; }
    function mapY(v) { return rect.y + rect.h - (v / this.yMax) * rect.h; }
    mapX = mapX.bind(this);
    mapY = mapY.bind(this);

    var xPlan = this.mode === 'distance'
      ? { ticks: DIST_MARKS_FT.concat([0]).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; }), step: 330 }
      : buildTicks(this.xMax, 5);
    if (this.mode === 'distance') {
      xPlan = { ticks: [0, 330, 660, 1000, 1320], step: 330 };
    }
    var yPlan = buildTicks(this.yMax, 5);

    ctx.strokeStyle = 'rgba(215, 196, 160, 0.10)';
    ctx.fillStyle = '#c9b48a';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.lineWidth = 1;
    var i, x, y, v, label;

    for (i = 0; i < xPlan.ticks.length; i++) {
      v = xPlan.ticks[i];
      if (v > this.xMax + 1e-6) continue;
      x = mapX(v);
      ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      if (this.mode === 'distance') label = String(Math.round(v));
      else if (v === 0) label = '0';
      else if (v < 10 && xPlan.step < 1) label = v.toFixed(1);
      else if (Math.abs(v - Math.round(v)) < 1e-6) label = String(Math.round(v));
      else label = v.toFixed(1);
      ctx.fillText(label, x, rect.y + rect.h + 6);
    }
    for (i = 0; i < yPlan.ticks.length; i++) {
      v = yPlan.ticks[i];
      if (v > this.yMax + 1e-6) continue;
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

    ctx.strokeStyle = 'rgba(215, 196, 160, 0.35)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    // Distance marks on time chart (readable overlay, staggered)
    if (this.mode === 'time' && this.seriesA && this.seriesA.length) {
      /* no distance event times without steps — skip; dual-lane keeps playback simple */
    }

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
      ctx.lineCap = 'round';
      ctx.shadowColor = color === '#b8ff3c' ? 'rgba(184,255,60,0.35)' : 'rgba(34,211,238,0.35)';
      ctx.shadowBlur = 5;
      for (var j = 0; j < pts.length; j++) {
        var px = mapX(Math.min(pts[j].x, this.xMax));
        var py = mapY(pts[j].v);
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    strokeSeries = strokeSeries.bind(this);
    strokeSeries(this.seriesA, this.colorA);
    strokeSeries(this.seriesB, this.colorB);

    // legend — lime monospace readouts
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = this.colorA;
    ctx.fillText(this.labelA, rect.x + 8, rect.y + 6);
    ctx.fillStyle = this.colorB;
    ctx.fillText(this.labelB, rect.x + 8, rect.y + 22);

    if (this.playT != null && this.mode === 'time') {
      var pt = Math.min(this.playT, this.xMax);
      x = mapX(pt);
      ctx.strokeStyle = 'rgba(184, 255, 60, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
      ctx.fillStyle = 'rgba(184, 255, 60, 0.95)';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(pt.toFixed(2) + ' s', Math.min(x + 4, rect.x + rect.w - 48), rect.y + 6);
    }
  };

  // ---- DOM helpers ----
  function $(id) { return document.getElementById(id); }

  function mapTireIndex(idx) {
    switch (idx) {
      case 0: return Physics.TireType.Street;
      case 1: return Physics.TireType.Sport;
      case 2: return Physics.TireType.DragTire;
      case 3: return Physics.TireType.Slick;
      default: return Physics.TireType.Street;
    }
  }

  function tireLabelFromEnum(t) {
    if (t === 1 || t === 'Sport') return '1';
    if (t === 2 || t === 'DragTire') return '2';
    if (t === 3 || t === 'Slick') return '3';
    return '0';
  }

  var laneExtras = { you: {}, opp: {} };
  var lastNonLightTx = { you: 'auto', opp: 'auto' };
  var lastNonLightDrive = { you: 'RWD', opp: 'RWD' };
  var lightCurbLocksActive = { you: false, opp: false };

  function getDrive(prefix) {
    if ($(prefix + 'AWD') && $(prefix + 'AWD').checked) return 'AWD';
    if ($(prefix + 'FWD') && $(prefix + 'FWD').checked) return 'FWD';
    return 'RWD';
  }

  function setDrive(prefix, dt) {
    var v = String(dt || 'RWD').toUpperCase();
    if (v !== 'FWD' && v !== 'RWD' && v !== 'AWD') v = 'RWD';
    if ($(prefix + 'FWD')) $(prefix + 'FWD').checked = (v === 'FWD');
    if ($(prefix + 'RWD')) $(prefix + 'RWD').checked = (v === 'RWD');
    if ($(prefix + 'AWD')) $(prefix + 'AWD').checked = (v === 'AWD');
  }

  function normalizeTransmission(tx) {
    var v = String(tx == null ? '' : tx).trim().toLowerCase();
    if (v === 'manual' || v === 'mt' || v === '6mt' || v === '7mt') return 'manual';
    if (v === 'dct' || v === 'dual' || v === 'dual clutch' || v === 'dualclutch' || v === 'pdk' || v === 'dsg') return 'dct';
    if (v === 'auto' || v === 'automatic' || v === 'at') return 'auto';
    return 'auto';
  }

  function transmissionFromBake(car) {
    if (!car) return 'auto';
    if (car.Transmission != null && String(car.Transmission).trim() !== '') {
      return normalizeTransmission(car.Transmission);
    }
    return 'auto';
  }

  function getTransmission(prefix) {
    if ($(prefix + 'TxManual') && $(prefix + 'TxManual').checked) return 'manual';
    if ($(prefix + 'TxDct') && $(prefix + 'TxDct').checked) return 'dct';
    return 'auto';
  }

  function setTransmission(prefix, tx) {
    var v = normalizeTransmission(tx);
    if ($(prefix + 'TxAuto')) $(prefix + 'TxAuto').checked = (v === 'auto');
    if ($(prefix + 'TxDct')) $(prefix + 'TxDct').checked = (v === 'dct');
    if ($(prefix + 'TxManual')) $(prefix + 'TxManual').checked = (v === 'manual');
  }

  function transmissionSlipLabel(tx) {
    var v = normalizeTransmission(tx);
    if (v === 'manual') return 'Manual';
    if (v === 'dct') return 'Dual Clutch';
    return 'Automatic';
  }

  /** Manual = base−2; DCT = base−1; Auto = base. */
  function transmissionLossDelta(tx) {
    var v = normalizeTransmission(tx);
    if (v === 'manual') return -2;
    if (v === 'dct') return -1;
    return 0;
  }

  function getHpSource(prefix) {
    if ($(prefix + 'HpDynoJet') && $(prefix + 'HpDynoJet').checked) return 'dynojet';
    if ($(prefix + 'HpMustang') && $(prefix + 'HpMustang').checked) return 'mustang';
    return 'engine';
  }

  function setHpSource(prefix, src) {
    var v = String(src || 'engine').toLowerCase();
    if (v !== 'engine' && v !== 'dynojet' && v !== 'mustang') v = 'engine';
    if ($(prefix + 'HpEngine')) $(prefix + 'HpEngine').checked = (v === 'engine');
    if ($(prefix + 'HpDynoJet')) $(prefix + 'HpDynoJet').checked = (v === 'dynojet');
    if ($(prefix + 'HpMustang')) $(prefix + 'HpMustang').checked = (v === 'mustang');
    syncHpLossUi(prefix);
  }

  function hpSourceLabel(src) {
    if (src === 'dynojet') return 'DynoJet WHP';
    if (src === 'mustang') return 'Mustang Dyno WHP';
    return 'HP';
  }

  function syncHpLossUi(prefix) {
    var source = getHpSource(prefix);
    var lab = $(prefix + 'HpLabel');
    if (lab) lab.textContent = hpSourceLabel(source);
    var lossEl = $(prefix + 'Loss');
    if (lossEl) {
      var lock = source !== 'engine';
      lossEl.disabled = lock;
      if (lock) lossEl.title = 'Loss locked at 0 for DynoJet / Mustang Dyno WHP';
      else lossEl.title = '';
    }
  }

  function computeEffectiveLoss(prefix) {
    var source = getHpSource(prefix);
    if (source === 'dynojet' || source === 'mustang') return 0;
    var base = parseFloat($(prefix + 'Loss').value);
    if (Number.isNaN(base)) base = 15;
    var eff = base + transmissionLossDelta(getTransmission(prefix));
    if (eff < 0) eff = 0;
    if (eff > 35) eff = 35;
    return eff;
  }

  function resolveRunHorsepower(prefix, typedHp) {
    if (getHpSource(prefix) === 'mustang') return typedHp * 1.05;
    return typedHp;
  }

  function getEngineLayout(prefix) {
    if ($(prefix + 'LayoutDual') && $(prefix + 'LayoutDual').checked) return 'Dual';
    if ($(prefix + 'LayoutMid') && $(prefix + 'LayoutMid').checked) return 'Mid';
    if ($(prefix + 'LayoutRear') && $(prefix + 'LayoutRear').checked) return 'Rear';
    return 'Front';
  }

  function setEngineLayout(prefix, v) {
    var L = String(v || 'Front');
    if (L !== 'Front' && L !== 'Mid' && L !== 'Rear' && L !== 'Dual') L = 'Front';
    if ($(prefix + 'LayoutFront')) $(prefix + 'LayoutFront').checked = (L === 'Front');
    if ($(prefix + 'LayoutMid')) $(prefix + 'LayoutMid').checked = (L === 'Mid');
    if ($(prefix + 'LayoutRear')) $(prefix + 'LayoutRear').checked = (L === 'Rear');
    if ($(prefix + 'LayoutDual')) $(prefix + 'LayoutDual').checked = (L === 'Dual');
  }

  /** EV motor layout from drivetrain. AWD→Dual; preserve Mid (e.g. Nevera garage bake). */
  function bakeEvEngineLayout(driveType, opts) {
    opts = opts || {};
    var d = String(driveType || '').toUpperCase();
    if (d === 'FWD') return 'Front';
    if (d === 'RWD') return 'Rear';
    if (d === 'AWD') {
      var name = String(opts.name || '').toLowerCase();
      if (/\bnevera\b/.test(name)) return 'Mid';
      if (opts.preserveMid && String(opts.currentLayout || '') === 'Mid') return 'Mid';
      return 'Dual';
    }
    return 'Front';
  }

  function looksLikeEv(name) {
    var n = String(name || '').toLowerCase();
    return /\btesla\b|\blucid\b|\brivian\b|\bpolestar\b|\brimac\b|\btaycan\b|\bcybertruck\b|\bplaid\b|e-tron|ioniq|\beq[sbe]\b|mach-e|\bev\b|electric|ariya|solterra|bz4x|lyriq|blazer ev|fisker|kona electric|niro ev|id\.4|ex90|gv60|lightning|eqe|eqs|eqb/.test(n);
  }

  function carIsEv(car) {
    if (!car) return false;
    if (typeof car.IsEv === 'boolean') return car.IsEv;
    if (typeof car.isEv === 'boolean') return car.isEv;
    return looksLikeEv(car.Name || car.name);
  }

  function carIsFi(car) {
    if (!car) return false;
    if (typeof car.IsForcedInduction === 'boolean') return !!car.IsForcedInduction;
    if (typeof car.isFI === 'boolean') return !!car.isFI;
    return false;
  }

  function isLightCurb(prefix) {
    var curb = parseFloat($(prefix + 'Weight') && $(prefix + 'Weight').value);
    if (!isFinite(curb)) curb = 3800;
    return curb <= 1500;
  }

  function isEvMode(prefix) {
    return !!( $(prefix + 'Ev') && $(prefix + 'Ev').checked );
  }

  function applyLightCurbLocks(prefix) {
    var ev = isEvMode(prefix);
    var light = isLightCurb(prefix);
    var leavingLight = lightCurbLocksActive[prefix] && !light;

    if (!lightCurbLocksActive[prefix]) {
      if (!ev) lastNonLightTx[prefix] = getTransmission(prefix);
      lastNonLightDrive[prefix] = getDrive(prefix);
    }

    var txAuto = $(prefix + 'TxAuto');
    var txDct = $(prefix + 'TxDct');
    var txManual = $(prefix + 'TxManual');

    if (ev) {
      if (txAuto) { txAuto.checked = true; txAuto.disabled = false; }
      if (txDct) { txDct.checked = false; txDct.disabled = true; }
      if (txManual) { txManual.checked = false; txManual.disabled = true; }
    } else if (light) {
      if (txManual) { txManual.checked = true; txManual.disabled = false; }
      if (txAuto) { txAuto.checked = false; txAuto.disabled = true; }
      if (txDct) { txDct.checked = false; txDct.disabled = true; }
    } else {
      if (txAuto) txAuto.disabled = false;
      if (txDct) txDct.disabled = false;
      if (txManual) txManual.disabled = false;
      if (leavingLight) setTransmission(prefix, lastNonLightTx[prefix]);
    }

    if (light) {
      setDrive(prefix, 'RWD');
      if ($(prefix + 'FWD')) $(prefix + 'FWD').disabled = true;
      if ($(prefix + 'AWD')) $(prefix + 'AWD').disabled = true;
      if ($(prefix + 'RWD')) $(prefix + 'RWD').disabled = false;
    } else {
      if ($(prefix + 'FWD')) $(prefix + 'FWD').disabled = false;
      if ($(prefix + 'RWD')) $(prefix + 'RWD').disabled = false;
      if ($(prefix + 'AWD')) $(prefix + 'AWD').disabled = false;
      if (leavingLight) setDrive(prefix, lastNonLightDrive[prefix]);
    }

    lightCurbLocksActive[prefix] = light;
    syncHpLossUi(prefix);
    updateLayoutLabel(prefix);
  }

  function updateLayoutLabel(prefix) {
    var lab = $(prefix + 'LayoutLabel');
    if (!lab) return;
    lab.textContent = isEvMode(prefix) ? 'Motor Layout' : 'Engine/Motor Layout';
  }

  function parseNum(el, name) {
    var v = parseFloat(String(el.value).trim());
    if (!isFinite(v)) throw new Error('Invalid value for ' + name + '.');
    return v;
  }

  function fmt2(n) { return (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(2); }
  function fmt3(n) { return (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(3); }
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

  function resolveMassLbs(prefix, curbWeight) {
    var driverWeight = DEFAULT_DRIVER_WEIGHT_LBS;
    var dwEl = $(prefix + 'DriverWeight');
    if (dwEl && String(dwEl.value).trim() !== '') {
      driverWeight = parseFloat(dwEl.value);
      if (!isFinite(driverWeight)) driverWeight = DEFAULT_DRIVER_WEIGHT_LBS;
    }
    if (driverWeight < 0) throw new Error('Driver Weight must be ≥ 0.');
    var weight;
    if (curbWeight > 1500) {
      weight = curbWeight - 200 + driverWeight;
    } else {
      weight = curbWeight - 115 + driverWeight;
    }
    if (weight < 100) weight = 100;
    return { weight: weight, driverWeight: driverWeight };
  }

  // ---- Fill lane from snapshot / car ----
  function applyTune(prefix, snap) {
    if (!snap) return;
    $(prefix + 'Name').value = snap.Name || snap.name || 'Custom setup';
    $(prefix + 'Hp').value = snap.Horsepower != null ? snap.Horsepower : (snap.hp != null ? snap.hp : 450);
    $(prefix + 'Weight').value = snap.WeightLbs != null ? snap.WeightLbs : (snap.weight != null ? snap.weight : 3800);
    var dw = snap.DriverWeightLbs != null ? snap.DriverWeightLbs : (snap.driverWeight != null ? snap.driverWeight : DEFAULT_DRIVER_WEIGHT_LBS);
    if ($(prefix + 'DriverWeight')) $(prefix + 'DriverWeight').value = dw;
    $(prefix + 'Cd').value = snap.DragCoefficient != null ? snap.DragCoefficient : (snap.cd != null ? snap.cd : 0.32);
    $(prefix + 'Area').value = snap.FrontalAreaSqFt != null ? snap.FrontalAreaSqFt : (snap.area != null ? snap.area : 22);
    $(prefix + 'Loss').value = snap.DrivetrainLossPercent != null ? snap.DrivetrainLossPercent : (snap.loss != null ? snap.loss : 15);
    var tire = snap.TireType != null ? snap.TireType : (snap.tireType != null ? snap.tireType : 0);
    if (typeof tire === 'string') tire = parseInt(tire, 10) || 0;
    $(prefix + 'Tire').value = String(tire);

    var evOn = carIsEv(snap);
    if (!evOn && (snap.isEv || snap.chkEv)) evOn = true;
    $(prefix + 'Ev').checked = evOn;
    if (evOn) {
      $(prefix + 'NA').checked = false;
      $(prefix + 'FI').checked = false;
      $(prefix + 'NA').disabled = true;
      $(prefix + 'FI').disabled = true;
    } else {
      var isFi = carIsFi(snap) || !!(snap.isFI || snap.chkFI);
      var isNa = !!(snap.isNA || snap.chkNA);
      if (carIsFi(snap) || (snap.IsForcedInduction === true)) {
        $(prefix + 'FI').checked = true;
        $(prefix + 'NA').checked = false;
      } else if (isNa || snap.IsForcedInduction === false) {
        $(prefix + 'NA').checked = !isFi;
        $(prefix + 'FI').checked = isFi;
      } else {
        $(prefix + 'NA').checked = isNa;
        $(prefix + 'FI').checked = isFi;
      }
      $(prefix + 'NA').disabled = false;
      $(prefix + 'FI').disabled = false;
    }

    setDrive(prefix, snap.DriveType || snap.driveType || 'RWD');

    var layout = snap.EngineLayout || snap.engineLayout || 'Front';
    if (evOn) {
      layout = bakeEvEngineLayout(snap.DriveType || snap.driveType || getDrive(prefix), {
        name: snap.Name || snap.name,
        preserveMid: true,
        currentLayout: layout
      });
      /* Prefer explicit Dual/Mid/Rear/Front from bake when present */
      if (snap.EngineLayout || snap.engineLayout) {
        layout = snap.EngineLayout || snap.engineLayout;
      }
    }
    setEngineLayout(prefix, layout);

    if (evOn) {
      setTransmission(prefix, 'auto');
    } else if (snap.Transmission != null || snap.transmission != null) {
      setTransmission(prefix, transmissionFromBake(snap));
      lastNonLightTx[prefix] = getTransmission(prefix);
    } else {
      setTransmission(prefix, 'auto');
    }

    if (snap.HpSource || snap.hpSource) setHpSource(prefix, snap.HpSource || snap.hpSource);
    else setHpSource(prefix, 'engine');

    laneExtras[prefix] = {
      engineLayout: getEngineLayout(prefix),
      differential: snap.Differential || snap.differential || (evOn ? 'Open' : 'LSD'),
      maxSpeedMph: (snap.MaxSpeedMph != null && isFinite(snap.MaxSpeedMph) && snap.MaxSpeedMph > 0)
        ? Number(snap.MaxSpeedMph) : null,
      transmission: getTransmission(prefix)
    };

    applyLightCurbLocks(prefix);
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
    var curb = parseNum($(prefix + 'Weight'), prefix + ' Curb Weight');
    var mass = resolveMassLbs(prefix, curb);
    var typedHp = parseNum($(prefix + 'Hp'), prefix + ' HP');
    return {
      Name: String($(prefix + 'Name').value || '').trim() || (prefix === 'you' ? 'Your car' : 'Opponent'),
      hp: resolveRunHorsepower(prefix, typedHp),
      typedHp: typedHp,
      curbWeightLbs: curb,
      driverWeightLbs: mass.driverWeight,
      weightLbs: mass.weight,
      Cd: parseNum($(prefix + 'Cd'), prefix + ' Cd'),
      frontalAreaSqFt: parseNum($(prefix + 'Area'), prefix + ' Area'),
      drivetrainLoss: computeEffectiveLoss(prefix),
      baseLoss: parseFloat($(prefix + 'Loss').value) || 15,
      tireType: mapTireIndex(parseInt($(prefix + 'Tire').value, 10)),
      driveType: getDrive(prefix),
      engineLayout: getEngineLayout(prefix),
      differential: (laneExtras[prefix] && laneExtras[prefix].differential) || 'LSD',
      maxSpeedMph: (laneExtras[prefix] && laneExtras[prefix].maxSpeedMph != null)
        ? laneExtras[prefix].maxSpeedMph : null,
      transmission: getTransmission(prefix),
      hpSource: getHpSource(prefix),
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

  function carSnapFromGarage(car) {
    return {
      Name: car.Name,
      Horsepower: car.Horsepower,
      WeightLbs: car.WeightLbs,
      DragCoefficient: car.DragCoefficient,
      FrontalAreaSqFt: car.FrontalAreaSqFt,
      DrivetrainLossPercent: car.DrivetrainLossPercent,
      TireType: tireLabelFromEnum(car.TireType),
      DriveType: car.DriveType || 'RWD',
      EngineLayout: car.EngineLayout || 'Front',
      Differential: car.Differential || (carIsEv(car) ? 'Open' : 'LSD'),
      Transmission: car.Transmission,
      MaxSpeedMph: car.MaxSpeedMph,
      IsEv: carIsEv(car),
      IsForcedInduction: carIsFi(car),
      isNA: !carIsEv(car) && !carIsFi(car),
      isFI: !carIsEv(car) && carIsFi(car),
      isEv: carIsEv(car)
    };
  }

  function loadOppSelected() {
    if (selectedOppIdx < 0 || selectedOppIdx >= filteredOpp.length) {
      alert('Select an opponent from the garage list first.');
      return;
    }
    applyTune('opp', carSnapFromGarage(filteredOpp[selectedOppIdx]));
  }

  // ---- Lane snapshot / swap / copy (Phase 16) ----
  function captureLaneSnap(prefix) {
    return {
      Name: $(prefix + 'Name').value,
      Horsepower: parseFloat($(prefix + 'Hp').value),
      WeightLbs: parseFloat($(prefix + 'Weight').value),
      DriverWeightLbs: $(prefix + 'DriverWeight') ? parseFloat($(prefix + 'DriverWeight').value) : DEFAULT_DRIVER_WEIGHT_LBS,
      DragCoefficient: parseFloat($(prefix + 'Cd').value),
      FrontalAreaSqFt: parseFloat($(prefix + 'Area').value),
      DrivetrainLossPercent: parseFloat($(prefix + 'Loss').value),
      TireType: $(prefix + 'Tire').value,
      DriveType: getDrive(prefix),
      EngineLayout: getEngineLayout(prefix),
      Differential: (laneExtras[prefix] && laneExtras[prefix].differential) || 'LSD',
      Transmission: getTransmission(prefix),
      HpSource: getHpSource(prefix),
      MaxSpeedMph: (laneExtras[prefix] && laneExtras[prefix].maxSpeedMph != null)
        ? laneExtras[prefix].maxSpeedMph : undefined,
      IsEv: isEvMode(prefix),
      IsForcedInduction: $(prefix + 'FI').checked,
      isNA: $(prefix + 'NA').checked,
      isFI: $(prefix + 'FI').checked,
      isEv: isEvMode(prefix),
      Dial: $(prefix + 'Dial') ? $(prefix + 'Dial').value : ''
    };
  }

  function swapLanes() {
    var a = captureLaneSnap('you');
    var b = captureLaneSnap('opp');
    applyTune('you', b);
    applyTune('opp', a);
    if ($('youDial') && b.Dial != null) $('youDial').value = b.Dial;
    if ($('oppDial') && a.Dial != null) $('oppDial').value = a.Dial;
    updateAirHpStrip();
  }

  function copyLane(fromPrefix, toPrefix) {
    var snap = captureLaneSnap(fromPrefix);
    applyTune(toPrefix, snap);
    if ($(toPrefix + 'Dial') && snap.Dial != null) $(toPrefix + 'Dial').value = snap.Dial;
    updateAirHpStrip();
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
    if ($('da')) $('da').value = '';
    updateAirHpStrip();
  }

  function getDaInput() {
    if (!$('da') || String($('da').value).trim() === '') return NaN;
    var v = parseFloat(String($('da').value).trim());
    return isFinite(v) ? v : NaN;
  }

  /** Mirror main Air/HP strip via Physics.computeWeatherAirState (no duplicated math). */
  function updateAirHpStrip() {
    if (!Physics || !Physics.computeWeatherAirState) return;
    if (!$('airRhoValue')) return;
    var tempF = parseFloat($('temp') && $('temp').value);
    var humidity = parseFloat($('humidity') && $('humidity').value);
    var pressure = parseFloat($('pressure') && $('pressure').value);
    if (!isFinite(tempF)) tempF = 59;
    if (!isFinite(humidity)) humidity = 0;
    if (!isFinite(pressure)) pressure = 29.92;
    var state = Physics.computeWeatherAirState({
      tempF: tempF,
      humidity: humidity,
      pressureInHg: pressure,
      densityAltitudeFtInput: getDaInput(),
      isEv: isEvMode('you'),
      isNA: !!( $('youNA') && $('youNA').checked ),
      isFI: !!( $('youFI') && $('youFI').checked )
    });
    $('airRhoValue').textContent = state.airDensity.toFixed(3);
    if ($('airRhoPct')) $('airRhoPct').textContent = (Math.round(state.densityPctOfStd * 10) / 10).toFixed(1) + '% std';
    if ($('airDaValue')) $('airDaValue').textContent = String(Math.round(state.densityAltitudeFt));
    if ($('airDaUnit')) $('airDaUnit').textContent = 'ft';
    var factorPct = state.weatherHpFactor * 100.0;
    if ($('airHpFactorValue')) $('airHpFactorValue').textContent = (Math.round(factorPct * 10) / 10).toFixed(1) + '%';
    if ($('airHpFactorSub')) {
      $('airHpFactorSub').textContent = state.mode === 'EV' ? 'no HP weather derate' : 'eff. WHP vs std air';
    }
    var badge = $('airModeBadge');
    if (badge) {
      badge.textContent = state.mode;
      badge.setAttribute('data-mode', state.mode);
    }
    if ($('airHpNote')) {
      var foot = 'Shared with main via ForceMetricPhysics.computeWeatherAirState — not dyno lab cert.';
      $('airHpNote').textContent = state.mode === 'EV' ? (state.note + ' ' + foot) : foot;
    }
  }

  function syncBracketUi() {
    var on = !!( $('bracketEnabled') && $('bracketEnabled').checked );
    if ($('youDial')) $('youDial').disabled = !on;
    if ($('oppDial')) $('oppDial').disabled = !on;
    if ($('bracketHint')) {
      $('bracketHint').textContent = on
        ? 'Bracket on: dial is ET target scoring only. Leave stays simultaneous — no RT/foul/holeshot.'
        : 'Dial is scoring only — leave stays simultaneous. Breakout = ET under dial.';
    }
  }

  function getRaceMode() {
    var el = $('raceMode');
    var v = el ? String(el.value) : 'quarter';
    if (v !== 'quarter' && v !== 'eighth' && v !== 'roll') return 'quarter';
    return v;
  }

  function finishDistanceFt() {
    return getRaceMode() === 'eighth' ? EIGHTH_FT : TRACK_FT;
  }

  /** Interpolate time when a lane first reaches target mph (from Steps). */
  function timeAtSpeedMph(steps, targetMph) {
    if (!steps || !steps.length || !isFinite(targetMph)) return null;
    if (steps[0].SpeedMph >= targetMph) return steps[0].Time;
    for (var i = 1; i < steps.length; i++) {
      var a = steps[i - 1];
      var b = steps[i];
      if (a.SpeedMph < targetMph && b.SpeedMph >= targetMph) {
        var span = b.SpeedMph - a.SpeedMph;
        if (span <= 1e-9) return b.Time;
        var f = (targetMph - a.SpeedMph) / span;
        return a.Time + f * (b.Time - a.Time);
      }
    }
    return null;
  }

  function rollInterval(res) {
    if (res && res.HundredToTwoHundredKmh != null && isFinite(res.HundredToTwoHundredKmh)) {
      return res.HundredToTwoHundredKmh;
    }
    var t0 = timeAtSpeedMph(res && res.Steps, ROLL_START_MPH);
    var t1 = timeAtSpeedMph(res && res.Steps, ROLL_END_MPH);
    if (t0 == null || t1 == null) return null;
    return t1 - t0;
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
  var treeTimer = null;

  function stopPlayback() {
    playbackRunning = false;
    if (playbackRaf) {
      cancelAnimationFrame(playbackRaf);
      playbackRaf = null;
    }
    if (treeTimer) {
      clearTimeout(treeTimer);
      treeTimer = null;
    }
  }

  function stepAtTime(steps, t) {
    if (!steps || !steps.length) return null;
    var lo = 0;
    var hi = steps.length - 1;
    if (t <= steps[0].Time) return steps[0];
    if (t >= steps[hi].Time) return steps[hi];
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
      var trailSp = dFt > 0 ? (stepAtTime(raceOpp.Steps, oppT) || {}).SpeedMph : (stepAtTime(raceYou.Steps, youT) || {}).SpeedMph;
      var fps = ((trailSp || 60) * 5280) / 3600;
      gapS = fps > 1 ? absFt / fps : null;
    }
    var gapStr = gapS != null ? (' · ' + gapS.toFixed(2) + ' s') : '';
    return leader + ' leads by ' + absFt.toFixed(1) + ' ft' + gapStr + '  ·  ' + behind + ' trailing';
  }

  function markLabel(ft) {
    if (ft === 60) return '60′';
    if (ft === 330) return '330′';
    if (ft === 660) return '⅛';
    if (ft === 1320) return '¼';
    return ft + '′';
  }

  function deltaAtMark(ft, elapsed) {
    var a = marker(raceYou, ft);
    var b = marker(raceOpp, ft);
    var yn = raceMeta.youName;
    var on = raceMeta.oppName;
    // Live estimate before both have permanent markers: compare distance at elapsed
    if ((!a || a.Time < 0) || (!b || b.Time < 0)) {
      var ys = stepAtTime(raceYou.Steps, elapsed);
      var os = stepAtTime(raceOpp.Steps, elapsed);
      if (!ys || !os) return { text: '—', locked: false };
      var youPassed = ys.DistanceFt >= ft;
      var oppPassed = os.DistanceFt >= ft;
      if (!youPassed && !oppPassed) return { text: 'pending', locked: false };
      // One side reached mark: estimate gap using leadText-style timing
      if (youPassed && !oppPassed) {
        var leadT = a && a.Time >= 0 ? a.Time : ys.Time;
        // trail still short of mark
        return { text: shortName(yn) + ' +live', locked: false };
      }
      if (oppPassed && !youPassed) {
        return { text: shortName(on) + ' +live', locked: false };
      }
    }
    if (!a || a.Time < 0 || !b || b.Time < 0) return { text: '—', locked: false };
    var gapS = a.Time - b.Time;
    // Distance gap at the slower car's mark time
    var laterT = Math.max(a.Time, b.Time);
    var earlySteps = a.Time <= b.Time ? raceYou.Steps : raceOpp.Steps;
    var lateSteps = a.Time <= b.Time ? raceOpp.Steps : raceYou.Steps;
    var earlyAt = stepAtTime(earlySteps, laterT);
    var lateAt = stepAtTime(lateSteps, laterT);
    var gapFt = 0;
    if (earlyAt && lateAt) gapFt = Math.abs(earlyAt.DistanceFt - lateAt.DistanceFt);
    if (Math.abs(gapS) < 0.0005) return { text: 'even', locked: true };
    var leader = gapS < 0 ? yn : on;
    return {
      text: shortName(leader) + ' +' + gapFt.toFixed(1) + ' ft / ' + Math.abs(gapS).toFixed(3) + ' s',
      locked: true,
      leader: leader,
      gapFt: gapFt,
      gapS: Math.abs(gapS)
    };
  }

  function updateLeadDeltaStrip(elapsed) {
    for (var i = 0; i < LEAD_DELTA_MARKS.length; i++) {
      var ft = LEAD_DELTA_MARKS[i];
      var el = $('delta' + ft);
      if (!el) continue;
      var d = deltaAtMark(ft, elapsed);
      el.textContent = d.text;
      el.classList.toggle('delta-locked', !!d.locked);
      el.classList.toggle('delta-you', !!(d.leader && raceMeta && d.leader === raceMeta.youName));
      el.classList.toggle('delta-opp', !!(d.leader && raceMeta && d.leader === raceMeta.oppName));
    }
  }

  function resetLeadDeltaStrip() {
    for (var i = 0; i < LEAD_DELTA_MARKS.length; i++) {
      var el = $('delta' + LEAD_DELTA_MARKS[i]);
      if (!el) continue;
      el.textContent = '—';
      el.classList.remove('delta-locked', 'delta-you', 'delta-opp');
    }
  }

  function updateLive(elapsed) {
    var ys = stepAtTime(raceYou.Steps, elapsed);
    var os = stepAtTime(raceOpp.Steps, elapsed);
    if (!ys || !os) return;

    var trackFt = (raceMeta && raceMeta.trackFt) || TRACK_FT;
    var mode = (raceMeta && raceMeta.mode) || 'quarter';
    var youFt = Math.min(ys.DistanceFt, trackFt);
    var oppFt = Math.min(os.DistanceFt, trackFt);
    // Strip always visualizes against 1320 board; clamp display pct to 100
    var youPct = (Math.min(ys.DistanceFt, TRACK_FT) / TRACK_FT) * 100;
    var oppPct = (Math.min(os.DistanceFt, TRACK_FT) / TRACK_FT) * 100;

    $('youFill').style.width = youPct.toFixed(2) + '%';
    $('oppFill').style.width = oppPct.toFixed(2) + '%';
    $('youMarker').style.left = youPct.toFixed(2) + '%';
    $('oppMarker').style.left = oppPct.toFixed(2) + '%';

    var youMph = ys.SpeedMph;
    var oppMph = os.SpeedMph;
    if (mode !== 'roll') {
      var youDoneDist = ys.DistanceFt >= trackFt;
      var oppDoneDist = os.DistanceFt >= trackFt;
      if (youDoneDist && raceMeta && raceMeta.youTrapMph != null) youMph = raceMeta.youTrapMph;
      if (oppDoneDist && raceMeta && raceMeta.oppTrapMph != null) oppMph = raceMeta.oppTrapMph;
    }
    $('youSpeed').textContent = Math.round(youMph) + ' mph';
    $('oppSpeed').textContent = Math.round(oppMph) + ' mph';
    $('youDist').textContent = Math.round(Math.min(ys.DistanceFt, TRACK_FT)) + ' ft';
    $('oppDist').textContent = Math.round(Math.min(os.DistanceFt, TRACK_FT)) + ' ft';

    var raceOver = false;
    if (mode === 'roll') {
      var youEnd = raceMeta.youRollEndT;
      var oppEnd = raceMeta.oppRollEndT;
      if (youEnd != null && oppEnd != null) {
        raceOver = elapsed >= Math.max(youEnd, oppEnd) + 0.15;
      } else if (youEnd != null || oppEnd != null) {
        var re = youEnd != null ? youEnd : oppEnd;
        raceOver = elapsed >= re + 0.5;
      } else {
        raceOver = elapsed >= Math.max(
          raceYou.Steps[raceYou.Steps.length - 1].Time,
          raceOpp.Steps[raceOpp.Steps.length - 1].Time
        );
      }
      var youStart = raceMeta.youRollStartT;
      var oppStart = raceMeta.oppRollStartT;
      if (youStart != null && elapsed >= youStart && (youEnd == null || elapsed < youEnd)) {
        /* interval clocks run after simultaneous leave */
      }
      $('leadCallout').textContent = leadText(ys.DistanceFt, os.DistanceFt, ys.Time, os.Time, raceOver)
        + (raceOver ? '' : ' · roll 100–200 km/h');
    } else {
      var youET = raceMeta.youFinishET;
      var oppET = raceMeta.oppFinishET;
      if (youET != null && oppET != null) {
        raceOver = elapsed >= Math.max(youET, oppET) + 0.15;
      } else if (youET != null || oppET != null) {
        var et = youET != null ? youET : oppET;
        raceOver = elapsed >= et + 0.5;
      } else {
        raceOver = elapsed >= Math.max(
          raceYou.Steps[raceYou.Steps.length - 1].Time,
          raceOpp.Steps[raceOpp.Steps.length - 1].Time
        );
      }
      $('leadCallout').textContent = leadText(ys.DistanceFt, os.DistanceFt, ys.Time, os.Time, raceOver);
    }

    updateLeadDeltaStrip(elapsed);

    if (chartTime) chartTime.setPlayback(elapsed);

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
    return a.Time - b.Time;
  }

  function buildResultsCards() {
    var you = raceYou;
    var opp = raceOpp;
    var yn = raceMeta.youName;
    var on = raceMeta.oppName;

    function metaLine(lane) {
      var m = raceMeta[lane + 'Meta'] || {};
      var bits = [];
      bits.push('<span class="meta-pill"><span class="lbl">' + (m.isEv ? 'MOTOR' : 'ENGINE') + '</span><span class="val">' +
        escapeHtml(m.isEv ? 'EV' : (m.isFI ? 'Forced ind.' : (m.isNA ? 'N/A' : 'Unspecified'))) + '</span></span>');
      bits.push('<span class="meta-pill"><span class="lbl">TRANS</span><span class="val">' + escapeHtml(transmissionSlipLabel(m.transmission)) + '</span></span>');
      bits.push('<span class="meta-pill"><span class="lbl">HP SRC</span><span class="val">' + escapeHtml(hpSourceLabel(m.hpSource)) + '</span></span>');
      bits.push('<span class="meta-pill"><span class="lbl">LAYOUT</span><span class="val">' + escapeHtml(m.engineLayout || 'Front') + '</span></span>');
      bits.push('<span class="meta-pill"><span class="lbl">DRIVER</span><span class="val">' + (m.driverWeightLbs != null ? Math.round(m.driverWeightLbs) + ' lb' : '—') + '</span></span>');
      bits.push('<span class="meta-pill"><span class="lbl">LOSS</span><span class="val">' + (m.drivetrainLoss != null ? fmt1(m.drivetrainLoss) + '%' : '—') + '</span></span>');
      return '<div class="meta-row">' + bits.join('') + '</div>';
    }

    function card(side, res, name, gapsHtml) {
      var m660 = marker(res, 660);
      var m1320 = marker(res, 1320);
      var html = '';
      html += '<div class="result-card ' + side + '">';
      html += '<h3>' + escapeHtml(name) + '</h3>';
      html += metaLine(side === 'you' ? 'you' : 'opp');
      html += '<div class="stat-grid">';
      html += '<div class="stat-pill"><span class="lbl">0–60</span><span class="val">' + (res.ZeroToSixty != null ? fmt3(res.ZeroToSixty) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">0–100</span><span class="val">' + (res.ZeroToHundred != null ? fmt3(res.ZeroToHundred) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/8 mile ET</span><span class="val">' + (m660 ? fmt3(m660.Time) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/8 trap</span><span class="val">' + (m660 ? fmt1(m660.SpeedMph) + ' mph' : '—') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/4 mile ET</span><span class="val">' + (m1320 ? fmt3(m1320.Time) + ' s' : 'DNF') + '</span></div>';
      html += '<div class="stat-pill"><span class="lbl">1/4 trap</span><span class="val">' + (m1320 ? fmt1(m1320.SpeedMph) + ' mph' : '—') + '</span></div>';
      var roll = rollInterval(res);
      html += '<div class="stat-pill"><span class="lbl">100–200 km/h</span><span class="val">' + (roll != null ? fmt3(roll) + ' s' : 'DNF') + '</span></div>';
      if (raceMeta && raceMeta.bracketOn) {
        var dial = side === 'you' ? raceMeta.youDial : raceMeta.oppDial;
        var finishEt = side === 'you' ? raceMeta.youFinishET : raceMeta.oppFinishET;
        var bo = (dial != null && finishEt != null && finishEt < dial);
        html += '<div class="stat-pill"><span class="lbl">Dial</span><span class="val">' + (dial != null ? fmt3(dial) + ' s' : '—') + '</span></div>';
        html += '<div class="stat-pill"><span class="lbl">Bracket</span><span class="val">' + (bo ? 'BREAKOUT' : (dial != null && finishEt != null ? ('+' + fmt3(finishEt - dial) + ' s') : '—')) + '</span></div>';
      }
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
      if (Math.abs(g) < 0.0005) return label + ': dead even';
      if (g < 0) return label + ': ' + yn + ' ahead by ' + Math.abs(g).toFixed(3) + ' s';
      return label + ': ' + on + ' ahead by ' + Math.abs(g).toFixed(3) + ' s';
    }

    var gRoll = null;
    var ry = rollInterval(you);
    var ro = rollInterval(opp);
    if (ry != null && ro != null) gRoll = ry - ro;

    var gapsHtml = gapLine('0–60', g60) + '<br/>' +
      gapLine('0–100', g100) + '<br/>' +
      gapLine('1/8 mile', g660) + '<br/>' +
      gapLine('1/4 mile', g1320) + '<br/>' +
      gapLine('100–200 km/h', gRoll);

    $('resultsBoard').innerHTML =
      card('you', you, yn, gapsHtml) +
      card('opp', opp, on, gapsHtml);
  }

  function bracketWinner(youET, oppET, youDial, oppDial) {
    // Dial is ET target scoring only — leave was simultaneous.
    var youBO = youET != null && youDial != null && youET < youDial;
    var oppBO = oppET != null && oppDial != null && oppET < oppDial;
    if (youET == null && oppET == null) return { side: 'tie', text: 'DNF — neither finished' };
    if (youET == null) return { side: 'opp', text: 'WINNER · ' + raceMeta.oppName + '  (you DNF)' };
    if (oppET == null) return { side: 'you', text: 'WINNER · ' + raceMeta.youName + '  (opponent DNF)' };
    if (youBO && !oppBO) return { side: 'opp', text: 'WINNER · ' + raceMeta.oppName + '  ·  you BREAKOUT' };
    if (oppBO && !youBO) return { side: 'you', text: 'WINNER · ' + raceMeta.youName + '  ·  opp BREAKOUT' };
    if (youBO && oppBO) {
      // Double breakout: closer to dial (smaller underage) wins
      var youUnder = youDial - youET;
      var oppUnder = oppDial - oppET;
      var g = Math.abs(youUnder - oppUnder);
      if (g < 0.0005) return { side: 'tie', text: 'TIE · double breakout' };
      if (youUnder < oppUnder) return { side: 'you', text: 'WINNER · ' + raceMeta.youName + '  ·  less breakout by ' + g.toFixed(3) + ' s' };
      return { side: 'opp', text: 'WINNER · ' + raceMeta.oppName + '  ·  less breakout by ' + g.toFixed(3) + ' s' };
    }
    // Neither broke out: closer to dial (smaller overage) wins
    var youOver = youET - youDial;
    var oppOver = oppET - oppDial;
    var g2 = Math.abs(youOver - oppOver);
    if (g2 < 0.0005) return { side: 'tie', text: 'TIE · dial ' + fmt3(youDial) + ' / ' + fmt3(oppDial) };
    if (youOver < oppOver) return { side: 'you', text: 'WINNER · ' + raceMeta.youName + '  ·  closer to dial by ' + g2.toFixed(3) + ' s' };
    return { side: 'opp', text: 'WINNER · ' + raceMeta.oppName + '  ·  closer to dial by ' + g2.toFixed(3) + ' s' };
  }

  function buildPhotoFinish() {
    var pf = $('photoFinish');
    var grid = $('photoFinishGrid');
    if (!pf || !grid || !raceMeta) return;
    var mode = raceMeta.mode || 'quarter';
    var rows = '';
    function laneRow(side, name) {
      var et = side === 'you' ? raceMeta.youFinishET : raceMeta.oppFinishET;
      var trap = side === 'you' ? raceMeta.youTrapMph : raceMeta.oppTrapMph;
      var roll = side === 'you' ? raceMeta.youRollInterval : raceMeta.oppRollInterval;
      var dial = side === 'you' ? raceMeta.youDial : raceMeta.oppDial;
      var html = '<div class="photo-lane ' + side + '">';
      html += '<div class="photo-name">' + escapeHtml(name) + '</div>';
      if (mode === 'roll') {
        html += '<div class="photo-stat"><span class="lbl">100–200 km/h</span><span class="val">' + (roll != null ? fmt3(roll) + ' s' : 'DNF') + '</span></div>';
        html += '<div class="photo-stat"><span class="lbl">@200 km/h</span><span class="val">' + (side === 'you'
          ? (raceMeta.youRollEndT != null ? fmt3(raceMeta.youRollEndT) + ' s' : '—')
          : (raceMeta.oppRollEndT != null ? fmt3(raceMeta.oppRollEndT) + ' s' : '—')) + '</span></div>';
      } else {
        html += '<div class="photo-stat"><span class="lbl">ET</span><span class="val">' + (et != null ? fmt3(et) + ' s' : 'DNF') + '</span></div>';
        html += '<div class="photo-stat"><span class="lbl">Trap</span><span class="val">' + (trap != null ? fmt3(trap) + ' mph' : '—') + '</span></div>';
      }
      if (raceMeta.bracketOn && dial != null) {
        var bo = et != null && et < dial;
        html += '<div class="photo-stat"><span class="lbl">Dial</span><span class="val">' + fmt3(dial) + ' s</span></div>';
        html += '<div class="photo-stat"><span class="lbl">Result</span><span class="val">' + (bo ? 'BREAKOUT' : (et != null ? ('+' + fmt3(et - dial) + ' s') : '—')) + '</span></div>';
      }
      html += '</div>';
      return html;
    }
    rows += laneRow('you', raceMeta.youName);
    rows += '<div class="photo-vs">PHOTO<br/>FINISH</div>';
    rows += laneRow('opp', raceMeta.oppName);
    grid.innerHTML = rows;
    pf.classList.remove('hidden');
  }

  function showWinner() {
    var banner = $('winnerBanner');
    banner.classList.remove('show', 'win-you', 'win-opp', 'win-tie');
    var mode = raceMeta.mode || 'quarter';
    var text;
    var side = 'tie';

    if (raceMeta.bracketOn && mode !== 'roll' && raceMeta.youDial != null && raceMeta.oppDial != null) {
      var bw = bracketWinner(raceMeta.youFinishET, raceMeta.oppFinishET, raceMeta.youDial, raceMeta.oppDial);
      text = bw.text;
      side = bw.side;
    } else if (mode === 'roll') {
      var youR = raceMeta.youRollInterval;
      var oppR = raceMeta.oppRollInterval;
      if (youR == null && oppR == null) {
        text = 'DNF — neither completed 100–200 km/h';
        side = 'tie';
      } else if (youR == null) {
        text = 'WINNER · ' + raceMeta.oppName + '  (you DNF)';
        side = 'opp';
      } else if (oppR == null) {
        text = 'WINNER · ' + raceMeta.youName + '  (opponent DNF)';
        side = 'you';
      } else {
        var gapR = Math.abs(youR - oppR);
        if (gapR < 0.0005) {
          text = 'TIE · 100–200 km/h ' + fmt3(youR) + ' s';
          side = 'tie';
        } else if (youR < oppR) {
          text = 'WINNER · ' + raceMeta.youName + '  ·  by ' + gapR.toFixed(3) + ' s (100–200)';
          side = 'you';
        } else {
          text = 'WINNER · ' + raceMeta.oppName + '  ·  by ' + gapR.toFixed(3) + ' s (100–200)';
          side = 'opp';
        }
      }
    } else {
      var youET = raceMeta.youFinishET;
      var oppET = raceMeta.oppFinishET;
      var label = mode === 'eighth' ? '1/8 mile' : '1/4 mile';
      if (youET == null && oppET == null) {
        text = 'DNF — neither reached ' + ((raceMeta.trackFt) || TRACK_FT) + ' ft';
        side = 'tie';
      } else if (youET == null) {
        text = 'WINNER · ' + raceMeta.oppName + '  (you DNF)';
        side = 'opp';
      } else if (oppET == null) {
        text = 'WINNER · ' + raceMeta.youName + '  (opponent DNF)';
        side = 'you';
      } else {
        var gap = Math.abs(youET - oppET);
        if (gap < 0.0005) {
          text = 'TIE · ' + label + ' ' + fmt3(youET) + ' s';
          side = 'tie';
        } else if (youET < oppET) {
          text = 'WINNER · ' + raceMeta.youName + '  ·  by ' + gap.toFixed(3) + ' s';
          side = 'you';
        } else {
          text = 'WINNER · ' + raceMeta.oppName + '  ·  by ' + gap.toFixed(3) + ' s';
          side = 'opp';
        }
      }
    }

    if (side === 'you') banner.classList.add('win-you');
    else if (side === 'opp') banner.classList.add('win-opp');
    else banner.classList.add('win-tie');
    banner.textContent = text;
    void banner.offsetWidth;
    banner.classList.add('show');
    buildPhotoFinish();
  }

  function playbackEndTime() {
    if (!raceMeta) return 0;
    if (raceMeta.mode === 'roll') {
      return Math.max(
        raceMeta.youRollEndT != null ? raceMeta.youRollEndT : 0,
        raceMeta.oppRollEndT != null ? raceMeta.oppRollEndT : 0
      );
    }
    return Math.max(
      raceMeta.youFinishET != null ? raceMeta.youFinishET : 0,
      raceMeta.oppFinishET != null ? raceMeta.oppFinishET : 0
    );
  }

  function playbackTick(now) {
    if (!playbackRunning) return;
    var elapsed = (now - playbackStart) / 1000.0;
    var over = updateLive(elapsed);
    if (over) {
      var endT = playbackEndTime();
      updateLive(Math.max(elapsed, endT));
      stopPlayback();
      showWinner();
      return;
    }
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function resetTreeBulbs() {
    ['treeYouA1','treeYouA2','treeYouA3','treeYouG','treeOppA1','treeOppA2','treeOppA3','treeOppG'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.remove('on');
    });
    if ($('treeLabel')) $('treeLabel').textContent = 'Simultaneous tree';
  }

  function lightTreePair(step) {
    // Cosmetic perfect tree — both lanes identical, no staggered leave
    if (step === 1) {
      if ($('treeYouA1')) $('treeYouA1').classList.add('on');
      if ($('treeOppA1')) $('treeOppA1').classList.add('on');
    } else if (step === 2) {
      if ($('treeYouA2')) $('treeYouA2').classList.add('on');
      if ($('treeOppA2')) $('treeOppA2').classList.add('on');
    } else if (step === 3) {
      if ($('treeYouA3')) $('treeYouA3').classList.add('on');
      if ($('treeOppA3')) $('treeOppA3').classList.add('on');
    } else if (step === 4) {
      if ($('treeYouG')) $('treeYouG').classList.add('on');
      if ($('treeOppG')) $('treeOppG').classList.add('on');
      if ($('treeLabel')) $('treeLabel').textContent = 'GREEN — both leave t=0';
    }
  }

  /** Begin shared clock at the same instant for both lanes (HARD RULE). */
  function beginSimultaneousGo() {
    $('leadCallout').textContent = 'Green light — both lanes t=0 — GO!';
    playbackStart = performance.now();
    playbackRunning = true;
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function startPlayback() {
    stopPlayback();
    $('winnerBanner').classList.remove('show', 'win-you', 'win-opp', 'win-tie');
    $('winnerBanner').textContent = '';
    if ($('photoFinish')) $('photoFinish').classList.add('hidden');
    $('youFill').style.width = '0%';
    $('oppFill').style.width = '0%';
    $('youMarker').style.left = '0%';
    $('oppMarker').style.left = '0%';
    resetLeadDeltaStrip();
    resetTreeBulbs();
    $('leadCallout').textContent = 'Staging… simultaneous leave';

    // Cosmetic tree only — both lanes share identical bulbs; physics clock starts together on green
    var step = 0;
    function treeStep() {
      step += 1;
      lightTreePair(step);
      if (step < 4) {
        treeTimer = setTimeout(treeStep, TREE_STEP_MS);
      } else {
        treeTimer = null;
        beginSimultaneousGo();
      }
    }
    treeTimer = setTimeout(treeStep, 120);
  }

  function laneCalcOpts(lane, weather) {
    var opts = {
      hp: lane.hp,
      weightLbs: lane.weightLbs,
      tireType: lane.tireType,
      Cd: lane.Cd,
      frontalAreaSqFt: lane.frontalAreaSqFt,
      drivetrainLoss: lane.drivetrainLoss,
      driveType: lane.driveType,
      engineLayout: lane.engineLayout,
      differential: lane.differential,
      maxSpeedMph: lane.maxSpeedMph,
      isEv: lane.isEv,
      isNA: lane.isNA,
      isFI: lane.isFI,
      timestamp: new Date(),
      tempF: weather.tempF,
      humidity: weather.humidity,
      pressureInHg: weather.pressureInHg,
      densityAltitudeFtInput: weather.densityAltitudeFtInput
    };
    return opts;
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
      var daIn = getDaInput();

      var weather = {
        tempF: tempF,
        humidity: humidity,
        pressureInHg: pressure,
        densityAltitudeFtInput: daIn
      };

      // HARD RULE: same weather, same t=0 leave — no RT offset applied to either lane
      raceYou = Physics.calculate(laneCalcOpts(you, weather));
      raceOpp = Physics.calculate(laneCalcOpts(opp, weather));

      var mode = getRaceMode();
      var trackFt = mode === 'eighth' ? EIGHTH_FT : TRACK_FT;
      var youM1320 = marker(raceYou, 1320);
      var oppM1320 = marker(raceOpp, 1320);
      var youFinishM = marker(raceYou, trackFt);
      var oppFinishM = marker(raceOpp, trackFt);

      var bracketOn = !!( $('bracketEnabled') && $('bracketEnabled').checked );
      var youDial = null;
      var oppDial = null;
      if (bracketOn) {
        if ($('youDial') && String($('youDial').value).trim() !== '') {
          youDial = parseFloat($('youDial').value);
          if (!isFinite(youDial) || youDial <= 0) throw new Error('Your Dial must be a positive ET (s).');
        }
        if ($('oppDial') && String($('oppDial').value).trim() !== '') {
          oppDial = parseFloat($('oppDial').value);
          if (!isFinite(oppDial) || oppDial <= 0) throw new Error('Opp Dial must be a positive ET (s).');
        }
        if (youDial == null || oppDial == null) {
          throw new Error('Bracket mode needs dials for both lanes (ET target scoring only).');
        }
      }

      raceMeta = {
        youName: you.Name,
        oppName: opp.Name,
        mode: mode,
        trackFt: trackFt,
        bracketOn: bracketOn,
        youDial: youDial,
        oppDial: oppDial,
        youET1320: youM1320 ? youM1320.Time : null,
        oppET1320: oppM1320 ? oppM1320.Time : null,
        youFinishET: youFinishM ? youFinishM.Time : null,
        oppFinishET: oppFinishM ? oppFinishM.Time : null,
        youTrapMph: youFinishM ? youFinishM.SpeedMph : null,
        oppTrapMph: oppFinishM ? oppFinishM.SpeedMph : null,
        youRollStartT: timeAtSpeedMph(raceYou.Steps, ROLL_START_MPH),
        oppRollStartT: timeAtSpeedMph(raceOpp.Steps, ROLL_START_MPH),
        youRollEndT: timeAtSpeedMph(raceYou.Steps, ROLL_END_MPH),
        oppRollEndT: timeAtSpeedMph(raceOpp.Steps, ROLL_END_MPH),
        youRollInterval: rollInterval(raceYou),
        oppRollInterval: rollInterval(raceOpp),
        youMeta: {
          isEv: you.isEv, isNA: you.isNA, isFI: you.isFI,
          transmission: you.transmission, hpSource: you.hpSource,
          engineLayout: you.engineLayout, driverWeightLbs: you.driverWeightLbs,
          drivetrainLoss: you.drivetrainLoss
        },
        oppMeta: {
          isEv: opp.isEv, isNA: opp.isNA, isFI: opp.isFI,
          transmission: opp.transmission, hpSource: opp.hpSource,
          engineLayout: opp.engineLayout, driverWeightLbs: opp.driverWeightLbs,
          drivetrainLoss: opp.drivetrainLoss
        }
      };

      $('setupView').classList.add('hidden');
      $('raceView').classList.remove('hidden');
      if ($('photoFinish')) $('photoFinish').classList.add('hidden');
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
    if ($('photoFinish')) $('photoFinish').classList.add('hidden');
    $('raceView').classList.add('hidden');
    $('setupView').classList.remove('hidden');
    updateAirHpStrip();
  }

  // ---- Init from sessionStorage ----
  function loadIncomingVehicle() {
    var snap = null;
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) snap = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    var params = new URLSearchParams(window.location.search || '');
    var qName = params.get('car');
    if (!snap && qName && garageData.length) {
      for (var i = 0; i < garageData.length; i++) {
        if (garageData[i].Name === qName) {
          snap = carSnapFromGarage(garageData[i]);
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
      if ($('da') && snap.densityAltitudeFt != null && isFinite(snap.densityAltitudeFt)) {
        $('da').value = String(snap.densityAltitudeFt);
      }
      $('setupHint').textContent = 'Loaded your car from VelocityBench. Pick an opponent and LAUNCH.';
    } else {
      if (garageData.length) {
        applyTune('you', carSnapFromGarage(garageData[0]));
      }
      $('setupHint').textContent = 'No vehicle was passed from Test — using first garage car. Retune or pick both sides here.';
    }

    var oppDefault = null;
    for (var j = 0; j < garageData.length; j++) {
      if (garageData[j].Name.indexOf('Camaro ZL1') !== -1) { oppDefault = garageData[j]; break; }
    }
    if (!oppDefault && garageData.length > 2) oppDefault = garageData[2];
    if (oppDefault) {
      applyTune('opp', carSnapFromGarage(oppDefault));
    }
  }

  // NA/FI mutual exclusion + EV + TX/layout locks
  function wireEngine(prefix) {
    $(prefix + 'NA').addEventListener('change', function () {
      if ($(prefix + 'NA').checked) $(prefix + 'FI').checked = false;
      updateAirHpStrip();
    });
    $(prefix + 'FI').addEventListener('change', function () {
      if ($(prefix + 'FI').checked) $(prefix + 'NA').checked = false;
      updateAirHpStrip();
    });
    $(prefix + 'Ev').addEventListener('change', function () {
      if ($(prefix + 'Ev').checked) {
        $(prefix + 'NA').checked = false;
        $(prefix + 'FI').checked = false;
        $(prefix + 'NA').disabled = true;
        $(prefix + 'FI').disabled = true;
        setEngineLayout(prefix, bakeEvEngineLayout(getDrive(prefix), {
          name: $(prefix + 'Name').value,
          preserveMid: true,
          currentLayout: getEngineLayout(prefix)
        }));
      } else {
        $(prefix + 'NA').disabled = false;
        $(prefix + 'FI').disabled = false;
      }
      applyLightCurbLocks(prefix);
      updateAirHpStrip();
    });
    $(prefix + 'Name').addEventListener('input', function () { updateLaneLabel(prefix); });
    $(prefix + 'Weight').addEventListener('change', function () { applyLightCurbLocks(prefix); });
    $(prefix + 'Weight').addEventListener('blur', function () { applyLightCurbLocks(prefix); });

    ['HpEngine', 'HpDynoJet', 'HpMustang', 'TxAuto', 'TxDct', 'TxManual'].forEach(function (suf) {
      var el = $(prefix + suf);
      if (el) el.addEventListener('change', function () {
        if (suf.indexOf('Tx') === 0 && !isEvMode(prefix) && !isLightCurb(prefix)) {
          lastNonLightTx[prefix] = getTransmission(prefix);
        }
        syncHpLossUi(prefix);
      });
    });

    ['FWD', 'RWD', 'AWD'].forEach(function (d) {
      var el = $(prefix + d);
      if (el) el.addEventListener('change', function () {
        if (!isLightCurb(prefix)) lastNonLightDrive[prefix] = getDrive(prefix);
        if (isEvMode(prefix)) {
          setEngineLayout(prefix, bakeEvEngineLayout(getDrive(prefix), {
            name: $(prefix + 'Name').value,
            preserveMid: true,
            currentLayout: getEngineLayout(prefix)
          }));
        }
      });
    });
  }

  // ---- Boot ----
  wireEngine('you');
  wireEngine('opp');

  $('weatherPreset').addEventListener('change', syncWeatherPreset);
  ['temp', 'humidity', 'pressure', 'da'].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', updateAirHpStrip);
    el.addEventListener('change', function () {
      if (id !== 'da' && $('weatherPreset')) $('weatherPreset').value = '0';
      updateAirHpStrip();
    });
  });
  if ($('bracketEnabled')) $('bracketEnabled').addEventListener('change', syncBracketUi);
  syncBracketUi();
  syncWeatherPreset();
  updateAirHpStrip();

  if ($('btnSwapLanes')) $('btnSwapLanes').addEventListener('click', swapLanes);
  if ($('btnCopyYouToOpp')) $('btnCopyYouToOpp').addEventListener('click', function () { copyLane('you', 'opp'); });
  if ($('btnCopyOppToYou')) $('btnCopyOppToYou').addEventListener('click', function () { copyLane('opp', 'you'); });
  if ($('btnSwapLanesRace')) $('btnSwapLanesRace').addEventListener('click', function () {
    swapLanes();
    rematch();
  });

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

  if ($('youDriverWeight') && String($('youDriverWeight').value).trim() === '') {
    $('youDriverWeight').value = String(DEFAULT_DRIVER_WEIGHT_LBS);
  }
  if ($('oppDriverWeight') && String($('oppDriverWeight').value).trim() === '') {
    $('oppDriverWeight').value = String(DEFAULT_DRIVER_WEIGHT_LBS);
  }
  syncHpLossUi('you');
  syncHpLossUi('opp');

  renderOppList();
  loadIncomingVehicle();
})();
