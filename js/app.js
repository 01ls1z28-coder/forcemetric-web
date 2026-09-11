/**
 * ForceMetric v1 — UI wiring, garage CRUD, playback (MainForm timer logic)
 */
(function () {
  'use strict';

  var Physics = window.ForceMetricPhysics;
  var GARAGE_STORAGE_KEY = 'forcemetric-garage';

  // Clear any leftover permanent garage saves from older builds.
  try {
    localStorage.removeItem(GARAGE_STORAGE_KEY);
  } catch (e) { /* ignore */ }

  // Session-only garage: always start from baked defaults.
  var garageData = (window.GARAGE_DATA || []).slice();
  var garageEvLocked = false;

  // ---- Elements ----
  var el = {
    hp: document.getElementById('hp'),
    hpLabel: document.getElementById('hpLabel'),
    hpEngine: document.getElementById('hpEngine'),
    hpDynoJet: document.getElementById('hpDynoJet'),
    hpMustang: document.getElementById('hpMustang'),
    weight: document.getElementById('weight'),
    driverWeight: document.getElementById('driverWeight'),
    cd: document.getElementById('cd'),
    area: document.getElementById('area'),
    txAuto: document.getElementById('txAuto'),
    txDct: document.getElementById('txDct'),
    txManual: document.getElementById('txManual'),
    loss: document.getElementById('loss'),
    tireType: document.getElementById('tireType'),
    chkNA: document.getElementById('chkNA'),
    chkFI: document.getElementById('chkFI'),
    chkEv: document.getElementById('chkEv'),
    driveFWD: document.getElementById('driveFWD'),
    driveRWD: document.getElementById('driveRWD'),
    driveAWD: document.getElementById('driveAWD'),
    layoutFront: document.getElementById('layoutFront'),
    layoutMid: document.getElementById('layoutMid'),
    layoutRear: document.getElementById('layoutRear'),
    layoutDual: document.getElementById('layoutDual'),
    diffOpen: document.getElementById('diffOpen'),
    diffLSD: document.getElementById('diffLSD'),
    diffElectronic: document.getElementById('diffElectronic'),
    diffLocker: document.getElementById('diffLocker'),
    activeVehicleLabel: document.getElementById('activeVehicleLabel'),
    editDriveType: document.getElementById('editDriveType'),
    weatherPreset: document.getElementById('weatherPreset'),
    temp: document.getElementById('temp'),
    humidity: document.getElementById('humidity'),
    pressure: document.getElementById('pressure'),
    da: document.getElementById('da'),
    calcTemp: document.getElementById('calcTemp'),
    calcHumidity: document.getElementById('calcHumidity'),
    calcPressure: document.getElementById('calcPressure'),
    calcDAResult: document.getElementById('calcDAResult'),
    resultsOut: document.getElementById('resultsOut'),
    runTimer: document.getElementById('runTimer'),
    distanceFill: document.getElementById('distanceFill'),
    airModeBadge: document.getElementById('airModeBadge'),
    airRhoValue: document.getElementById('airRhoValue'),
    airRhoPct: document.getElementById('airRhoPct'),
    airDaTileLabel: document.getElementById('airDaTileLabel'),
    airDaValue: document.getElementById('airDaValue'),
    airDaUnit: document.getElementById('airDaUnit'),
    airHpFactorValue: document.getElementById('airHpFactorValue'),
    airHpFactorSub: document.getElementById('airHpFactorSub'),
    airHpNote: document.getElementById('airHpNote'),
    garageModal: document.getElementById('garageModal'),
    garageSearch: document.getElementById('garageSearch'),
    carList: document.getElementById('carList'),
    carEditor: document.getElementById('carEditor'),
    editName: document.getElementById('editName'),
    editHp: document.getElementById('editHp'),
    editWeight: document.getElementById('editWeight'),
    editCd: document.getElementById('editCd'),
    editArea: document.getElementById('editArea'),
    editLoss: document.getElementById('editLoss'),
    editTireType: document.getElementById('editTireType'),
    editorTitle: document.getElementById('editorTitle'),
    garageBrand: document.getElementById('garageBrand'),
    garageModel: document.getElementById('garageModel'),
    garageYear: document.getElementById('garageYear'),
    weightLabel: document.getElementById('weightLabel'),
    driverWeightLabel: document.getElementById('driverWeightLabel'),
    daLabel: document.getElementById('daLabel'),
    editWeightLabel: document.getElementById('editWeightLabel'),
    unitsStandard: document.getElementById('unitsStandard'),
    unitsMetric: document.getElementById('unitsMetric')
  };

  var selectedGarageIndex = -1;
  var filteredCars = garageData.slice();
  var editorMode = null; // 'add' | 'edit' | null
  var editingOriginalIndex = -1; // index in garageData for edit
  // ---- Gauge ----
  var gauge = new window.ForceMetricGauge(document.getElementById('speedGauge'));

  // ---- Speed chart (Canvas2D, no Chart.js) ----
  var speedChart = new window.ForceMetricSpeedChart(document.getElementById('speedChart'));

  function ensureChartSized() {
    try {
      speedChart.resize();
    } catch (e) { /* ignore */ }
  }

  // ---- Playback state (mirrors MainForm) ----
  var playbackResult = null;
  var playbackIndex = 0;
  var playbackStart = 0;
  var playbackRaf = null;
  var playbackRunning = false

  function parseNum(input, name) {
    var v = parseFloat(String(input.value).trim());
    if (!isFinite(v)) throw new Error('Invalid value for ' + name + '.');
    return v;
  }

  function mapTireIndex(idx) {
    // Phase 3: 0 Street, 1 Sport, 2 DragTire, 3 Slick
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

  var activeMaxSpeedMph = null;

  // ---- Units (display only; physics stays imperial) ----
  var UNITS_KEY = 'velocitybench-units';
  var unitsMode = 'standard'; // 'standard' | 'metric'
  var LB_PER_KG = 2.2046226218;
  var M_PER_FT = 0.3048;
  var KMH_PER_MPH = 1.609344;

  function isMetric() { return unitsMode === 'metric'; }

  function mphToDisplay(mph) {
    return isMetric() ? mph * KMH_PER_MPH : mph;
  }
  function speedSuffix() { return isMetric() ? 'km/h' : 'mph'; }
  function speedSuffixUpper() { return isMetric() ? 'KM/H' : 'MPH'; }

  function ftToDisplay(ft) {
    return isMetric() ? ft * M_PER_FT : ft;
  }
  function distSuffix() { return isMetric() ? 'm' : 'ft'; }

  function lbToDisplay(lb) {
    return isMetric() ? lb / LB_PER_KG : lb;
  }
  function displayToLb(v) {
    return isMetric() ? v * LB_PER_KG : v;
  }
  function weightSuffix() { return isMetric() ? 'kg' : 'lbs'; }

  function readWeightLbs(inputEl, name) {
    var v = parseNum(inputEl, name);
    return displayToLb(v);
  }

  function setInputWeightLbs(inputEl, lbs) {
    if (!inputEl) return;
    var disp = lbToDisplay(lbs);
    inputEl.value = isMetric()
      ? String(Math.round(disp * 10) / 10)
      : String(Math.round(disp));
  }

  function updateUnitLabels() {
    var wSuf = weightSuffix();
    if (el.weightLabel) el.weightLabel.textContent = 'Curb Weight (' + wSuf + ')';
    if (el.driverWeightLabel) el.driverWeightLabel.textContent = 'Driver Weight (' + wSuf + ')';
    if (el.editWeightLabel) el.editWeightLabel.textContent = 'Weight ' + wSuf;
    if (el.daLabel) el.daLabel.textContent = isMetric() ? 'Density Altitude (m)' : 'Density Altitude (ft)';

    // Progress strip marks (fixed 1/4-mile stations)
    var marks = document.querySelectorAll('.progress-mark[data-ft]');
    for (var i = 0; i < marks.length; i++) {
      var ft = parseFloat(marks[i].getAttribute('data-ft'));
      if (!isFinite(ft)) continue;
      if (isMetric()) {
        var m = ft * M_PER_FT;
        marks[i].textContent = (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1)) + 'm';
      } else {
        marks[i].textContent = (ft === 0 ? "0'" : (String(Math.round(ft)) + "'"));
      }
    }

    if (gauge && gauge.setUnits) gauge.setUnits(isMetric() ? 'metric' : 'standard');
    if (speedChart && speedChart.setSpeedUnit) speedChart.setSpeedUnit(isMetric() ? 'km/h' : 'mph');
    updateAirHpStrip();
  }

  function convertWeightInputsOnToggle(fromMetric) {
    // fromMetric = previous mode was metric
    function conv(inputEl) {
      if (!inputEl) return;
      var raw = parseFloat(String(inputEl.value).trim());
      if (!isFinite(raw)) return;
      var lbs = fromMetric ? raw * LB_PER_KG : raw;
      var next = isMetric() ? lbs / LB_PER_KG : lbs;
      inputEl.value = isMetric()
        ? String(Math.round(next * 10) / 10)
        : String(Math.round(next));
    }
    conv(el.weight);
    conv(el.driverWeight);
    conv(el.editWeight);
    // DA field (ft <-> m) when populated
    if (el.da && String(el.da.value).trim() !== '') {
      var daRaw = parseFloat(String(el.da.value).trim());
      if (isFinite(daRaw)) {
        var daFt = fromMetric ? daRaw / M_PER_FT : daRaw;
        var daDisp = isMetric() ? daFt * M_PER_FT : daFt;
        el.da.value = String(Math.round(daDisp));
      }
    }
    if (el.calcDAResult && el.calcDAResult.textContent && el.calcDAResult.textContent !== '—') {
      var cRaw = parseFloat(String(el.calcDAResult.textContent).replace(/[^\d.\-]/g, ''));
      if (isFinite(cRaw)) {
        var cFt = fromMetric ? cRaw / M_PER_FT : cRaw;
        var cDisp = isMetric() ? cFt * M_PER_FT : cFt;
        el.calcDAResult.textContent = Math.round(cDisp) + ' ' + distSuffix();
      }
    }
  }

  function applyUnitsMode(mode, persist, convertInputs) {
    var prevMetric = isMetric();
    unitsMode = (mode === 'metric') ? 'metric' : 'standard';
    if (el.unitsStandard) el.unitsStandard.checked = !isMetric();
    if (el.unitsMetric) el.unitsMetric.checked = isMetric();
    if (convertInputs && prevMetric !== isMetric()) {
      convertWeightInputsOnToggle(prevMetric);
    }
    updateUnitLabels();
    if (persist !== false) {
      try { localStorage.setItem(UNITS_KEY, unitsMode); } catch (e) { /* ignore */ }
    }
    // Refresh slip / playback displays if a result is present
    if (playbackResult && typeof renderResult === 'function') {
      try { renderResult(playbackResult); } catch (e2) { /* ignore */ }
    }
  }


  function getEngineLayout() {
    if (el.layoutDual && el.layoutDual.checked) return 'Dual';
    if (el.layoutMid && el.layoutMid.checked) return 'Mid';
    if (el.layoutRear && el.layoutRear.checked) return 'Rear';
    return 'Front';
  }

  function setEngineLayout(v) {
    var L = String(v || 'Front');
    if (L !== 'Front' && L !== 'Mid' && L !== 'Rear' && L !== 'Dual') L = 'Front';
    if (el.layoutFront) el.layoutFront.checked = (L === 'Front');
    if (el.layoutMid) el.layoutMid.checked = (L === 'Mid');
    if (el.layoutRear) el.layoutRear.checked = (L === 'Rear');
    if (el.layoutDual) el.layoutDual.checked = (L === 'Dual');
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

  function getDifferential() {
    if (el.diffOpen && el.diffOpen.checked) return 'Open';
    if (el.diffElectronic && el.diffElectronic.checked) return 'Electronic';
    if (el.diffLocker && el.diffLocker.checked) return 'Locker';
    return 'LSD';
  }

  function setDifferential(v) {
    var D = String(v || 'LSD');
    if (D !== 'Open' && D !== 'LSD' && D !== 'Electronic' && D !== 'Locker') D = 'LSD';
    if (el.diffOpen) el.diffOpen.checked = (D === 'Open');
    if (el.diffLSD) el.diffLSD.checked = (D === 'LSD');
    if (el.diffElectronic) el.diffElectronic.checked = (D === 'Electronic');
    if (el.diffLocker) el.diffLocker.checked = (D === 'Locker');
  }

  function getDriveType() {
    if (el.driveAWD && el.driveAWD.checked) return 'AWD';
    if (el.driveFWD && el.driveFWD.checked) return 'FWD';
    return 'RWD';
  }

  function setDriveType(dt) {
    var v = String(dt || 'RWD').toUpperCase();
    if (v !== 'FWD' && v !== 'RWD' && v !== 'AWD') v = 'RWD';
    if (el.driveFWD) el.driveFWD.checked = (v === 'FWD');
    if (el.driveRWD) el.driveRWD.checked = (v === 'RWD');
    if (el.driveAWD) el.driveAWD.checked = (v === 'AWD');
  }

  function getHpSource() {
    if (el.hpDynoJet && el.hpDynoJet.checked) return 'dynojet';
    if (el.hpMustang && el.hpMustang.checked) return 'mustang';
    return 'engine';
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

  function getTransmission() {
    if (el.txManual && el.txManual.checked) return 'manual';
    if (el.txDct && el.txDct.checked) return 'dct';
    return 'auto';
  }

  function setTransmission(tx) {
    var v = normalizeTransmission(tx);
    if (el.txAuto) el.txAuto.checked = (v === 'auto');
    if (el.txDct) el.txDct.checked = (v === 'dct');
    if (el.txManual) el.txManual.checked = (v === 'manual');
  }

  function transmissionSlipLabel(tx) {
    var v = normalizeTransmission(tx);
    if (v === 'manual') return 'Manual';
    if (v === 'dct') return 'Dual Clutch';
    return 'Automatic';
  }

  function bakeTransmissionLabel(tx) {
    var v = normalizeTransmission(tx);
    if (v === 'manual') return 'Manual';
    if (v === 'dct') return 'DCT';
    return 'Auto';
  }

  /** Last TX/drive chosen while curb was heavy; restored after leaving light-curb locks. */
  var lastNonLightTx = 'auto';
  var lastNonLightDrive = 'RWD';
  var lightCurbLocksActive = false;

  var DEFAULT_DRIVER_WEIGHT_LBS = 200;

  function setDriverWeightDefault() {
    setInputWeightLbs(el.driverWeight, DEFAULT_DRIVER_WEIGHT_LBS);
  }

  /** HP = base ± TX; DynoJet/Mustang Dyno WHP = loss 0. Clamp 0–35.
   *  Manual = base−2; DCT = base−1; Auto = base. */
  function transmissionLossDelta(tx) {
    var v = normalizeTransmission(tx == null ? getTransmission() : tx);
    if (v === 'manual') return -2;
    if (v === 'dct') return -1;
    return 0;
  }

  function computeEffectiveLoss() {
    var source = getHpSource();
    if (source === 'dynojet' || source === 'mustang') return 0;
    var base = parseFloat(el.loss.value);
    if (Number.isNaN(base)) base = 15;
    var eff = base + transmissionLossDelta();
    if (eff < 0) eff = 0;
    if (eff > 35) eff = 35;
    return eff;
  }

  /** Mustang Dyno WHP: typed × 1.05 boost; DynoJet/Engine unchanged. */
  function resolveRunHorsepower(typedHp) {
    if (getHpSource() === 'mustang') return typedHp * 1.05;
    return typedHp;
  }

  function isLightCurb() {
    var curb = parseFloat(el.weight && el.weight.value);
    if (!isFinite(curb)) curb = isMetric() ? (3800 / LB_PER_KG) : 3800;
    curb = displayToLb(curb);
    return curb <= 1500;
  }

  function isEvMode() {
    return !!(el.chkEv && el.chkEv.checked);
  }

  /** Live Air / HP strip — same DA + weather-HP math as Physics.calculate. */
  function updateAirHpStrip() {
    if (!Physics || !Physics.computeWeatherAirState) return;
    if (!el.airRhoValue) return;

    var tempF = parseFloat(el.temp && el.temp.value);
    var humidity = parseFloat(el.humidity && el.humidity.value);
    var pressure = parseFloat(el.pressure && el.pressure.value);
    if (!isFinite(tempF)) tempF = 59;
    if (!isFinite(humidity)) humidity = 40;
    if (!isFinite(pressure)) pressure = 29.92;

    var daInput = NaN;
    if (el.da && String(el.da.value).trim() !== '') {
      var daRaw = parseFloat(String(el.da.value).trim());
      if (isFinite(daRaw)) {
        daInput = isMetric() ? daRaw / M_PER_FT : daRaw;
      }
    }

    var state = Physics.computeWeatherAirState({
      tempF: tempF,
      humidity: humidity,
      pressureInHg: pressure,
      densityAltitudeFtInput: daInput,
      isEv: !!(el.chkEv && el.chkEv.checked),
      isNA: !!(el.chkNA && el.chkNA.checked),
      isFI: !!(el.chkFI && el.chkFI.checked)
    });

    var rho = state.airDensity;
    el.airRhoValue.textContent = rho.toFixed(3);
    el.airRhoPct.textContent = (Math.round(state.densityPctOfStd * 10) / 10).toFixed(1) + '% std';

    var daDisp = isMetric() ? state.densityAltitudeFt * M_PER_FT : state.densityAltitudeFt;
    el.airDaValue.textContent = String(Math.round(daDisp));
    el.airDaUnit.textContent = isMetric() ? 'm' : 'ft';
    if (el.airDaTileLabel) el.airDaTileLabel.textContent = 'DA';

    var factorPct = state.weatherHpFactor * 100.0;
    el.airHpFactorValue.textContent = (Math.round(factorPct * 10) / 10).toFixed(1) + '%';
    if (el.airHpFactorSub) {
      el.airHpFactorSub.textContent = state.mode === 'EV'
        ? 'no HP weather derate'
        : 'eff. WHP vs std air';
    }

    var badge = el.airModeBadge;
    if (badge) {
      badge.textContent = state.mode;
      badge.setAttribute('data-mode', state.mode);
    }

    if (el.airHpNote) {
      var foot = 'Compiled estimate from current weather model — not dyno lab cert.';
      if (state.mode === 'EV') {
        el.airHpNote.textContent = state.note + ' ' + foot;
      } else {
        el.airHpNote.textContent = foot;
      }
    }
  }

  /** TX/drive locks: EV → Auto (DCT+Manual disabled); else light curb → Manual+RWD; else free.
   *  EV Auto lock wins over light-curb Manual when IsEv.
   *  Remembers last non-light TX+drive (incl. dct); restores only when leaving light curb (non-EV). */
  function applyLightCurbLocks() {
    var ev = isEvMode();
    var light = isLightCurb();
    var leavingLight = lightCurbLocksActive && !light;

    /* Capture TX/drive before light-curb snaps overwrite them.
     * Skip while light locks are already active (and while leaving — radios still Manual+RWD). */
    if (!lightCurbLocksActive) {
      if (!ev) lastNonLightTx = getTransmission();
      lastNonLightDrive = getDriveType();
    }

    if (ev) {
      /* EV priority: Automatic locked on; DCT + Manual disabled (even if light curb). */
      if (el.txAuto) {
        el.txAuto.checked = true;
        el.txAuto.disabled = false;
      }
      if (el.txDct) {
        el.txDct.checked = false;
        el.txDct.disabled = true;
      }
      if (el.txManual) {
        el.txManual.checked = false;
        el.txManual.disabled = true;
      }
    } else if (light) {
      /* Light curb / bikes: Manual-only (DCT + Auto disabled). */
      if (el.txManual) {
        el.txManual.checked = true;
        el.txManual.disabled = false;
      }
      if (el.txAuto) {
        el.txAuto.checked = false;
        el.txAuto.disabled = true;
      }
      if (el.txDct) {
        el.txDct.checked = false;
        el.txDct.disabled = true;
      }
    } else {
      if (el.txAuto) el.txAuto.disabled = false;
      if (el.txDct) el.txDct.disabled = false;
      if (el.txManual) el.txManual.disabled = false;
      if (leavingLight) setTransmission(lastNonLightTx);
    }

    /* Light curb (bikes): RWD lock; EVs are typically heavy so drive stays free when not light. */
    if (light) {
      setDriveType('RWD');
      if (el.driveFWD) el.driveFWD.disabled = true;
      if (el.driveAWD) el.driveAWD.disabled = true;
      if (el.driveRWD) el.driveRWD.disabled = false;
    } else {
      if (el.driveFWD) el.driveFWD.disabled = false;
      if (el.driveRWD) el.driveRWD.disabled = false;
      if (el.driveAWD) el.driveAWD.disabled = false;
      if (leavingLight) setDriveType(lastNonLightDrive);
    }

    lightCurbLocksActive = light;
  }

  function syncHpLossUi() {
    var source = getHpSource();
    var labels = {
      engine: 'HP',
      dynojet: 'DynoJet WHP',
      mustang: 'Mustang Dyno WHP'
    };
    if (el.hpLabel) el.hpLabel.textContent = labels[source] || 'HP';

    var lockLoss = source !== 'engine';
    if (el.loss) {
      el.loss.disabled = lockLoss;
      el.loss.classList.toggle('is-locked', lockLoss);
    }
    /* TX selectable on all HP sources for heavy cars; light curb stays Manual-only. */
    applyLightCurbLocks();
  }

  /** Parse "2020 Ford Mustang GT" → { year, make, model, label } */
  function parseVehicleName(name) {
    var raw = String(name || '').trim();
    if (!raw) {
      return { year: null, make: null, model: null, label: 'Custom setup' };
    }
    var m = raw.match(/^(\d{4})\s+(.+)$/);
    if (!m) {
      return { year: null, make: null, model: null, label: raw };
    }
    var year = m[1];
    var rest = m[2].trim();
    var parts = rest.split(/\s+/);
    if (parts.length < 2) {
      return { year: year, make: null, model: rest, label: raw };
    }
    var make = parts[0];
    var model = parts.slice(1).join(' ');
    return {
      year: year,
      make: make,
      model: model,
      label: year + ' ' + make + ' ' + model
    };
  }

  function setActiveVehicleLabel(name) {
    if (!el.activeVehicleLabel) return;
    var parsed = parseVehicleName(name);
    el.activeVehicleLabel.textContent = parsed.label || 'Custom setup';
    el.activeVehicleLabel.title = parsed.label || 'Custom setup';
  }

  function fmt2(n) {
    return n.toFixed(2);
  }

  function fmt1(n) {
    return n.toFixed(1);
  }

  function slipLine(label, value) {
    label = String(label);
    value = String(value);
    var width = 34; // monospace columns — fills slip, less empty right
    var dots = width - label.length - value.length;
    if (dots < 2) dots = 2;
    return '  ' + label + ' ' + Array(dots + 1).join('.') + ' ' + value;
  }

  function renderResult(result) {
    var lines = [];
    var vehicle = (el.activeVehicleLabel && el.activeVehicleLabel.textContent) || 'Custom setup';
    lines.push('  VELOCITYBENCH TIME SLIP');
    lines.push('  -----------------------');
    lines.push(slipLine('VEHICLE', vehicle.slice(0, 22)));
    lines.push(slipLine('PRINTED', result.Timestamp.toLocaleString()));

    var engineLabel = 'Unspecified';
    if (el.chkEv.checked) {
      engineLabel = 'EV';
    } else if (el.chkNA.checked && !el.chkFI.checked) {
      engineLabel = 'N/A';
    } else if (el.chkFI.checked && !el.chkNA.checked) {
      engineLabel = 'Forced ind.';
    }
    lines.push(slipLine(el.chkEv && el.chkEv.checked ? 'MOTOR' : 'ENGINE', engineLabel));
    var srcHp = getHpSource();
    var srcLabel = srcHp === 'dynojet' ? 'DynoJet WHP' : (srcHp === 'mustang' ? 'Mustang Dyno WHP' : 'HP');
    lines.push(slipLine('HP SOURCE', srcLabel));
    lines.push(slipLine('TRANS', transmissionSlipLabel(getTransmission())));
    var dwDisp = parseFloat(el.driverWeight && el.driverWeight.value) || 0;
    if (dwDisp > 0) {
      lines.push(slipLine('DRIVER WT', Math.round(dwDisp) + ' ' + (isMetric() ? 'kg' : 'lb')));
    }
    lines.push('  -----------------------');

    function mark(ft, label) {
      var val = result.DistanceMarkers[ft];
      var distLabel = label;
      if (isMetric() && /FT|MILE/.test(label)) {
        if (label === '1 MILE') distLabel = '1.6 KM';
        else {
          var m = Math.round(ft * M_PER_FT);
          distLabel = m + ' M';
        }
      }
      if (val && val.Time >= 0) {
        lines.push(slipLine(distLabel, fmt2(val.Time) + ' s'));
        lines.push(slipLine(distLabel + ' ' + speedSuffixUpper(), fmt1(mphToDisplay(val.SpeedMph))));
      } else {
        lines.push(slipLine(distLabel, '--'));
      }
    }

    mark(60, '60 FT');
    mark(330, '330 FT');
    mark(660, '1/8');
    mark(1000, '1000 FT');
    mark(1320, '1/4');
    mark(2640, '1/2');
    mark(5280, '1 MILE');

    lines.push('  -----------------------');
    if (isMetric()) {
      if (result.ZeroToSixty != null) lines.push(slipLine('0-' + Math.round(60 * KMH_PER_MPH) + ' KM/H', fmt2(result.ZeroToSixty) + ' s'));
      if (result.ZeroToHundred != null) lines.push(slipLine('0-' + Math.round(100 * KMH_PER_MPH) + ' KM/H', fmt2(result.ZeroToHundred) + ' s'));
      if (result.ZeroToOneThirty != null) lines.push(slipLine('0-' + Math.round(130 * KMH_PER_MPH) + ' KM/H', fmt2(result.ZeroToOneThirty) + ' s'));
      if (result.SixtyToOneThirty != null) lines.push(slipLine(Math.round(60 * KMH_PER_MPH) + '-' + Math.round(130 * KMH_PER_MPH), fmt2(result.SixtyToOneThirty) + ' s'));
      if (result.HundredToOneFifty != null) lines.push(slipLine(Math.round(100 * KMH_PER_MPH) + '-' + Math.round(150 * KMH_PER_MPH), fmt2(result.HundredToOneFifty) + ' s'));
    } else {
      if (result.ZeroToSixty != null) lines.push(slipLine('0-60 MPH', fmt2(result.ZeroToSixty) + ' s'));
      if (result.ZeroToHundred != null) lines.push(slipLine('0-100 MPH', fmt2(result.ZeroToHundred) + ' s'));
      if (result.ZeroToOneThirty != null) lines.push(slipLine('0-130 MPH', fmt2(result.ZeroToOneThirty) + ' s'));
      if (result.SixtyToOneThirty != null) lines.push(slipLine('60-130', fmt2(result.SixtyToOneThirty) + ' s'));
      if (result.HundredToOneFifty != null) lines.push(slipLine('100-150', fmt2(result.HundredToOneFifty) + ' s'));
    }
    if (result.HundredToTwoHundredKmh != null) lines.push(slipLine('100-200 KM/H', fmt2(result.HundredToTwoHundredKmh) + ' s'));
    if (result.TwoHundredToTwoFiftyKmh != null) lines.push(slipLine('200-250 KM/H', fmt2(result.TwoHundredToTwoFiftyKmh) + ' s'));

    lines.push('  -----------------------');
    if (result.RunDistanceFt != null) {
      lines.push(slipLine('RUN DIST', fmt1(ftToDisplay(result.RunDistanceFt)) + ' ' + distSuffix()));
    }
    if (result.RunTimeS != null) {
      lines.push(slipLine('RUN TIME', fmt2(result.RunTimeS) + ' s'));
    }
    if (result.StopReason === 'vmax') {
      lines.push(slipLine('STOP', 'mech top speed'));
    } else if (result.StopReason === 'safety') {
      lines.push(slipLine('STOP', 'safety limit'));
    }

    lines.push('  -----------------------');
    lines.push('  0-X ' + speedSuffixUpper() + ' BREAKDOWN');
    var keys = Object.keys(result.ZeroToMphTimes).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var tv = result.ZeroToMphTimes[k];
      if (k >= 0 && tv >= 0) {
        var kLabel = isMetric() ? Math.round(k * KMH_PER_MPH) : k;
        lines.push(slipLine('0-' + kLabel, fmt2(tv) + ' s'));
      }
    }
    lines.push('  -----------------------');
    lines.push('  Estimates — not lab ET');

    el.resultsOut.textContent = lines.join('\n');
  }

  function stopPlaybackLoop() {
    playbackRunning = false;
    if (playbackRaf) {
      cancelAnimationFrame(playbackRaf);
      playbackRaf = null;
    }
  }

  function startPlayback(result) {
    if (!result || !result.Steps || !result.Steps.length) return;

    stopPlaybackLoop();

    playbackResult = result;
    playbackIndex = 0;

    gauge.setValue(0);
    el.runTimer.textContent = '0.00 s';
    el.distanceFill.style.width = '0%';

    // Full curve immediately — do not wait for playback end
    speedChart.clear();
    speedChart.setSeries(result.Steps);
    if (speedChart.setSpeedUnit) speedChart.setSpeedUnit(isMetric() ? 'km/h' : 'mph');
    speedChart.setPlaybackTime(0);
    ensureChartSized();

    playbackStart = performance.now();
    playbackRunning = true;
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function playbackTick(now) {
    if (!playbackRunning) return;

    if (!playbackResult || !playbackResult.Steps || !playbackResult.Steps.length) {
      stopPlaybackLoop();
      return;
    }

    var steps = playbackResult.Steps;
    if (playbackIndex >= steps.length) {
      speedChart.setPlaybackTime(steps[steps.length - 1].Time);
      stopPlaybackLoop();
      return;
    }

    var elapsed = (now - playbackStart) / 1000.0;
    var advanced = false;
    var lastStep = steps[playbackIndex];

    while (playbackIndex < steps.length && steps[playbackIndex].Time <= elapsed) {
      lastStep = steps[playbackIndex];
      playbackIndex++;
      advanced = true;
    }

    if (advanced) {
      var spd = Math.round(mphToDisplay(lastStep.SpeedMph));
      spd = Math.max(0, Math.min(spd, gauge.maxValue));
      gauge.setValue(spd);

      el.runTimer.textContent = fmt2(lastStep.Time) + ' s';

      // Progress bar is a 0–1320' (1/4 mile) scale so marks and fill stay in sync
      var ft = Math.max(0, Math.min(lastStep.DistanceFt, 1320));
      el.distanceFill.style.width = ((ft / 1320) * 100).toFixed(2) + '%';

      speedChart.setPlaybackTime(lastStep.Time);
    }

    if (playbackIndex >= steps.length) {
      speedChart.setPlaybackTime(steps[steps.length - 1].Time);
      stopPlaybackLoop();
      return;
    }

    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function runTest() {
    try {
      var horsepower = parseNum(el.hp, el.hpLabel ? el.hpLabel.textContent : 'Horsepower');
      var curbWeight = readWeightLbs(el.weight, 'Curb Weight');
      var driverWeight = 0;
      if (el.driverWeight && String(el.driverWeight.value).trim() !== '') {
        driverWeight = readWeightLbs(el.driverWeight, 'Driver Weight');
      }
      if (driverWeight < 0) throw new Error('Driver Weight must be ≥ 0.');
      /* Cars: curb already includes ~200 lb driver baseline in Dragy-matched specs.
         Subtract 200 then add Driver Weight so Driver 200 ≈ old mass; Driver 0 = 200 lb lighter.
         Light curb (≤1500 lb, bikes etc.) uses −115 instead. */
      var weight;
      if (curbWeight > 1500) {
        weight = curbWeight - 200 + driverWeight;
      } else {
        /* Light curb (bikes etc.): same baseline idea as cars, −115. */
        weight = curbWeight - 115 + driverWeight;
      }
      if (weight < 100) weight = 100;
      var cd = parseNum(el.cd, 'Drag Coefficient');
      var frontalArea = parseNum(el.area, 'Frontal Area');
      syncHpLossUi();
      var drivetrainLossPercent = computeEffectiveLoss();
      horsepower = resolveRunHorsepower(horsepower);
      var tempF = parseNum(el.temp, 'Temperature');
      var humidity = parseNum(el.humidity, 'Humidity');
      var pressure = parseNum(el.pressure, 'Pressure');

      var daInput = NaN;
      if (String(el.da.value).trim() !== '') {
        daInput = parseNum(el.da, 'Density Altitude');
        if (isMetric()) daInput = daInput / M_PER_FT;
      }

      var tireType = mapTireIndex(parseInt(el.tireType.value, 10));

      var calcOpts = {
        hp: horsepower,
        weightLbs: weight,
        tireType: tireType,
        Cd: cd,
        frontalAreaSqFt: frontalArea,
        drivetrainLoss: drivetrainLossPercent,
        driveType: getDriveType(),
        engineLayout: getEngineLayout(),
        differential: getDifferential(),
        isEv: el.chkEv.checked,
        tempF: tempF,
        humidity: humidity,
        pressureInHg: pressure,
        densityAltitudeFtInput: daInput,
        isNA: el.chkNA.checked,
        isFI: el.chkFI.checked,
        timestamp: new Date()
      };
      if (activeMaxSpeedMph != null && isFinite(activeMaxSpeedMph) && activeMaxSpeedMph > 0) {
        calcOpts.maxSpeedMph = activeMaxSpeedMph;
      }
      var result = Physics.calculate(calcOpts);

      renderResult(result);
      startPlayback(result);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  // ---- Events ----
  document.getElementById('btnTest').addEventListener('click', runTest);

  function snapshotActiveVehicle() {
    var label = (el.activeVehicleLabel && el.activeVehicleLabel.textContent) || 'Custom setup';
    var dw = DEFAULT_DRIVER_WEIGHT_LBS;
    if (el.driverWeight && String(el.driverWeight.value).trim() !== '') {
      var dwp = parseFloat(el.driverWeight.value);
      if (isFinite(dwp)) dw = displayToLb(dwp);
    }
    return {
      Name: label,
      Horsepower: parseFloat(el.hp.value) || 450,
      WeightLbs: (function () {
        var w = parseFloat(el.weight.value);
        if (!isFinite(w)) return 3800;
        return displayToLb(w);
      })(),
      DriverWeightLbs: dw,
      DragCoefficient: parseFloat(el.cd.value) || 0.32,
      FrontalAreaSqFt: parseFloat(el.area.value) || 22,
      DrivetrainLossPercent: parseFloat(el.loss.value) || 15,
      TireType: parseInt(el.tireType.value, 10) || 0,
      DriveType: getDriveType(),
      EngineLayout: getEngineLayout(),
      Differential: getDifferential(),
      Transmission: bakeTransmissionLabel(getTransmission()),
      HpSource: getHpSource(),
      isNA: !!(el.chkNA && el.chkNA.checked),
      isFI: !!(el.chkFI && el.chkFI.checked),
      isEv: !!(el.chkEv && el.chkEv.checked),
      MaxSpeedMph: (activeMaxSpeedMph != null && isFinite(activeMaxSpeedMph)) ? activeMaxSpeedMph : undefined,
      tempF: parseFloat(el.temp.value),
      humidity: parseFloat(el.humidity.value),
      pressureInHg: parseFloat(el.pressure.value),
      weatherPreset: el.weatherPreset ? el.weatherPreset.value : '0'
    };
  }

  var btnDrag = document.getElementById('btnDragRace');
  if (btnDrag) {
    btnDrag.addEventListener('click', function () {
      try {
        var snap = snapshotActiveVehicle();
        sessionStorage.setItem('forcemetric-race-vehicle', JSON.stringify(snap));
      } catch (e) { /* ignore quota / private mode */ }
      var q = '';
      try {
        var n = (el.activeVehicleLabel && el.activeVehicleLabel.textContent) || '';
        if (n && n !== 'Custom setup') q = '?car=' + encodeURIComponent(n);
      } catch (e2) { /* ignore */ }
      window.location.href = 'race.html' + q;
    });
  }

  document.getElementById('btnGenerateDA').addEventListener('click', function () {
    try {
      var tempF = parseNum(el.calcTemp, 'Calc Temp');
      var humidity = parseNum(el.calcHumidity, 'Calc Humidity');
      var pressure = parseNum(el.calcPressure, 'Calc Pressure');
      var daFt = Physics.computeDensityAltitude(tempF, humidity, pressure);
      var daDisp = isMetric() ? daFt * M_PER_FT : daFt;
      el.calcDAResult.textContent = Math.round(daDisp) + ' ' + distSuffix();
      el.da.value = Math.round(daDisp).toString();
      updateAirHpStrip();
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  el.weatherPreset.addEventListener('change', function () {
    switch (parseInt(el.weatherPreset.value, 10)) {
      case 1:
        el.temp.value = '59';
        el.humidity.value = '0';
        el.pressure.value = '29.92';
        el.da.value = '';
        break;
      case 2:
        el.temp.value = '90';
        el.humidity.value = '60';
        el.pressure.value = '29.50';
        el.da.value = '';
        break;
      case 3:
        el.temp.value = '50';
        el.humidity.value = '40';
        el.pressure.value = '30.10';
        el.da.value = '';
        break;
    }
    updateAirHpStrip();
  });

  function weatherFieldChanged() {
    el.da.value = '';
    updateAirHpStrip();
  }
  el.temp.addEventListener('input', weatherFieldChanged);
  el.humidity.addEventListener('input', weatherFieldChanged);
  el.pressure.addEventListener('input', weatherFieldChanged);
  if (el.da) el.da.addEventListener('input', updateAirHpStrip);

  el.chkNA.addEventListener('change', function () {
    if (el.chkNA.checked) el.chkFI.checked = false;
    updateAirHpStrip();
  });
  el.chkFI.addEventListener('change', function () {
    if (el.chkFI.checked) el.chkNA.checked = false;
    updateAirHpStrip();
  });

  el.chkEv.addEventListener('change', function () {
    if (garageEvLocked) {
      el.chkEv.checked = true;
      applyLightCurbLocks();
      updateAirHpStrip();
      return;
    }
    if (el.chkEv.checked) {
      el.chkNA.checked = false;
      el.chkFI.checked = false;
      el.chkNA.disabled = true;
      el.chkFI.disabled = true;
      setEngineLayout(bakeEvEngineLayout(getDriveType(), {
        preserveMid: true,
        currentLayout: getEngineLayout()
      }));
      /* Preserve user drivetrain loss % and tire selection across EV toggle. */
      el.resultsOut.textContent += '\nEV Mode enabled.';
    } else {
      el.chkNA.disabled = false;
      el.chkFI.disabled = false;
      el.resultsOut.textContent += '\nEV Mode disabled.';
    }
    applyLightCurbLocks();
    updateAirHpStrip();
  });

  function onDriveTypeChange() {
    var dt = getDriveType();
    if (el.chkEv && el.chkEv.checked) {
      setEngineLayout(bakeEvEngineLayout(dt, {
        preserveMid: true,
        currentLayout: getEngineLayout()
      }));
    }
    el.resultsOut.textContent += '\nDrivetrain: ' + dt + '.';
  }
  if (el.driveFWD) el.driveFWD.addEventListener('change', onDriveTypeChange);
  if (el.driveRWD) el.driveRWD.addEventListener('change', onDriveTypeChange);
  if (el.driveAWD) el.driveAWD.addEventListener('change', onDriveTypeChange);

  function onHpSourceOrTxChange() {
    syncHpLossUi();
    updateAirHpStrip();
  }
  if (el.hpEngine) el.hpEngine.addEventListener('change', onHpSourceOrTxChange);
  if (el.hpDynoJet) el.hpDynoJet.addEventListener('change', onHpSourceOrTxChange);
  if (el.hpMustang) el.hpMustang.addEventListener('change', onHpSourceOrTxChange);
  if (el.txAuto) el.txAuto.addEventListener('change', onHpSourceOrTxChange);
  if (el.txDct) el.txDct.addEventListener('change', onHpSourceOrTxChange);
  if (el.txManual) el.txManual.addEventListener('change', onHpSourceOrTxChange);
  if (el.loss) el.loss.addEventListener('input', function () {
    syncHpLossUi();
    updateAirHpStrip();
  });
  /* Curb light-locks on change/blur only — never mid-keystroke (e.g. 6200→620→6200). */
  if (el.weight) {
    el.weight.addEventListener('change', syncTransmissionForCurb);
    el.weight.addEventListener('blur', syncTransmissionForCurb);
  }
  setDriverWeightDefault();
  syncHpLossUi();
  syncTransmissionForCurb();
  updateAirHpStrip();

  document.getElementById('btnPlay').addEventListener('click', function () {
    if (!playbackResult || !playbackResult.Steps || !playbackResult.Steps.length) return;
    if (playbackIndex >= playbackResult.Steps.length) return;
    var currentTime = playbackResult.Steps[playbackIndex].Time;
    playbackStart = performance.now() - currentTime * 1000;
    if (!playbackRunning) {
      playbackRunning = true;
      playbackRaf = requestAnimationFrame(playbackTick);
    }
  });

  document.getElementById('btnPause').addEventListener('click', function () {
    stopPlaybackLoop();
  });

  document.getElementById('btnReplay').addEventListener('click', function () {
    if (!playbackResult) return;
    startPlayback(playbackResult);
  });

  // ---- Garage (session-only; no localStorage persistence) ----
  var MULTI_WORD_MAKES = [
    'Aston Martin', 'Range Rover', 'Land Rover', 'Alfa Romeo',
    'Mercedes-AMG', 'Mercedes-Benz', 'Rolls-Royce'
  ];

  function parseGarageMeta(name) {
    var raw = String(name || '').trim();
    var m = raw.match(/^(\d{4})\s+(.+)$/);
    if (!m) {
      return { year: '', brand: 'Other', model: raw || 'Unknown' };
    }
    var year = m[1];
    var rest = m[2].trim();
    // Strip odd "2011 - 2014 …" range prefixes
    rest = rest.replace(/^-\s*\d{4}\s+/, '').replace(/^-\s+/, '');
    var brand = '';
    var model = '';
    var lower = rest.toLowerCase();
    for (var i = 0; i < MULTI_WORD_MAKES.length; i++) {
      var mw = MULTI_WORD_MAKES[i];
      if (lower.indexOf(mw.toLowerCase()) === 0) {
        brand = mw;
        model = rest.slice(mw.length).trim();
        break;
      }
    }
    if (!brand) {
      var parts = rest.split(/\s+/);
      if (parts.length < 2) {
        brand = 'Other';
        model = rest;
      } else {
        brand = parts[0];
        model = parts.slice(1).join(' ');
      }
    }
    if (!model) model = brand;
    return { year: year, brand: brand, model: model };
  }

  function isCustomCar(car) {
    return !!(car && car.IsCustom);
  }

  function getFilterBrand() {
    return el.garageBrand ? String(el.garageBrand.value || '') : '';
  }
  function getFilterModel() {
    return el.garageModel ? String(el.garageModel.value || '') : '';
  }
  function getFilterYear() {
    return el.garageYear ? String(el.garageYear.value || '') : '';
  }

  function fillSelect(selectEl, values, placeholder, selected) {
    if (!selectEl) return;
    var html = '<option value="">' + escapeHtml(placeholder) + '</option>';
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var sel = v === selected ? ' selected' : '';
      html += '<option value="' + escapeHtml(v) + '"' + sel + '>' + escapeHtml(v) + '</option>';
    }
    selectEl.innerHTML = html;
  }

  function rebuildGarageFilterOptions() {
    var brandSel = getFilterBrand();
    var modelSel = getFilterModel();
    var yearSel = getFilterYear();

    var brands = {};
    var models = {};
    var years = {};

    for (var i = 0; i < garageData.length; i++) {
      var meta = parseGarageMeta(garageData[i].Name);
      brands[meta.brand] = true;
      if (!brandSel || meta.brand === brandSel) {
        models[meta.model] = true;
        if (!modelSel || meta.model === modelSel) {
          if (meta.year) years[meta.year] = true;
        }
      }
    }

    var brandList = Object.keys(brands).sort(function (a, b) {
      return a.localeCompare(b);
    });
    var modelList = Object.keys(models).sort(function (a, b) {
      return a.localeCompare(b);
    });
    var yearList = Object.keys(years).sort(function (a, b) {
      return Number(b) - Number(a);
    });

    if (brandSel && brandList.indexOf(brandSel) < 0) brandSel = '';
    if (modelSel && modelList.indexOf(modelSel) < 0) modelSel = '';
    if (yearSel && yearList.indexOf(yearSel) < 0) yearSel = '';

    fillSelect(el.garageBrand, brandList, 'All brands', brandSel);
    fillSelect(el.garageModel, modelList, 'All models', modelSel);
    fillSelect(el.garageYear, yearList, 'All years', yearSel);

    if (el.garageModel) el.garageModel.disabled = !brandSel;
    if (el.garageYear) el.garageYear.disabled = !brandSel || !modelSel;
  }

  function refreshFilteredFromSearch() {
    var q = (el.garageSearch.value || '').toLowerCase();
    var brand = getFilterBrand();
    var model = getFilterModel();
    var year = getFilterYear();
    filteredCars = garageData.filter(function (c) {
      if (q && String(c.Name).toLowerCase().indexOf(q) === -1) return false;
      var meta = parseGarageMeta(c.Name);
      if (brand && meta.brand !== brand) return false;
      if (model && meta.model !== model) return false;
      if (year && meta.year !== year) return false;
      return true;
    });
  }

  function openGarage() {
    el.garageSearch.value = '';
    if (el.garageBrand) el.garageBrand.value = '';
    if (el.garageModel) el.garageModel.value = '';
    if (el.garageYear) el.garageYear.value = '';
    rebuildGarageFilterOptions();
    filteredCars = garageData.slice();
    selectedGarageIndex = -1;
    hideCarEditor();
    renderCarList();
    el.garageModal.classList.add('open');
    el.garageSearch.focus();
    setTimeout(ensureChartSized, 0);
  }

  function closeGarage() {
    hideCarEditor();
    el.garageModal.classList.remove('open');
    setTimeout(ensureChartSized, 50);
  }

  function renderCarList() {
    var customs = [];
    var baked = [];
    for (var i = 0; i < filteredCars.length; i++) {
      var item = { car: filteredCars[i], idx: i };
      if (isCustomCar(filteredCars[i])) customs.push(item);
      else baked.push(item);
    }
    var html = '';
    function renderItems(arr) {
      for (var j = 0; j < arr.length; j++) {
        var c = arr[j].car;
        var idx = arr[j].idx;
        var sel = idx === selectedGarageIndex ? ' selected' : '';
        html += '<li class="' + sel.trim() + '" data-idx="' + idx + '">' + escapeHtml(c.Name) + '</li>';
      }
    }
    if (customs.length) {
      html += '<li class="car-list-section">Custom Vehicles Added</li>';
      renderItems(customs);
    }
    if (customs.length && baked.length) {
      html += '<li class="car-list-section">Fleet</li>';
    }
    renderItems(baked);
    if (html) {
      el.carList.innerHTML = html;
    } else {
      var q = (el.garageSearch && el.garageSearch.value) ? String(el.garageSearch.value).trim() : '';
      var hint = q
        ? ('No garage match for “' + escapeHtml(q) + '”.')
        : 'No vehicles match these filters.';
      el.carList.innerHTML =
        '<li class="garage-empty">' +
          '<div class="garage-empty-title">Vehicle not in garage</div>' +
          '<div class="garage-empty-hint">' + hint + '</div>' +
          '<button type="button" class="btn-request-vehicle" id="btnRequestVehicle">Request this vehicle</button>' +
        '</li>';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function indexInGarageData(car) {
    return garageData.indexOf(car);
  }

  el.carList.addEventListener('click', function (e) {
    var req = e.target.closest('#btnRequestVehicle, .btn-request-vehicle');
    if (req) {
      e.preventDefault();
      var q = (el.garageSearch && el.garageSearch.value) ? String(el.garageSearch.value).trim() : '';
      openSupport('garage', { query: q });
      return;
    }
    var li = e.target.closest('li[data-idx]');
    if (!li) return;
    selectedGarageIndex = parseInt(li.getAttribute('data-idx'), 10);
    renderCarList();
  });

  el.carList.addEventListener('dblclick', function (e) {
    var li = e.target.closest('li[data-idx]');
    if (!li) return;
    selectedGarageIndex = parseInt(li.getAttribute('data-idx'), 10);
    loadSelectedVehicle();
  });

  el.garageSearch.addEventListener('input', function () {
    refreshFilteredFromSearch();
    selectedGarageIndex = -1;
    renderCarList();
  });

  function onGarageFilterChange(level) {
    if (level === 'brand') {
      if (el.garageModel) el.garageModel.value = '';
      if (el.garageYear) el.garageYear.value = '';
    } else if (level === 'model') {
      if (el.garageYear) el.garageYear.value = '';
    }
    rebuildGarageFilterOptions();
    refreshFilteredFromSearch();
    selectedGarageIndex = -1;
    renderCarList();
  }
  if (el.garageBrand) {
    el.garageBrand.addEventListener('change', function () { onGarageFilterChange('brand'); });
  }
  if (el.garageModel) {
    el.garageModel.addEventListener('change', function () { onGarageFilterChange('model'); });
  }
  if (el.garageYear) {
    el.garageYear.addEventListener('change', function () { onGarageFilterChange('year'); });
  }

  function looksLikeEv(name) {
    var n = String(name || '').toLowerCase();
    return /\btesla\b|\blucid\b|\brivian\b|\bpolestar\b|\brimac\b|\btaycan\b|\bcybertruck\b|\bplaid\b|e-tron|ioniq|\beq[sbe]\b|mach-e|\bev\b|electric|ariya|solterra|bz4x|lyriq|blazer ev|fisker|kona electric|niro ev|id\.4|ex90|gv60|lightning|eqe|eqs|eqb/.test(n);
  }

  function carIsEv(car) {
    if (!car) return false;
    if (typeof car.IsEv === 'boolean') return car.IsEv;
    return looksLikeEv(car.Name);
  }

  function carIsFi(car) {
    if (!car) return false;
    if (typeof car.IsForcedInduction === 'boolean') return !!car.IsForcedInduction;
    return false;
  }

  /** Light curb / bikes: Manual + RWD only. Heavier cars keep TX and drive choices. */
  function syncTransmissionForCurb() {
    applyLightCurbLocks();
    if (typeof syncHpLossUi === 'function') syncHpLossUi();
  }

  function applyGaragePowertrain(car) {
    var isEv = carIsEv(car);
    var isFi = !isEv && carIsFi(car);
    garageEvLocked = isEv;
    if (!el.chkEv) return;
    el.chkEv.checked = isEv;
    el.chkEv.disabled = isEv; /* locked on for garage EVs */
    if (isEv) {
      el.chkNA.checked = false;
      el.chkFI.checked = false;
      el.chkNA.disabled = true;
      el.chkFI.disabled = true;
    } else {
      el.chkNA.disabled = false;
      el.chkFI.disabled = false;
      el.chkFI.checked = isFi;
      el.chkNA.checked = !isFi;
    }
    updateAirHpStrip();
  }

  function setEvChecked(on) {
    if (!el.chkEv) return;
    if (garageEvLocked && !on) {
      el.chkEv.checked = true;
      applyLightCurbLocks();
      updateAirHpStrip();
      return;
    }
    el.chkEv.checked = !!on;
    if (on) {
      el.chkNA.checked = false;
      el.chkFI.checked = false;
      el.chkNA.disabled = true;
      el.chkFI.disabled = true;
    } else if (!garageEvLocked) {
      el.chkNA.disabled = false;
      el.chkFI.disabled = false;
    }
    applyLightCurbLocks();
    updateAirHpStrip();
  }

  function loadSelectedVehicle() {
    if (selectedGarageIndex < 0 || selectedGarageIndex >= filteredCars.length) {
      alert('Please select a vehicle first.');
      return;
    }
    var car = filteredCars[selectedGarageIndex];
    el.hp.value = car.Horsepower;
    setInputWeightLbs(el.weight, car.WeightLbs);
    setDriverWeightDefault();
    el.cd.value = car.DragCoefficient;
    el.area.value = car.FrontalAreaSqFt;
    el.loss.value = car.DrivetrainLossPercent;
    el.tireType.value = tireLabelFromEnum(car.TireType);
    setDriveType(car.DriveType || 'RWD');
    setEngineLayout(car.EngineLayout || 'Front');
    setDifferential(car.Differential || (carIsEv(car) ? 'Open' : 'LSD'));
    activeMaxSpeedMph = (car.MaxSpeedMph != null && isFinite(car.MaxSpeedMph) && car.MaxSpeedMph > 0)
      ? Number(car.MaxSpeedMph) : null;
    /* Bake Transmission: Auto | Manual | DCT (missing → Auto). EVs still force Auto via locks. */
    if (!carIsEv(car)) {
      setTransmission(transmissionFromBake(car));
      lastNonLightTx = getTransmission();
    }
    applyGaragePowertrain(car);
    if (carIsEv(car)) {
      /* Garage EVs: bake UI to Open diff; TX locked Automatic via applyLightCurbLocks. */
      setDifferential(car.Differential || 'Open');
    }
    syncTransmissionForCurb();
    setActiveVehicleLabel(car.Name);
    var tags = [];
    if (carIsEv(car)) tags.push('EV', 'Auto');
    else if (carIsFi(car)) tags.push('FI');
    else tags.push('NA');
    if (!carIsEv(car)) tags.push(transmissionSlipLabel(getTransmission()));
    if (!carIsEv(car) && (car.WeightLbs || 0) <= 1500) tags.push('RWD');
    var loadMsg = 'Loaded: ' + car.Name + ' (' + (car.DriveType || 'RWD') + ', ' + tags.join(', ') + ')\nReady to simulate.';
    if (car.Source) loadMsg += '\nSource: ' + car.Source;
    el.resultsOut.textContent = loadMsg;
    updateAirHpStrip();
    closeGarage();
  }

  function defaultCar() {
    return {
      Name: '',
      Horsepower: 450,
      WeightLbs: 3800,
      DragCoefficient: 0.32,
      FrontalAreaSqFt: 22,
      DrivetrainLossPercent: 15,
      TireType: 0,
      DriveType: 'RWD',
      Transmission: 'Auto',
      EngineLayout: 'Front',
      Differential: 'LSD',
      IsEv: false,
      IsForcedInduction: false
    };
  }

  function showCarEditor(mode, car) {
    editorMode = mode;
    el.editorTitle.textContent = mode === 'add' ? 'Add Vehicle' : 'Edit Vehicle';
    el.editName.value = car.Name || '';
    el.editHp.value = car.Horsepower;
    setInputWeightLbs(el.editWeight, car.WeightLbs);
    el.editCd.value = car.DragCoefficient;
    el.editArea.value = car.FrontalAreaSqFt;
    el.editLoss.value = car.DrivetrainLossPercent;
    el.editTireType.value = String(car.TireType == null ? 0 : car.TireType);
    if (el.editDriveType) {
      var dt = String(car.DriveType || 'RWD').toUpperCase();
      if (dt !== 'FWD' && dt !== 'RWD' && dt !== 'AWD') dt = 'RWD';
      el.editDriveType.value = dt;
    }
    el.carEditor.classList.add('open');
    el.editName.focus();
  }

  function hideCarEditor() {
    editorMode = null;
    editingOriginalIndex = -1;
    el.carEditor.classList.remove('open');
  }

  function readEditorCar() {
    var name = String(el.editName.value || '').trim();
    if (!name) throw new Error('Name is required.');
    var hp = parseFloat(el.editHp.value);
    var weightDisp = parseFloat(el.editWeight.value);
    var weight = displayToLb(weightDisp);
    var cd = parseFloat(el.editCd.value);
    var area = parseFloat(el.editArea.value);
    var loss = parseFloat(el.editLoss.value);
    var tire = parseInt(el.editTireType.value, 10);
    if (!isFinite(hp)) throw new Error('Invalid Horsepower.');
    if (!isFinite(weight)) throw new Error('Invalid Weight.');
    if (!isFinite(cd)) throw new Error('Invalid Drag Coefficient.');
    if (!isFinite(area)) throw new Error('Invalid Frontal Area.');
    if (!isFinite(loss)) throw new Error('Invalid Drivetrain Loss.');
    if (!(tire === 0 || tire === 1 || tire === 2 || tire === 3)) tire = 0;
    var driveType = 'RWD';
    if (el.editDriveType) {
      driveType = String(el.editDriveType.value || 'RWD').toUpperCase();
      if (driveType !== 'FWD' && driveType !== 'RWD' && driveType !== 'AWD') driveType = 'RWD';
    }
    var isEv = looksLikeEv(name);
    var isFi = false;
    if (editorMode === 'edit' && editingOriginalIndex >= 0 && garageData[editingOriginalIndex]) {
      var prev = garageData[editingOriginalIndex];
      if (typeof prev.IsEv === 'boolean') isEv = prev.IsEv;
      if (typeof prev.IsForcedInduction === 'boolean') isFi = prev.IsForcedInduction;
      if (isEv) isFi = false;
    }
    var engineLayout = 'Front';
    var differential = 'LSD';
    var maxSpeedMph = undefined;
    if (editorMode === 'edit' && editingOriginalIndex >= 0 && garageData[editingOriginalIndex]) {
      var prev2 = garageData[editingOriginalIndex];
      if (prev2.EngineLayout) engineLayout = prev2.EngineLayout;
      if (prev2.Differential) differential = prev2.Differential;
      if (prev2.MaxSpeedMph != null && isFinite(prev2.MaxSpeedMph)) maxSpeedMph = prev2.MaxSpeedMph;
    }
    if (isEv) {
      engineLayout = bakeEvEngineLayout(driveType, {
        name: name,
        preserveMid: true,
        currentLayout: engineLayout
      });
      if (!differential || differential === 'LSD') differential = 'Open';
    }
    var transmission = 'Auto';
    if (editorMode === 'edit' && editingOriginalIndex >= 0 && garageData[editingOriginalIndex]) {
      var prevTx = garageData[editingOriginalIndex];
      if (prevTx.Transmission != null && String(prevTx.Transmission).trim() !== '') {
        transmission = bakeTransmissionLabel(prevTx.Transmission);
      }
    }
    var out = {
      Name: name,
      Horsepower: hp,
      WeightLbs: weight,
      DragCoefficient: cd,
      FrontalAreaSqFt: area,
      DrivetrainLossPercent: loss,
      TireType: tire,
      DriveType: driveType,
      Transmission: transmission,
      EngineLayout: engineLayout,
      Differential: differential,
      IsEv: isEv,
      IsForcedInduction: isFi
    };
    if (maxSpeedMph != null) out.MaxSpeedMph = maxSpeedMph;
    if (editorMode === 'add') {
      out.IsCustom = true;
    } else if (editorMode === 'edit' && editingOriginalIndex >= 0 && garageData[editingOriginalIndex]) {
      if (garageData[editingOriginalIndex].IsCustom) out.IsCustom = true;
    }
    return out;
  }

  function refreshList(preferName) {
    rebuildGarageFilterOptions();
    refreshFilteredFromSearch();
    selectedGarageIndex = -1;
    if (preferName) {
      for (var i = 0; i < filteredCars.length; i++) {
        if (filteredCars[i].Name === preferName) {
          selectedGarageIndex = i;
          break;
        }
      }
    }
    renderCarList();
  }

  document.getElementById('btnAddVehicle').addEventListener('click', function () {
    editingOriginalIndex = -1;
    showCarEditor('add', defaultCar());
  });

  document.getElementById('btnEditVehicle').addEventListener('click', function () {
    if (selectedGarageIndex < 0 || selectedGarageIndex >= filteredCars.length) {
      alert('Please select a vehicle to edit.');
      return;
    }
    var car = filteredCars[selectedGarageIndex];
    editingOriginalIndex = indexInGarageData(car);
    if (editingOriginalIndex < 0) {
      alert('Could not find vehicle in garage.');
      return;
    }
    showCarEditor('edit', car);
  });

  document.getElementById('btnSaveCar').addEventListener('click', function () {
    try {
      var car = readEditorCar();
      if (editorMode === 'add') {
        garageData.push(car);
      } else if (editorMode === 'edit' && editingOriginalIndex >= 0) {
        garageData[editingOriginalIndex] = car;
      } else {
        throw new Error('Nothing to save.');
      }
      hideCarEditor();
      refreshList(car.Name);
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById('btnCancelCar').addEventListener('click', function () {
    hideCarEditor();
  });

  document.getElementById('btnResetGarage').addEventListener('click', function () {
    if (!confirm('Reset garage to site defaults for this session?')) return;
    garageData = (window.GARAGE_DATA || []).slice();
    hideCarEditor();
    refreshList(null);
    el.resultsOut.textContent = 'Garage reset to defaults (' + garageData.length + ' vehicles).';
  });

  document.getElementById('btnGarage').addEventListener('click', openGarage);
  document.getElementById('btnCloseGarage').addEventListener('click', closeGarage);
  document.getElementById('btnGarageX').addEventListener('click', closeGarage);
  document.getElementById('btnLoadVehicle').addEventListener('click', loadSelectedVehicle);

  el.garageModal.addEventListener('click', function (e) {
    if (e.target === el.garageModal) closeGarage();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var supportModal = document.getElementById('supportModal');
    if (supportModal && supportModal.classList.contains('open')) {
      closeSupport();
      return;
    }
    if (el.garageModal.classList.contains('open')) {
      if (el.carEditor.classList.contains('open')) {
        hideCarEditor();
      } else {
        closeGarage();
      }
    }
  });


  // ---- Support intake (Phase 9: static mailto; no backend / analytics) ----
  const SUPPORT_EMAIL = 'vb-support@agentmail.to';

  var supportEls = {
    modal: document.getElementById('supportModal'),
    type: document.getElementById('supportType'),
    name: document.getElementById('supportName'),
    email: document.getElementById('supportEmail'),
    message: document.getElementById('supportMessage'),
    year: document.getElementById('supportYear'),
    make: document.getElementById('supportMake'),
    model: document.getElementById('supportModel'),
    garageNotes: document.getElementById('supportGarageNotes'),
    garageSources: document.getElementById('supportGarageSources'),
    bugWhat: document.getElementById('supportBugWhat'),
    bugSteps: document.getElementById('supportBugSteps'),
    browser: document.getElementById('supportBrowser'),
    accVehicle: document.getElementById('supportAccVehicle'),
    expected: document.getElementById('supportExpected'),
    shown: document.getElementById('supportShown'),
    source: document.getElementById('supportSource'),
    sectionGarage: document.getElementById('supportSectionGarage'),
    sectionBug: document.getElementById('supportSectionBug'),
    sectionAccuracy: document.getElementById('supportSectionAccuracy'),
    error: document.getElementById('supportError'),
    tabs: document.querySelectorAll('.support-tab')
  };

  var SUPPORT_TYPE_LABEL = {
    garage: 'Permanent garage add',
    bug: 'Bug',
    accuracy: 'Accuracy'
  };

  function supportVal(node) {
    return node ? String(node.value || '').trim() : '';
  }

  function setSupportError(msg) {
    if (!supportEls.error) return;
    if (!msg) {
      supportEls.error.hidden = true;
      supportEls.error.textContent = '';
      return;
    }
    supportEls.error.hidden = false;
    supportEls.error.textContent = msg;
  }

  function syncSupportSections() {
    var t = supportEls.type ? supportEls.type.value : 'garage';
    if (supportEls.sectionGarage) supportEls.sectionGarage.hidden = t !== 'garage';
    if (supportEls.sectionBug) supportEls.sectionBug.hidden = t !== 'bug';
    if (supportEls.sectionAccuracy) supportEls.sectionAccuracy.hidden = t !== 'accuracy';
    if (supportEls.tabs && supportEls.tabs.length) {
      for (var i = 0; i < supportEls.tabs.length; i++) {
        var tab = supportEls.tabs[i];
        var on = tab.getAttribute('data-support-tab') === t;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
  }

  function setSupportTab(type) {
    var t = type || 'garage';
    if (!SUPPORT_TYPE_LABEL[t]) t = 'garage';
    if (supportEls.type) supportEls.type.value = t;
    syncSupportSections();
  }

  function guessVehicleParts(query) {
    var q = String(query || '').trim();
    if (!q) return { year: '', make: '', model: '' };
    var parts = q.split(/\s+/);
    var year = '';
    var rest = parts.slice();
    if (/^(19|20)\d{2}$/.test(parts[0])) {
      year = parts[0];
      rest = parts.slice(1);
    }
    var make = rest[0] || '';
    var model = rest.slice(1).join(' ');
    return { year: year, make: make, model: model };
  }

  function resetSupportForm(prefType, opts) {
    opts = opts || {};
    setSupportTab(prefType || 'garage');
    setSupportError('');
    ['name', 'email', 'message', 'year', 'make', 'model', 'garageNotes', 'garageSources',
      'bugWhat', 'bugSteps', 'browser', 'accVehicle', 'expected', 'shown', 'source'].forEach(function (k) {
      if (supportEls[k]) supportEls[k].value = '';
    });
    if (opts.query) {
      var g = guessVehicleParts(opts.query);
      if (supportEls.year) supportEls.year.value = g.year;
      if (supportEls.make) supportEls.make.value = g.make;
      if (supportEls.model) supportEls.model.value = g.model;
      if (supportEls.accVehicle) supportEls.accVehicle.value = String(opts.query).trim();
      if (supportEls.message && !supportEls.message.value) {
        supportEls.message.value = 'Request to add: ' + String(opts.query).trim();
      }
    }
    if (supportEls.browser) {
      try {
        supportEls.browser.placeholder = (navigator && navigator.userAgent)
          ? String(navigator.userAgent).slice(0, 90)
          : 'e.g. Chrome / Safari';
      } catch (e) { /* ignore */ }
    }
  }

  function openSupport(prefType, opts) {
    resetSupportForm(prefType || 'garage', opts || {});
    if (!supportEls.modal) return;
    supportEls.modal.classList.add('open');
    if (location.hash !== '#support') {
      try { history.replaceState(null, '', '#support'); } catch (e) { /* ignore */ }
    }
    var focusEl = supportEls.message || (supportEls.tabs && supportEls.tabs[0]);
    if (focusEl && focusEl.focus) focusEl.focus();
  }

  function closeSupport() {
    if (supportEls.modal) supportEls.modal.classList.remove('open');
    if (location.hash === '#support') {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }
  }

  function shortTitleForMail(t) {
    if (t === 'garage') {
      var y = supportVal(supportEls.year);
      var mk = supportVal(supportEls.make);
      var md = supportVal(supportEls.model);
      var title = [y, mk, md].filter(Boolean).join(' ');
      return title || supportVal(supportEls.message).slice(0, 60) || 'vehicle request';
    }
    if (t === 'bug') {
      return supportVal(supportEls.bugWhat).slice(0, 60) || supportVal(supportEls.message).slice(0, 60) || 'bug report';
    }
    return supportVal(supportEls.accVehicle).slice(0, 60) || supportVal(supportEls.message).slice(0, 60) || 'accuracy report';
  }

  function validateSupport() {
    var t = supportEls.type ? supportEls.type.value : 'garage';
    if (!supportVal(supportEls.message)) {
      return 'Message is required.';
    }
    if (t === 'garage') {
      if (!supportVal(supportEls.year) || !supportVal(supportEls.make) || !supportVal(supportEls.model)) {
        return 'Year, make, and model are required for a permanent garage add.';
      }
      if (!supportVal(supportEls.garageNotes)) {
        return 'Notes are required for a permanent garage add.';
      }
    } else if (t === 'bug') {
      if (!supportVal(supportEls.bugWhat)) return 'Describe what broke.';
      if (!supportVal(supportEls.bugSteps)) return 'Steps to reproduce are required.';
      if (!supportVal(supportEls.browser)) return 'Browser / device is required.';
    } else {
      if (!supportVal(supportEls.accVehicle)) return 'Vehicle identity is required.';
      if (!supportVal(supportEls.shown)) return '“Page shows” is required.';
      if (!supportVal(supportEls.expected)) return 'Expected value is required.';
      if (!supportVal(supportEls.source)) return 'A source link is required.';
    }
    return '';
  }

  function buildSupportMail() {
    var t = supportEls.type ? supportEls.type.value : 'garage';
    var typeLabel = SUPPORT_TYPE_LABEL[t] || t;
    var subject = '[VB Support] ' + typeLabel + ' — ' + shortTitleForMail(t);
    var lines = [];
    lines.push('VelocityBench support intake');
    lines.push('Type: ' + typeLabel);
    lines.push('');
    lines.push('Name: ' + (supportVal(supportEls.name) || '(not provided)'));
    lines.push('Email: ' + (supportVal(supportEls.email) || '(not provided)'));
    lines.push('');
    lines.push('Message:');
    lines.push(supportVal(supportEls.message));
    lines.push('');

    if (t === 'garage') {
      lines.push('Year: ' + supportVal(supportEls.year));
      lines.push('Make: ' + supportVal(supportEls.make));
      lines.push('Model: ' + supportVal(supportEls.model));
      lines.push('');
      lines.push('Notes:');
      lines.push(supportVal(supportEls.garageNotes));
      lines.push('');
      lines.push('Source links:');
      lines.push(supportVal(supportEls.garageSources) || '(none)');
    } else if (t === 'bug') {
      lines.push('What broke:');
      lines.push(supportVal(supportEls.bugWhat));
      lines.push('');
      lines.push('Steps:');
      lines.push(supportVal(supportEls.bugSteps));
      lines.push('');
      lines.push('Browser / device: ' + supportVal(supportEls.browser));
    } else {
      lines.push('Vehicle: ' + supportVal(supportEls.accVehicle));
      lines.push('');
      lines.push('Page shows:');
      lines.push(supportVal(supportEls.shown));
      lines.push('');
      lines.push('Expected:');
      lines.push(supportVal(supportEls.expected));
      lines.push('');
      lines.push('Source link:');
      lines.push(supportVal(supportEls.source));
    }

    lines.push('');
    lines.push('—');
    lines.push('Static mailto panel (no backend). Inbox monitoring may not be active yet.');

    return { subject: subject, body: lines.join('\n') };
  }

  function submitSupportMailto() {
    var err = validateSupport();
    if (err) {
      setSupportError(err);
      return;
    }
    setSupportError('');
    var mail = buildSupportMail();
    var href = 'mailto:' + encodeURIComponent(SUPPORT_EMAIL).replace(/%40/g, '@')
      + '?subject=' + encodeURIComponent(mail.subject)
      + '&body=' + encodeURIComponent(mail.body);
    window.location.href = href;
  }

  if (supportEls.tabs && supportEls.tabs.length) {
    for (var ti = 0; ti < supportEls.tabs.length; ti++) {
      supportEls.tabs[ti].addEventListener('click', function (e) {
        var tab = e.currentTarget;
        setSupportTab(tab.getAttribute('data-support-tab'));
      });
    }
  }

  var btnSupportFooter = document.getElementById('btnSupportFooter');
  var btnSupportHeader = document.getElementById('btnSupportHeader');
  var btnSupportSubmit = document.getElementById('btnSupportSubmit');
  var btnSupportCancel = document.getElementById('btnSupportCancel');
  var btnSupportX = document.getElementById('btnSupportX');

  if (btnSupportFooter) {
    btnSupportFooter.addEventListener('click', function () { openSupport('garage'); });
  }
  if (btnSupportHeader) {
    btnSupportHeader.addEventListener('click', function () { openSupport('bug'); });
  }
  if (btnSupportSubmit) {
    btnSupportSubmit.addEventListener('click', function () { submitSupportMailto(); });
  }
  if (btnSupportCancel) btnSupportCancel.addEventListener('click', closeSupport);
  if (btnSupportX) btnSupportX.addEventListener('click', closeSupport);
  if (supportEls.modal) {
    supportEls.modal.addEventListener('click', function (e) {
      if (e.target === supportEls.modal) closeSupport();
    });
  }

  // Deep link: /#support
  function maybeOpenSupportHash() {
    if (location.hash === '#support') openSupport('garage');
  }
  window.addEventListener('hashchange', maybeOpenSupportHash);
  maybeOpenSupportHash();

  // ---- UI Scale (whole-page zoom; persist) ----
  var UI_SCALE_KEY = 'velocitybench-ui-scale';
  var uiScaleInput = document.getElementById('uiScale');
  var uiScaleVal = document.getElementById('uiScaleVal');

  function applyUiScale(pct, persist) {
    var n = Math.round(Number(pct));
    if (!(n >= 75 && n <= 125)) n = 100;
    // snap to step 5
    n = Math.round(n / 5) * 5;
    var scale = n / 100;
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    if (uiScaleInput) uiScaleInput.value = String(n);
    if (uiScaleVal) uiScaleVal.textContent = n + '%';
    if (persist !== false) {
      try { localStorage.setItem(UI_SCALE_KEY, String(n)); } catch (e) { /* ignore */ }
    }
    // canvases need a reflow after zoom
    requestAnimationFrame(function () {
      if (gauge && gauge._resize) gauge._resize();
      if (typeof ensureChartSized === 'function') ensureChartSized();
    });
  }

  // Drop legacy layout-density attribute / storage (Comfortable sizes are default)
  try { localStorage.removeItem('velocitybench-layout-density'); } catch (e) { /* ignore */ }
  document.documentElement.removeAttribute('data-layout');

  (function initUiScale() {
    var saved = null;
    try { saved = localStorage.getItem(UI_SCALE_KEY); } catch (e) { saved = null; }
    applyUiScale(saved != null ? saved : 100, false);
    if (uiScaleInput) {
      uiScaleInput.addEventListener('input', function () {
        applyUiScale(uiScaleInput.value, true);
      });
      uiScaleInput.addEventListener('change', function () {
        applyUiScale(uiScaleInput.value, true);
      });
    }
  })();

  (function initUnits() {
    var savedU = null;
    try { savedU = localStorage.getItem(UNITS_KEY); } catch (e) { savedU = null; }
    applyUnitsMode(savedU === 'metric' ? 'metric' : 'standard', false, false);
    function onUnitsChange() {
      var mode = (el.unitsMetric && el.unitsMetric.checked) ? 'metric' : 'standard';
      applyUnitsMode(mode, true, true);
    }
    if (el.unitsStandard) el.unitsStandard.addEventListener('change', onUnitsChange);
    if (el.unitsMetric) el.unitsMetric.addEventListener('change', onUnitsChange);
    setDriverWeightDefault();
  })();

  // Resize gauge/chart on window resize
  window.addEventListener('resize', function () {
    gauge._resize();
    ensureChartSized();
  });

  // Expose helpers for node unit-check (optional)
  window.ForceMetricApp = {
    speedChart: speedChart,
    parseVehicleName: parseVehicleName,
    parseGarageMeta: parseGarageMeta,
    getDriveType: getDriveType,
    setDriveType: setDriveType,
    getEngineLayout: getEngineLayout,
    setEngineLayout: setEngineLayout,
    bakeEvEngineLayout: bakeEvEngineLayout,
    getTransmission: getTransmission,
    setTransmission: setTransmission,
    normalizeTransmission: normalizeTransmission,
    transmissionFromBake: transmissionFromBake,
    transmissionLossDelta: transmissionLossDelta,
    bakeTransmissionLabel: bakeTransmissionLabel,
    isLightCurb: isLightCurb,
    applyLightCurbLocks: applyLightCurbLocks,
    syncTransmissionForCurb: syncTransmissionForCurb,
    isMetric: isMetric,
    applyUnitsMode: applyUnitsMode,
    DEFAULT_DRIVER_WEIGHT_LBS: DEFAULT_DRIVER_WEIGHT_LBS
  };
})();
