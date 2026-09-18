/**
 * Exact JS port of ForceMetric PerformanceCalc.cs
 * CalibrationFactor 0.81, grip, DA, EV curves, dt=0.01, run to mechanical Vmax
 */
(function (global) {
  'use strict';

  var CalibrationFactor = 0.81;

  // Phase 21 — five-tire grip ladder (longitudinal peak µ).
  // Layout/diff/drive/EV stacks still multiply on top. Honest traction floor:
  // All-season stays at the prior Street µ so grip-limited cars are not faked.
  // Legacy aliases: Street→AllSeason, Sport→Summer, DragTire/Slick→Slicks.
  var TireType = {
    AllSeason: 0,
    Summer: 1,
    UHP: 2,
    SoftCompound: 3,
    Slicks: 4,
    Street: 0,
    Sport: 1,
    DragTire: 4,
    Slick: 4
  };

  function getTireGrip(t) {
    switch (t) {
      case TireType.AllSeason: return 0.80;      // All-season Street
      case TireType.Summer: return 0.97;         // Summer / Sport
      case TireType.UHP: return 1.12;            // UHP Street (near race rubber)
      case TireType.SoftCompound: return 1.30;   // Soft Compound
      case TireType.Slicks: return 1.48;         // Slicks / Drag Radials (Track)
      default: return 0.80;
    }
  }

  function layoutMuMult(layout) {
    var L = String(layout || 'Front');
    // Phase 36: Dual (EV Front+Rear motors) slightly quicker than Rear-only.
    // Documented: Dual 1.055 vs Rear 1.03 vs Mid 1.00 vs Front 0.95. µ ladder unchanged.
    if (L === 'Dual') return 1.055;
    if (L === 'Mid') return 1.00;
    if (L === 'Rear') return 1.03;
    return 0.95; // Front default
  }

  function differentialMuMult(diff) {
    var D = String(diff || 'LSD');
    if (D === 'Open') return 0.92;
    if (D === 'Electronic') return 1.04;
    if (D === 'Locker') return 1.06;
    return 1.00; // LSD
  }

  /**
   * Phase 36 — H-Pattern Manual human shift/launch penalty (vs Sequential/Auto/DCT).
   * Sequential inherits former Manual drivetrain-loss delta (−2) with NO physics penalty.
   * H-Pattern keeps the −2 loss in UI but these multipliers outweigh that advantage so
   * H-Pattern cannot beat Auto / DCT / Sequential. Penalty larger on AS/Summer than Soft/Slicks.
   * Documented launch µ mult by tire index (0..4):
   *   AS 0.86, Summer 0.88, UHP 0.91, Soft 0.95, Slicks 0.96
   * Documented shift-band force mult (≈25–110 mph human shifts):
   *   AS/Summer 0.90, UHP 0.93, Soft 0.96, Slicks 0.97
   */
  function hPatternLaunchMuMult(tireType) {
    var t = tireType | 0;
    if (t <= 0) return 0.86;
    if (t === 1) return 0.88;
    if (t === 2) return 0.91;
    if (t === 3) return 0.95;
    return 0.96; // Slicks
  }

  function hPatternShiftForceMult(tireType, speedMph) {
    var t = tireType | 0;
    var band;
    if (t <= 1) band = 0.90;
    else if (t === 2) band = 0.93;
    else if (t === 3) band = 0.96;
    else band = 0.97;
    var mph = Number(speedMph);
    if (!isFinite(mph) || mph < 0) mph = 0;
    // Full haircut in human shift band; ease outside
    if (mph < 12) return 1.0; // launch handled by µ path
    if (mph < 25) {
      var u = (mph - 12) / 13;
      return 1.0 - u * (1.0 - band);
    }
    if (mph <= 110) return band;
    if (mph < 140) {
      var v = (mph - 110) / 30;
      return band + v * (1.0 - band);
    }
    return 1.0;
  }

  /**
   * Phase 36/38/39 — Drag Setup + Track Prep (session toggle; NA/FI only, never EV / light curb).
   * Does NOT retune µ ladder constants (getTireGrip unchanged).
   *
   * Phase 38 added launch µ mult (prep/bite) + raised force peaks. Phase 39 softens both
   * so mild/mid NA/FI pack ON−OFF 60′ gains stay ~0.10–0.25 s (not ~0.42 s fantasy),
   * while high-power (Demon 170) stays near NHRA ET/trap with a softer 60′.
   * Fade still ≤25 mph peak → mid by 60 mph; force still BEFORE traction clamp.
   *
   * Force mult (BEFORE traction clamp; same pattern as ATC):
   *   Peak launch (≤25 mph): AS 0.14, Summer 0.20, UHP 0.26, Soft 0.36, Slicks 0.46
   *   Mid-run residual (≥60 mph): AS 0.04, Summer 0.05, UHP 0.065, Soft 0.08, Slicks 0.10
   * Launch µ mult (multiplies tractionLimitN in-loop; fades 25→60 mph):
   *   Peak: AS 1.12, Summer 1.18, UHP 1.26, Soft 1.38, Slicks 1.46
   *   Mid (≥60 mph): AS 1.03, Summer 1.04, UHP 1.05, Soft 1.05, Slicks 1.06
   */
  function dragPackForceMult(enabled, tireType, speedMph) {
    if (!enabled) return 1.0;
    var t = tireType | 0;
    if (t < 0) t = 0;
    if (t > 4) t = 4;
    // Phase 39 softened peaks vs Phase 38 (mids kept for trap/ET); was P38: 0.30…0.90
    var peak = [0.14, 0.20, 0.26, 0.36, 0.46][t];
    var mid = [0.04, 0.05, 0.065, 0.08, 0.10][t];
    var mph = Number(speedMph);
    if (!isFinite(mph) || mph < 0) mph = 0;
    var boost;
    // Hold peak through early launch (~25 mph), fade to mid by 60 mph (60′ window)
    if (mph <= 25) {
      boost = peak;
    } else if (mph < 60) {
      var u = (mph - 25) / 35;
      boost = peak + u * (mid - peak);
    } else if (mph < 130) {
      boost = mid;
    } else {
      boost = mid * Math.max(0, 1.0 - (mph - 130) / 80);
    }
    return 1.0 + boost;
  }

  /**
   * Phase 38/39 — Drag Pack launch µ (prep/bite). Applied to traction limit in-loop.
   * Peak hold ≤25 mph; linear fade to mid residual by 60 mph; mid holds after.
   * Phase 39 softens peaks/mids vs Phase 38 (mild/mid realism first).
   * Does NOT change getTireGrip base ladder.
   */
  function dragPackLaunchMuMult(enabled, tireType, speedMph) {
    if (!enabled) return 1.0;
    var t = tireType | 0;
    if (t < 0) t = 0;
    if (t > 4) t = 4;
    var peak = [1.12, 1.18, 1.26, 1.38, 1.46][t];
    var mid = [1.03, 1.04, 1.05, 1.05, 1.06][t];
    var mph = Number(speedMph);
    if (!isFinite(mph) || mph < 0) mph = 0;
    if (mph <= 25) return peak;
    if (mph >= 60) return mid;
    var u = (mph - 25) / 35;
    return peak + u * (mid - peak);
  }

  /**
   * Aftermarket torque converter launch multiplier (Phase 20 stall-band retune).
   * Primary gain from stall-band idealBoost table (not flat +18%).
   * Peak TQ is a match factor: Stall≈Peak TQ → full band target; mismatch softens.
   * Launch window fades with mph so mid/high speed is not permanently inflated.
   * Applied BEFORE traction clamp — mu path remains the hard limit.
   * Estimate grade only — not a K-factor / dyno converter map.
   * Caller must gate Auto-only / non-EV; returns 1 when disabled.
   */
  var ATC_STALL_MIN = 1500;
  var ATC_STALL_MAX = 7000;
  var ATC_PEAK_TQ_MIN = 1500;
  var ATC_PEAK_TQ_MAX = 9000;

  // Band centers (RPM) → matched ideal launch boost (force excess at mph≈0).
  // Targets Δ60′ vs OFF when matched: 1650→−0.07, 3000→−0.15, 3850→−0.22,
  // 4700→−0.26, 5850→−0.30; soft plateau above ~6500 (no free lunch past 0.30).
  // Interpolate between centers. Traction-limited cars may undershoot.
  var ATC_STALL_BAND_BOOST = [
    [1650, 0.27],
    [3000, 1.00],
    [3850, 2.20],
    [4700, 2.70],
    [5850, 3.00],
    [6500, 3.05],
    [7000, 3.05]
  ];

  function clampAtcStallRpm(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 2800;
    if (n < ATC_STALL_MIN) n = ATC_STALL_MIN;
    if (n > ATC_STALL_MAX) n = ATC_STALL_MAX;
    return n;
  }

  function clampAtcPeakTorqueRpm(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 4000;
    if (n < ATC_PEAK_TQ_MIN) n = ATC_PEAK_TQ_MIN;
    if (n > ATC_PEAK_TQ_MAX) n = ATC_PEAK_TQ_MAX;
    return n;
  }

  /** Linear interpolate stall RPM → matched idealBoost from ATC_STALL_BAND_BOOST. */
  function atcStallBandIdealBoost(stallRpm) {
    var s = Number(stallRpm);
    if (!isFinite(s)) s = 2800;
    var bands = ATC_STALL_BAND_BOOST;
    if (s <= bands[0][0]) return bands[0][1];
    for (var i = 0; i < bands.length - 1; i++) {
      var a = bands[i];
      var b = bands[i + 1];
      if (s <= b[0]) {
        var u = (s - a[0]) / (b[0] - a[0]);
        return a[1] + u * (b[1] - a[1]);
      }
    }
    return bands[bands.length - 1][1];
  }

  /**
   * @param {{enabled?:boolean, stallRpm?:number, peakTorqueRpm?:number}} atc
   * @param {number} speedMph
   * @returns {number} force multiplier (≈0.85–3.2), 1.0 when off
   */
  function aftermarketConverterForceMult(atc, speedMph) {
    if (!atc || !atc.enabled) return 1.0;
    var stall = clampAtcStallRpm(atc.stallRpm);
    var peak = clampAtcPeakTorqueRpm(atc.peakTorqueRpm);
    if (peak < 1) peak = 1;
    var match = stall / peak;

    // Stall-band primary gain; Peak TQ match softens under/over
    var idealBoost = atcStallBandIdealBoost(stall);
    var signedBoost;
    if (match <= 1.0) {
      signedBoost = idealBoost * Math.pow(Math.max(0, match), 1.35);
    } else {
      var over = Math.min(match - 1.0, 1.0);
      signedBoost = idealBoost * (1.0 - 1.55 * over) - 0.10 * over * over;
    }

    var mph = Number(speedMph);
    if (!isFinite(mph) || mph < 0) mph = 0;
    // Launch window: full near 0, fades through ~40–70 mph (lockup region)
    var window;
    if (mph <= 4) window = 1.0;
    else if (mph < 40) window = 1.0 - 0.72 * ((mph - 4) / 36);
    else if (mph < 70) window = 0.28 * (1.0 - (mph - 40) / 30);
    else window = 0;

    var mult = 1.0 + signedBoost * window;
    if (mult < 0.85) mult = 0.85;
    if (mult > 3.2) mult = 3.2;
    return mult;
  }


  function airDensityFromDA(daFt) {
    var rho0 = 1.225;
    return rho0 * Math.exp(-daFt / 145366.45);
  }

  function computeDensityAltitude(tempF, humidityPercent, pressureInHg) {
    var tempC = (tempF - 32.0) * 5.0 / 9.0;
    var tempK = tempC + 273.15;
    var pressureHpa = pressureInHg * 33.8639;
    var es = 6.1078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
    var e = es * (humidityPercent / 100.0);
    var Tv = tempK * (1.0 + 0.61 * (e / pressureHpa)); // retained for C# parity
    void Tv;
    var pressureAltitudeFt =
      (1.0 - Math.pow(pressureHpa / 1013.25, 0.190284)) * 145366.45;
    var densityAltitudeFt =
      pressureAltitudeFt + 118.8 * (tempC - (15.0 - 0.0019812 * pressureAltitudeFt));
    return densityAltitudeFt;
  }

  function mpsToMph(v) {
    return v * 2.2369362920544;
  }

  function metersToFeet(d) {
    return d * 3.28083989501312;
  }

  /**
   * Shared air / weather-HP state used by calculate() and live UI strip.
   * Same formulas as PerformanceCalc — do not invent a second path.
   * @returns {{
   *   densityAltitudeFt:number, airDensity:number, densityPctOfStd:number,
   *   weatherHpFactor:number, mode:string, note:string
   * }}
   */
  function computeWeatherAirState(opts) {
    var isEv = !!opts.isEv;
    var isNaturallyAspirated = !!opts.isNA;
    var isForcedInduction = !!opts.isFI;
    var densityAltitudeFtInput = opts.densityAltitudeFtInput;
    var temperatureF = opts.tempF;
    var humidityPercent = opts.humidity;
    var pressureInHg = opts.pressureInHg;

    var standardDensity = 1.225;
    var airDensity;
    var densityAltitudeFt;
    var mode;
    var note;
    var weatherHpFactor = 1.0;

    if (isEv) {
      airDensity = standardDensity;
      densityAltitudeFt = 0.0;
      mode = 'EV';
      note = 'EV locks ρ to std 1.225 and skips HP weather derate (aero drag also uses std ρ).';
      weatherHpFactor = 1.0;
    } else {
      if (densityAltitudeFtInput != null && !Number.isNaN(densityAltitudeFtInput)) {
        densityAltitudeFt = densityAltitudeFtInput;
      } else {
        densityAltitudeFt = computeDensityAltitude(
          temperatureF,
          humidityPercent,
          pressureInHg
        );
      }
      airDensity = airDensityFromDA(densityAltitudeFt);
      var densityFactor = airDensity / standardDensity;
      /* Signed DA: negative (below sea level) boosts ICE; NA ~2× as sensitive as FI. */
      var daThousands = densityAltitudeFt / 1000.0;

      if (isNaturallyAspirated && !isForcedInduction) {
        // NA: full density + peak haircut + 3%/1k DA (derate above 0, boost below 0)
        mode = 'NA';
        note = 'NA: full density × 0.985 peak × 3%/1k DA.';
        weatherHpFactor = densityFactor * 0.985 * Math.max(0.30, 1.0 - 0.03 * daThousands);
      } else if (isForcedInduction && !isNaturallyAspirated) {
        // FI: softer density + edge + 1.5%/1k DA (same sign behavior, half the slope)
        mode = 'FI';
        note = 'FI: soft density × 1.015 edge × 1.5%/1k DA.';
        weatherHpFactor = (0.55 + 0.45 * densityFactor) * 1.015 * Math.max(0.40, 1.0 - 0.015 * daThousands);
      } else {
        // neither: density only (legacy)
        mode = 'ICE';
        note = 'Unspecified aspiration: density factor only.';
        weatherHpFactor = densityFactor;
      }
    }

    return {
      densityAltitudeFt: densityAltitudeFt,
      airDensity: airDensity,
      densityPctOfStd: (airDensity / standardDensity) * 100.0,
      weatherHpFactor: weatherHpFactor,
      mode: mode,
      note: note
    };
  }

  /**
   * @param {object} opts
   * @returns {object} RunResult-like object
   */
  function calculate(opts) {
    var horsepower = opts.hp;
    var weightLbs = opts.weightLbs;
    var tireType = opts.tireType; // Phase 21: 0 AllSeason, 1 Summer, 2 UHP, 3 SoftCompound, 4 Slicks
    var dragCoefficient = opts.Cd;
    var frontalAreaSqFt = opts.frontalAreaSqFt;
    var drivetrainLossPercent = opts.drivetrainLoss;
    var driveType;
    if (opts.driveType != null && String(opts.driveType).trim() !== '') {
      driveType = String(opts.driveType).toUpperCase();
    } else if (opts.isAwd) {
      driveType = 'AWD'; // legacy isAwd fallback
    } else {
      driveType = 'RWD';
    }
    if (driveType !== 'FWD' && driveType !== 'RWD' && driveType !== 'AWD') {
      driveType = 'RWD';
    }
    var isEv = !!opts.isEv;
    var engineLayout = opts.engineLayout || 'Front';
    var differential = opts.differential || 'LSD';
    var transmission = String(opts.transmission || 'auto').trim().toLowerCase();
    if (transmission === 'mt' || transmission === 'hpattern' || transmission === 'h-pattern') transmission = 'manual';
    if (transmission === 'seq' || transmission === 'quickshifter' || transmission === 'quick-shifter') transmission = 'sequential';
    var dragPackOn = !!opts.dragPack && !isEv;
    var maxSpeedMph = (opts.maxSpeedMph != null && isFinite(opts.maxSpeedMph) && opts.maxSpeedMph > 0)
      ? Number(opts.maxSpeedMph) : null;
    var temperatureF = opts.tempF;
    var humidityPercent = opts.humidity;
    var pressureInHg = opts.pressureInHg;
    var densityAltitudeFtInput = opts.densityAltitudeFtInput; // NaN = compute
    var isNaturallyAspirated = !!opts.isNA;
    var isForcedInduction = !!opts.isFI;

    // Aftermarket TC (Auto ICE only — UI gates; physics also ignores EV / disabled)
    var atcEnabled = !!opts.atcEnabled && !isEv;
    var atcStallRpm = opts.stallRpm;
    var atcPeakTorqueRpm = opts.peakTorqueRpm;

    var timestamp = opts.timestamp || new Date();

    var massKg = weightLbs * 0.45359237;
    var frontalAreaM2 = frontalAreaSqFt * 0.092903;
    var g = 9.80665;

    var airState = computeWeatherAirState({
      isEv: isEv,
      isNA: isNaturallyAspirated,
      isFI: isForcedInduction,
      densityAltitudeFtInput: densityAltitudeFtInput,
      tempF: temperatureF,
      humidity: humidityPercent,
      pressureInHg: pressureInHg
    });
    var airDensity = airState.airDensity;
    var densityAltitudeFt = airState.densityAltitudeFt;

    var wheelHp = horsepower * (1.0 - drivetrainLossPercent / 100.0);
    if (!isEv) {
      wheelHp *= airState.weatherHpFactor;
    }

    var wheelWatts = wheelHp * 745.7 * CalibrationFactor;

    var mu = getTireGrip(tireType);

    // Engine layout traction (after tire grip)
    mu *= layoutMuMult(engineLayout);

    // Differential traction
    mu *= differentialMuMult(differential);

    // Phase 36: H-Pattern Manual launch grip haircut (Sequential = no penalty)
    if (transmission === 'manual') {
      mu *= hPatternLaunchMuMult(tireType);
    }

    // Traction compensation by drivetrain (client-side mu model)
    // RWD: baseline (no extra multiply) — former non-AWD behavior
    // FWD: slightly less drive traction under accel / weight transfer
    // AWD: existing boost (no tire overwrite — grip already from selected tire)
    if (driveType === 'AWD') {
      mu *= isEv ? 1.85 : 1.45;
    } else if (driveType === 'FWD') {
      mu *= 0.92;
    }

    // EV traction-control assist (stack with drive/layout/diff)
    if (isEv) {
      mu *= 1.06;
    }

    var tractionLimitN = mu * massKg * g;

    var dt = 0.01;
    var t = 0.0;
    var v = 0.0;
    var x = 0.0;
    var vmax = 0.0;

    var zeroToMph = {};
    for (var mph = 0; mph <= 150; mph += 10) {
      zeroToMph[mph] = -1;
    }

    var distMarkersFt = [60, 330, 660, 1000, 1320, 2640, 5280];
    var dist = {};
    for (var di = 0; di < distMarkersFt.length; di++) {
      dist[distMarkersFt[di]] = { Time: -1, SpeedMph: -1 };
    }

    var hit100 = false;
    var hit200 = false;
    var hit250 = false;
    var time100 = 0;
    var time200 = 0;
    var time250 = 0;

    var steps = [];
    // Stop at mechanical top speed (drive force ≈ aero drag → accel ≈ 0).
    // Safety caps keep the browser from hanging on edge cases.
    var maxSimTimeS = 300;
    var maxDistFt = 5280 * 10;
    var eqSteps = 0;
    var eqNeed = 25; // 0.25 s at equilibrium
    var stopReason = 'safety';

    while (true) {
      var dragN = 0.5 * airDensity * dragCoefficient * frontalAreaM2 * v * v;

      var forceFromPowerN = v < 0.1 ? wheelWatts / 0.1 : wheelWatts / v;

      if (isEv) {
        var mphEv = mpsToMph(v);
        // EV curve calibrated to Car and Driver stock Tesla 0-60 / 1/4 targets
        // (launch stronger than legacy soft 0.90; no separate launch limiter)
        var powerMult =
          mphEv < 40 ? 1.20 :
          mphEv < 70 ? 1.00 :
          mphEv < 100 ? 1.18 :
          mphEv < 120 ? 1.15 :
          mphEv < 140 ? 1.15 :
          mphEv < 160 ? 0.85 :
                        0.93;
        forceFromPowerN *= powerMult;
      } else if (atcEnabled) {
        // ATC launch multiply BEFORE traction clamp — mu path stays the hard limit
        var mphAtc = mpsToMph(v);
        forceFromPowerN *= aftermarketConverterForceMult({
          enabled: true,
          stallRpm: atcStallRpm,
          peakTorqueRpm: atcPeakTorqueRpm
        }, mphAtc);
      }

      var mphNow = mpsToMph(v);

      // Phase 36: H-Pattern human shift-band force haircut (before clamp)
      if (transmission === 'manual') {
        forceFromPowerN *= hPatternShiftForceMult(tireType, mphNow);
      }

      // Phase 36/38: Drag Pack force + launch µ (caller gates EV/light; physics skips EV)
      // Force mult alone cannot fix grip-limited 60′ — µ mult raises the clamp ceiling.
      var tractionNow = tractionLimitN;
      if (dragPackOn) {
        forceFromPowerN *= dragPackForceMult(true, tireType, mphNow);
        tractionNow *= dragPackLaunchMuMult(true, tireType, mphNow);
      }

      var driveForceN = Math.min(forceFromPowerN, tractionNow);
      var netForceN = Math.max(driveForceN - dragN, 0);
      var accel = netForceN / massKg;

      v += accel * dt;
      if (maxSpeedMph != null) {
        var maxVMps = maxSpeedMph / 2.2369362920544;
        if (v > maxVMps) {
          v = maxVMps;
          accel = 0;
        }
      }
      x += v * dt;
      t += dt;

      var speedMph = mpsToMph(v);
      var speedKmh = speedMph * 1.60934;

      if (speedMph > vmax) vmax = speedMph;

      var distanceFt = metersToFeet(x);

      steps.push({
        Time: t,
        SpeedMph: speedMph,
        DistanceFt: distanceFt
      });

      var bucket = Math.floor(speedMph / 10.0) * 10;
      if (bucket >= 0 && bucket <= 150 && zeroToMph[bucket] < 0) {
        zeroToMph[bucket] = t;
      }

      for (var mi = 0; mi < distMarkersFt.length; mi++) {
        var marker = distMarkersFt[mi];
        if (dist[marker].Time < 0 && distanceFt >= marker) {
          dist[marker] = { Time: t, SpeedMph: speedMph };
        }
      }

      if (!hit100 && speedKmh >= 100) {
        hit100 = true;
        time100 = t;
      }
      if (!hit200 && speedKmh >= 200) {
        hit200 = true;
        time200 = t;
      }
      if (!hit250 && speedKmh >= 250) {
        hit250 = true;
        time250 = t;
      }

      // Speed limiter: at cap with no further accel
      if (maxSpeedMph != null && mpsToMph(v) >= maxSpeedMph - 0.05 && accel < 0.05) {
        eqSteps += 1;
        if (eqSteps >= eqNeed && v > 1) {
          stopReason = 'limiter';
          break;
        }
      } else if (accel < 0.05 || driveForceN <= dragN + 1e-6) {
        // Mechanical Vmax: net accel ≈ 0 (same force model — no formula change)
        eqSteps += 1;
        if (eqSteps >= eqNeed && v > 1) {
          stopReason = 'vmax';
          break;
        }
      } else {
        eqSteps = 0;
      }

      if (t >= maxSimTimeS || distanceFt >= maxDistFt) {
        stopReason = 'safety';
        break;
      }
    }

    var result = {
      Timestamp: timestamp,
      VmaxMph: vmax,
      StopReason: stopReason,
      RunDistanceFt: metersToFeet(x),
      RunTimeS: t,
      ZeroToMphTimes: zeroToMph,
      DistanceMarkers: dist,
      Steps: steps,
      DensityAltitudeFt: densityAltitudeFt,
      AirDensity: airDensity,
      ZeroToSixty: zeroToMph[60] >= 0 ? zeroToMph[60] : null,
      ZeroToHundred: zeroToMph[100] >= 0 ? zeroToMph[100] : null,
      ZeroToOneThirty: zeroToMph[130] >= 0 ? zeroToMph[130] : null,
      SixtyToOneThirty: null,
      HundredToOneFifty: null,
      HundredToTwoHundredKmh: null,
      TwoHundredToTwoFiftyKmh: null
    };

    if (result.ZeroToSixty != null && result.ZeroToOneThirty != null) {
      result.SixtyToOneThirty = result.ZeroToOneThirty - result.ZeroToSixty;
    }
    if (zeroToMph[150] >= 0 && zeroToMph[100] >= 0) {
      result.HundredToOneFifty = zeroToMph[150] - zeroToMph[100];
    }
    if (hit100 && hit200) {
      result.HundredToTwoHundredKmh = time200 - time100;
    }
    if (hit200 && hit250) {
      result.TwoHundredToTwoFiftyKmh = time250 - time200;
    }

    return result;
  }

  global.ForceMetricPhysics = {
    TireType: TireType,
    calculate: calculate,
    computeDensityAltitude: computeDensityAltitude,
    airDensityFromDA: airDensityFromDA,
    computeWeatherAirState: computeWeatherAirState,
    getTireGrip: getTireGrip,
    CalibrationFactor: CalibrationFactor,
    layoutMuMult: layoutMuMult,
    differentialMuMult: differentialMuMult,
    hPatternLaunchMuMult: hPatternLaunchMuMult,
    hPatternShiftForceMult: hPatternShiftForceMult,
    dragPackForceMult: dragPackForceMult,
    dragPackLaunchMuMult: dragPackLaunchMuMult,
    aftermarketConverterForceMult: aftermarketConverterForceMult,
    atcStallBandIdealBoost: atcStallBandIdealBoost,
    clampAtcStallRpm: clampAtcStallRpm,
    clampAtcPeakTorqueRpm: clampAtcPeakTorqueRpm,
    ATC_STALL_MIN: ATC_STALL_MIN,
    ATC_STALL_MAX: ATC_STALL_MAX,
    ATC_PEAK_TQ_MIN: ATC_PEAK_TQ_MIN,
    ATC_PEAK_TQ_MAX: ATC_PEAK_TQ_MAX,
    ATC_STALL_BAND_BOOST: ATC_STALL_BAND_BOOST
  };
})(typeof window !== 'undefined' ? window : globalThis);
