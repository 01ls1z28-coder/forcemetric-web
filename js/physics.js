/**
 * Exact JS port of ForceMetric PerformanceCalc.cs
 * CalibrationFactor 0.81, grip, DA, EV curves, dt=0.01, 1-mile loop
 */
(function (global) {
  'use strict';

  var CalibrationFactor = 0.81;

  var TireType = {
    Street: 0,
    DragTire: 1,
    Slick: 2
  };

  function getTireGrip(t) {
    switch (t) {
      case TireType.Street: return 0.80;
      case TireType.DragTire: return 1.15;
      case TireType.Slick: return 1.42;
      default: return 0.80;
    }
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
   * @param {object} opts
   * @returns {object} RunResult-like object
   */
  function calculate(opts) {
    var horsepower = opts.hp;
    var weightLbs = opts.weightLbs;
    var tireType = opts.tireType; // 0 Street, 1 DragTire, 2 Slick
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
    var temperatureF = opts.tempF;
    var humidityPercent = opts.humidity;
    var pressureInHg = opts.pressureInHg;
    var densityAltitudeFtInput = opts.densityAltitudeFtInput; // NaN = compute
    var isNaturallyAspirated = !!opts.isNA;
    var isForcedInduction = !!opts.isFI;

    var timestamp = opts.timestamp || new Date();

    var massKg = weightLbs * 0.45359237;
    var frontalAreaM2 = frontalAreaSqFt * 0.092903;
    var g = 9.80665;

    var airDensity;
    var densityAltitudeFt;

    if (isEv) {
      airDensity = 1.225;
      densityAltitudeFt = 0.0;
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
    }

    if (isEv) {
      tireType = TireType.Street;
    }

    var wheelHp = horsepower * (1.0 - drivetrainLossPercent / 100.0);

    if (!isEv) {
      var standardDensity = 1.225;
      var densityFactor = airDensity / standardDensity;
      var daForLoss = Math.max(0.0, densityAltitudeFt);
      var daThousands = daForLoss / 1000.0;

      if (isNaturallyAspirated && !isForcedInduction) {
        // NA: full density hit + slight peak-rating haircut + 3%/1k DA derate
        wheelHp *= densityFactor;
        wheelHp *= 0.985;
        wheelHp *= Math.max(0.30, 1.0 - 0.03 * daThousands);
      } else if (isForcedInduction && !isNaturallyAspirated) {
        // FI: holds power better as density drops + slight usable-power edge + 1.5%/1k DA derate
        wheelHp *= (0.55 + 0.45 * densityFactor);
        wheelHp *= 1.015;
        wheelHp *= Math.max(0.40, 1.0 - 0.015 * daThousands);
      } else {
        // neither: density only (legacy)
        wheelHp *= densityFactor;
      }
    }

    var wheelWatts = wheelHp * 745.7 * CalibrationFactor;

    var mu = getTireGrip(tireType);

    // Traction compensation by drivetrain (client-side mu model)
    // RWD: baseline (no extra multiply) — former non-AWD behavior
    // FWD: slightly less drive traction under accel / weight transfer
    // AWD: existing boost + force slick-level tire physics
    if (driveType === 'AWD') {
      mu *= isEv ? 1.85 : 1.45;
      tireType = TireType.Slick;
    } else if (driveType === 'FWD') {
      mu *= 0.92;
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

    while (metersToFeet(x) < 5280) {
      var dragN = 0.5 * airDensity * dragCoefficient * frontalAreaM2 * v * v;

      var forceFromPowerN = v < 0.1 ? wheelWatts / 0.1 : wheelWatts / v;

      if (isEv) {
        var mphEv = mpsToMph(v);
        var powerMult =
          mphEv < 40 ? 0.90 :
          mphEv < 70 ? 1.00 :
          mphEv < 100 ? 1.15 :
          mphEv < 120 ? 1.20 :
          mphEv < 140 ? 1.15 :
          mphEv < 160 ? 0.85 :
                        0.93;
        forceFromPowerN *= powerMult;
      }

      if (isEv) {
        var speedMphCurrent = mpsToMph(v);
        var limiter =
          speedMphCurrent < 1 ? 0.40 :
          speedMphCurrent < 5 ? 0.60 :
          speedMphCurrent < 10 ? 0.80 :
                                 1.00;
        forceFromPowerN *= limiter;
      }

      var driveForceN = Math.min(forceFromPowerN, tractionLimitN);
      var netForceN = Math.max(driveForceN - dragN, 0);
      var accel = netForceN / massKg;

      v += accel * dt;
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
    }

    var result = {
      Timestamp: timestamp,
      VmaxMph: vmax,
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
    getTireGrip: getTireGrip,
    CalibrationFactor: CalibrationFactor
  };
})(typeof window !== 'undefined' ? window : globalThis);
