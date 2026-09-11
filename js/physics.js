/**
 * Exact JS port of ForceMetric PerformanceCalc.cs
 * CalibrationFactor 0.81, grip, DA, EV curves, dt=0.01, run to mechanical Vmax
 */
(function (global) {
  'use strict';

  var CalibrationFactor = 0.81;

  var TireType = {
    Street: 0,
    Sport: 1,
    DragTire: 2,
    Slick: 3
  };

  function getTireGrip(t) {
    switch (t) {
      case TireType.Street: return 0.80;
      case TireType.Sport: return 0.98;
      case TireType.DragTire: return 1.15;
      case TireType.Slick: return 1.42;
      default: return 0.80;
    }
  }

  function layoutMuMult(layout) {
    var L = String(layout || 'Front');
    if (L === 'Mid' || L === 'Dual') return 1.00;
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
    var tireType = opts.tireType; // 0 Street, 1 Sport, 2 DragTire, 3 Slick
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

      var driveForceN = Math.min(forceFromPowerN, tractionLimitN);
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
