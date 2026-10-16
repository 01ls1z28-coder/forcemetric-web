/*
 * VelocityBench Bench — 2026 Tesla Roadster (Performance + Thrust) ONLY. Created by Jorge Guerra.
 * Bench's own engine (physics.js, ForceMetric port) has no gearing, torque curve, fan suction or
 * thrusters, so these two cars run on an embedded, namespaced copy of VelocityBench PowerCurve
 * physics at 15e74e3 (js/physics.js, unmodified apart from the export wrapper), with the
 * exact cars the PowerCurve page runs. Every other Bench car never reaches this file.
 * ESTIMATES — not a tested car (see the disclaimer in the UI).
 */
(function (root) {
  'use strict';
  var __rsHost = {};
/**
 * VelocityBench PowerCurve — geared RPM physics (¼-mile + run-to-Vmax)
 *
 * Faithful JS port of CarTestClone Physics/PhysicsEngine.cs:
 *   mechRpm = wheelRpm * gearRatio * finalDrive
 *   wheelTorque = engineTQ(rpm) * gear * FD * (1 - loss)
 *   shift at shiftRpm with delay; converter stall/flash; soft traction +
 *   driveline compliance + continuous ATC/TQ envelope (Dragy tip-spike g);
 *   soft shift V-notch → engage tip-spike; no stair/square g segments
 *
 * VB extensions: weather/DA, wind+gusts, FI boost models, EV + Hybrid power sources,
 * F/R + L/R weight distribution (axle normals, transfer, open/LSD traction), editable factory TX ratios.
 * Hybrid: ICE crank TQ + separate electric-motor assist band (not cosmetic).
 * Drive force is SI-honest: wheel TQ (lb·ft)×1.3558179483314 → N·m ÷ tireRadius_m → N
 * (mass/drag/traction already SI). FORCE_LT30 / FORCE_GT60 retired to identity.
 * Weather/DA honesty: humidity→virtual-temp DA; wx = density ratio only (no DA double-count);
 * EV aero uses real rho (motors still wx=1).
 * Estimates — not track certified.
 */
(function (global) {
  'use strict';

  var FEET_TO_M = 0.3048;
  var MPH_TO_MPS = 0.44704;
  var MPS_TO_MPH = 2.23694;
  var G = 9.80665;
  var RHO0 = 1.225;

  var DIST_60 = 60 * FEET_TO_M;
  var DIST_330 = 330 * FEET_TO_M;
  var DIST_660 = 660 * FEET_TO_M;
  var DIST_1000 = 1000 * FEET_TO_M;
  var DIST_1320 = 1320 * FEET_TO_M;
  var DIST_MILE = 5280 * FEET_TO_M;

  var DEFAULT_LOSS_PCT = 15.0;
  var DEFAULT_WB_FT = 8.5;
  var DEFAULT_CG_FT = 1.5;
  var DEFAULT_REAR_PCT = 55.0;
  var DEFAULT_LEFT_PCT = 50.0;
  var DEFAULT_MU = 1.1;

  /**
   * Suggested static weight bias from layout / drive (UI + garage bake).
   * Front-engine RWD keeps rear≈55 so existing fleet calibration stays put.
   */
  function suggestedWeightDistribution(car) {
    car = car || {};
    var layout = String(car.engineLayout || 'Front').toLowerCase();
    var drive = String(car.driveType || 'RWD').toUpperCase();
    var rear = DEFAULT_REAR_PCT;
    var n = String(car.name || car.category || '').toLowerCase();
    var isBike = car.category === 'Motorcycle' || /ninja|hayabusa|yamaha yzf|suzuki gsx|honda cbr|ducati|bmw s1000|motorcycle|bike\b|panigale/.test(n);
    if (isBike) rear = 52; // slight rear bias with rider
    if (layout === 'mid') rear = 55;           // ~45/55
    else if (layout === 'rear') rear = 62;     // ~38/62
    else if (layout === 'dual') rear = 50;     // ~50/50 pack split
    else if (drive === 'FWD') rear = 40;       // ~60/40
    else if (drive === 'AWD') rear = 55;       // slight rear bias
    else rear = 55;                            // FR RWD — calib-safe (~50/50 + rear bias)
    var left = DEFAULT_LEFT_PCT;
    if (car.leftWeightPercent != null && isFinite(Number(car.leftWeightPercent))) {
      left = clamp(Number(car.leftWeightPercent), 20, 80);
    }
    rear = clamp(rear, 20, 80);
    return {
      frontWeightPercent: 100 - rear,
      rearWeightPercent: rear,
      leftWeightPercent: left,
      rightWeightPercent: 100 - left
    };
  }

  /** Resolve F/R % for traction; prefers explicit car fields, else historical 55 rear. */
  function resolveWeightDistribution(car) {
    car = car || {};
    var rear, left;
    if (car.rearWeightPercent != null && isFinite(Number(car.rearWeightPercent))) {
      rear = Number(car.rearWeightPercent);
    } else if (car.frontWeightPercent != null && isFinite(Number(car.frontWeightPercent))) {
      rear = 100 - Number(car.frontWeightPercent);
    } else {
      // Unset → historical default (NOT layout guess) so spotcheck/fleet stay stable
      rear = DEFAULT_REAR_PCT;
    }
    if (car.leftWeightPercent != null && isFinite(Number(car.leftWeightPercent))) {
      left = Number(car.leftWeightPercent);
    } else if (car.rightWeightPercent != null && isFinite(Number(car.rightWeightPercent))) {
      left = 100 - Number(car.rightWeightPercent);
    } else {
      left = DEFAULT_LEFT_PCT;
    }
    rear = clamp(rear, 20, 80);
    left = clamp(left, 20, 80);
    return {
      frontWeightPercent: 100 - rear,
      rearWeightPercent: rear,
      leftWeightPercent: left,
      rightWeightPercent: 100 - left
    };
  }

  // Softened vs C# 2.55/1.16 for track realism (VERIFY.md)
  var GRIP_LT20 = 1.35;
  var GRIP_20_40 = 1.15;
  var GRIP_40_60 = 1.05;
  var FORCE_LT30 = 1.0; // retired invent (was 2.05 unit-mix crutch); identity with SI drive force
  var FORCE_GT60 = 1.0;   // was 1.10 invented top-end boost; identity at speed

  var DEFAULT_LAUNCH_RPM = 3000;
  var DEFAULT_SHIFT_RPM = 6500;
  var DEFAULT_SHIFT_TIME = 0.10;
  // Launch-mode window: early rollout (~60 ft / ~40 mph), not just first ~2 mph.
  // Soft/auto/aggressive must produce meaningful, realistic deltas on CT/ZR1X-class cars.
  var LAUNCH_V_THRESH = 18.0;   // m/s ≈ 40 mph
  var LAUNCH_HOLD = 2.2;        // seconds of launch-mode influence
  var LAUNCH_DIST_M = 18.3;     // ≈ 60 ft
  var MAX_T = 180.0;            // allow long accel runs to Vmax
  var DT = 0.001;
  /** Safety caps for run-to-Vmax (documented in VERIFY.md). */
  var VMAX_SPEED_CAP_MPH = 250.0;
  var VMAX_DIST_CAP_FT = 26400.0; // 5 miles
  var VMAX_A_THRESH = 0.05;       // m/s^2 — equilibrium detect
  var VMAX_HOLD_S = 0.50;         // sustained low-a before declaring Vmax

  /** Global drive-force scale. Must stay 1.0 (forceScale honesty — no silent kneecap). */
  var CalibrationFactor = 1.0;

  /**
   * Shift-coast residual HOLE floor by transmission family.
   * Soft release → brief floor → post-shift engage tip-spike. ATC uses a SHALLOW
   * residual (slight notch, not a deep well) + mid-shift recover climb, then
   * spikes up on engage (Dragy C — KEEP). Between-shift tippy envelope from
   * soft traction + driveline + ATC/TQ dynamics (not fake IMU). forceScale=1.
   * Aero + rolling resistance still apply honestly; velocity integration unchanged.
   */
  var SHIFT_RESIDUAL_DRIVE = {
    manual: 0.10,     // clutch open — mostly coast (0.05–0.15 band)
    automatic: 0.52,  // ATC/TC slight notch (NOT deep 0.30 well) — Dragy soft dip
    dct: 0.60,        // dual-clutch overlap (0.45–0.75); also sequential / bike
    ev: 0.85          // near-seamless (0.70–0.95); rare multi-speed EV shifts
  };

  /**
   * Resolve shift-drive family from car.transmission, isEv, and txKey / preset hints.
   * Returns: 'manual' | 'dct' | 'automatic' | 'ev'
   */
  function resolveShiftDriveFamily(car) {
    if (!car) return 'automatic';
    if (car.isEv || car.powerSource === 'ev') return 'ev';
    var tx = String(car.transmission || '').trim().toLowerCase();
    var key = String(car.txKey || '');
    var keyL = key.toLowerCase();
    var preset = FactoryTransmissions[key];
    var pname = preset && preset.name ? String(preset.name).toLowerCase() : '';
    var blob = tx + ' ' + keyL + ' ' + pname;

    // Manual / MT-like (explicit label, or bare txKey on empty transmission)
    if (/^manual\b|stick|h-?pattern|\bmt\b/.test(tx)) return 'manual';
    if (!tx && /^(tr6060|tremec_t56|tremec_tr3650|tremec_t45|tremec_tr3160|mt82|getrag_mt82|muncie|toploader|a833|t5_|karkraft|toyota_t50|toyota_w58|toyota_it6|mazda_5|mazda_6mt|nissan_fs5w71|nissan_fs6r31a|nissan_z_6|mazda_miata|honda_s2000|honda_ctr|honda_nsx|honda_5mt|toyota_fa86|getrag_r34|getrag_420g|bmw_getrag|aisin_6|aisin_ay6|subaru_6mt|mitsubishi_|porsche_cgt|ford_ricardo|lambo_manual|aston_graziano|cima_6|saleen_ricardo|hyundai_6mt)/i.test(key)) {
      return 'manual';
    }

    // DCT / PDK / DSG / SSG / dual-clutch / sequential (bikes) / AMT e-gear
    if (/dct|pdk|dsg|ssg|dual|sequential|ldf|isr|e-?gear|\bf1\b|stronic|speedshift\s*dct|tremec_tr90/.test(blob) ||
        /^(pdk_|porsche_pdk|amg_speedshift_dct|vw_dq500|audi_stronic|gr6_dct|dct_7|tremec_tr9070|tremec_tr9080|ferrari_|mclaren_|lambo_|bugatti_|bmw_m_dct|bike_)/i.test(key)) {
      return 'dct';
    }

    // Automatic / AT / ZF / MCT / torque-converter
    if (/auto|automatic|\bat\b|zf|mct|torque\s*converter|converter|10r80|10l90|4l60|700r4|6l80|6r80|nag1|th400|th350|200-?4r|2004r|a340|chrysler_727|ford_c[46]|cruise/.test(blob)) {
      return 'automatic';
    }

    return 'automatic'; // fallback
  }

  function shiftResidualFraction(family) {
    var f = SHIFT_RESIDUAL_DRIVE[family];
    return f != null ? f : SHIFT_RESIDUAL_DRIVE.automatic;
  }

  /**
   * Fraction of shiftTime spent releasing into the residual hole.
   * After release, torque HOLDS at the hole until shiftTime ends; engagement
   * push is a separate post-shift smoothstep (clutch bite / TC fill / DCT lock).
   * Keeps mid-shift impulse near the residual model (ET/trap honesty) while
   * removing square a/g cliffs.
   */
  var SHIFT_RELEASE_FRACTION = {
    manual: 0.42,     // clutch out
    automatic: 0.55,  // ATC shifts fast — brief soft notch, little flat hold
    dct: 0.30,        // overlap — quicker to hole
    ev: 0.25          // near-seamless
  };

  /** Post-shift engagement ramp duration (seconds) by TX family. */
  var SHIFT_ENGAGE_TIME = {
    manual: 0.070,    // clutch bite
    automatic: 0.040, // ATC TC / clutch-pack fill + tip spike
    dct: 0.035,       // overlap complete
    ev: 0.020         // inverter slew
  };

  /**
   * Engage tip-spike overshoot vs engaged TQ (0 = none).
   * ATC: brief push ABOVE next-gear settle (Dragy spike-on-engage), then settle.
   */
  var SHIFT_ENGAGE_OVERSHOOT = {
    manual: 0.06,     // clutch bite tip
    automatic: 0.22,  // ATC slam / TC fill spike (slight notch then SPIKE)
    dct: 0.04,        // mild overlap tip
    ev: 0.00          // seamless
  };

  function shiftReleaseFraction(family) {
    var f = SHIFT_RELEASE_FRACTION[family];
    return f != null ? f : SHIFT_RELEASE_FRACTION.automatic;
  }

  function shiftEngageTime(family) {
    var t = SHIFT_ENGAGE_TIME[family];
    return t != null ? t : SHIFT_ENGAGE_TIME.automatic;
  }

  function shiftEngageOvershoot(family) {
    var o = SHIFT_ENGAGE_OVERSHOOT[family];
    return o != null ? o : SHIFT_ENGAGE_OVERSHOOT.automatic;
  }

  /** Hermite smoothstep on [0,1] — C1 continuous clutch/TC blend. */
  function smoothstep01(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x * x * (3 - 2 * x);
  }

  /**
   * Mid-shift release: p=0 → lastDrive; soft dip to hole at releaseEnd.
   * Optional recoverStart/recoverTQ: ATC V-notch climbs off the floor before
   * shift-end (no deep flat well). Post-shift tip spike via shiftEngageTorque.
   */
  function shiftReleaseTorque(p, lastDriveWhTQ, holeTQ, releaseEnd, recoverStart, recoverTQ) {
    var re = releaseEnd;
    if (re < 0.12) re = 0.12;
    if (re > 0.85) re = 0.85;
    var rs = recoverStart;
    if (rs == null || !(rs > re) || rs >= 1) {
      if (p >= re) return holeTQ;
      var u0 = smoothstep01(p / re);
      return lastDriveWhTQ + (holeTQ - lastDriveWhTQ) * u0;
    }
    if (p <= re) {
      var u1 = smoothstep01(p / re);
      return lastDriveWhTQ + (holeTQ - lastDriveWhTQ) * u1;
    }
    if (p < rs) return holeTQ;
    var span = 1 - rs;
    if (span < 1e-6) return holeTQ;
    var u2 = smoothstep01((p - rs) / span);
    return holeTQ + (recoverTQ - holeTQ) * u2;
  }

  /**
   * Post-shift engagement: e=0 → fromTQ; e=1 → engagedWhTQ.
   * Optional tip overshoot: half-sine peaks mid-engage ABOVE engaged TQ
   * (ATC Dragy spike-on-engage), then settles to engaged at e=1.
   */
  function shiftEngageTorque(e, fromTQ, engagedWhTQ, overshoot) {
    var u = smoothstep01(e);
    var os = overshoot > 0 ? overshoot : 0;
    var tip = os > 0 ? Math.sin(Math.PI * e) : 0;
    var target = engagedWhTQ * (1 + os * tip);
    return fromTQ + (target - fromTQ) * u;
  }

  /**
   * Grip vs mph — LIVE band anchors with narrow smoothstep blends across former
   * 20/40/60 cliffs so launch/mid g is continuous (kills square stairs — A/E).
   */
  function gripMultSmooth(mph) {
    function blend(loMph, hiMph, loG, hiG) {
      if (mph <= loMph) return loG;
      if (mph >= hiMph) return hiG;
      return loG + (hiG - loG) * smoothstep01((mph - loMph) / (hiMph - loMph));
    }
    // Full-span slopes — NO mid-band flats (those paint launch stairs while grip-limited).
    // Brief 0–8 mph hold keeps leave mu near LIVE GRIP_LT20 (ET honesty).
    if (mph < 8) return GRIP_LT20;
    if (mph < 28) return blend(8, 28, GRIP_LT20, GRIP_20_40);
    if (mph < 48) return blend(28, 48, GRIP_20_40, GRIP_40_60);
    if (mph < 70) return blend(48, 70, GRIP_40_60, 1.0);
    return 1.0;
  }

  /**
   * Drive-force scale vs mph — LIVE FORCE_LT30 / FORCE_GT60 with blends at 30/60
   * so force does not cliff (continuous taper with speed — A/E).
   */
  function driveForceMultSmooth(mph) {
    function blend(loMph, hiMph, loG, hiG) {
      if (mph <= loMph) return loG;
      if (mph >= hiMph) return hiG;
      return loG + (hiG - loG) * smoothstep01((mph - loMph) / (hiMph - loMph));
    }
    // Full-span slopes — kill 34–56 flat FORCE shelf (square stair on g).
    if (mph < 16) return FORCE_LT30;
    if (mph < 38) return blend(16, 38, FORCE_LT30, 1.0);
    if (mph < 75) return blend(38, 75, 1.0, FORCE_GT60);
    return FORCE_GT60;
  }

  /**
   * Soft tire traction knee — asymptote above tracLim so launch tips then settles
   * (Dragy sharp launch spike character — D) instead of a flat brick-wall g shelf.
   */
  function softTractionForce(driveF, tracLim, overshootFrac) {
    if (tracLim <= 1e-9) return 0;
    if (driveF <= tracLim) return driveF;
    var over = overshootFrac != null ? overshootFrac : 0.12;
    if (over < 0) over = 0;
    if (over > 0.28) over = 0.28;
    var ceil = tracLim * (1 + over);
    var excess = driveF - tracLim;
    var span = Math.max(tracLim * 0.45, 1);
    var soft = tracLim + (ceil - tracLim) * (excess / (excess + span));
    // Spill headroom so TQ/ATC tips still move applied (no flat ceil shelf).
    var head = Math.min(driveF, ceil * 1.08) - soft;
    if (head > 0) soft += 0.10 * head;
    return soft;
  }

  var FactoryTransmissions = {
    TH400_3: { name: 'GM TH400 3-spd', gears: [2.48, 1.48, 1.00], finalDrive: 3.73, loss: 18 },
    Muncie_M21: { name: 'Muncie M21 4-spd', gears: [2.20, 1.64, 1.28, 1.00], finalDrive: 3.70, loss: 12 },
    Toploader_4: { name: 'Ford Toploader 4-spd', gears: [2.20, 1.66, 1.31, 1.00], finalDrive: 3.54, loss: 12 },
    A833_4: { name: 'Chrysler A833 4-spd', gears: [2.66, 1.91, 1.39, 1.00], finalDrive: 3.55, loss: 12 },
    T5_5: { name: 'BorgWarner T5 5-spd', gears: [2.95, 1.94, 1.34, 1.00, 0.63], finalDrive: 3.73, loss: 13 },
    // Phase2 classics: OEM-distinct 4/5spd (prefer existing Toploader/Muncie/A833/T5 unless OEM needs distinct)
    KarKraft_T44_4: { name: 'Kar Kraft T-44 4-spd (GT40 MkII)', gears: [2.22, 1.43, 1.19, 1.00], finalDrive: 2.77, loss: 12 },
    Toyota_T50_5: { name: 'Toyota T50 5-spd (AE86)', gears: [3.587, 2.022, 1.384, 1.000, 0.861], finalDrive: 4.30, loss: 13 },
    Toyota_W58_5: { name: 'Toyota W58 5-spd (Supra/MR2)', gears: [3.285, 1.894, 1.275, 1.000, 0.783], finalDrive: 3.73, loss: 13 },
    Mazda_5M: { name: 'Mazda 5-spd (RX-7 GSL-SE)', gears: [3.622, 2.181, 1.419, 1.000, 0.758], finalDrive: 3.909, loss: 13 },
    Nissan_FS5W71_5: { name: 'Nissan FS5W71C 5-spd (Skyline)', gears: [3.321, 1.902, 1.308, 1.000, 0.838], finalDrive: 4.111, loss: 13 },
    TR6060_6: { name: 'Tremec TR-6060 6-spd', gears: [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], finalDrive: 3.73, loss: 12 },
    Getrag_MT82: { name: 'Getrag MT-82 6-spd', gears: [3.66, 2.43, 1.69, 1.32, 1.00, 0.65], finalDrive: 3.73, loss: 12 },
    ZF8HP: { name: 'ZF 8HP Auto', gears: [4.71, 3.14, 2.11, 1.67, 1.28, 1.00, 0.84, 0.67], finalDrive: 3.15, loss: 15 },
    // Phase3 Euro DCT marque presets (published-leaning). PDK_7 kept as Carrera-class alias.
    PDK_7: { name: 'Porsche PDK 7-spd (alias)', gears: [3.91, 2.29, 1.65, 1.30, 1.08, 0.88, 0.62], finalDrive: 3.44, loss: 10 },
    Porsche_PDK_7: { name: 'Porsche PDK 7-spd (Carrera)', gears: [3.91, 2.29, 1.65, 1.30, 1.08, 0.88, 0.62], finalDrive: 3.44, loss: 10 },
    Porsche_PDK_7_GT: { name: 'Porsche PDK 7-spd (GT)', gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], finalDrive: 3.97, loss: 10 },
    AMG_SPEEDSHIFT_DCT_7: { name: 'AMG SPEEDSHIFT DCT 7', gears: [3.40, 2.19, 1.63, 1.29, 1.03, 0.84, 0.72], finalDrive: 3.67, loss: 10 },
    AMG_SPEEDSHIFT_MCT_7: { name: 'AMG SPEEDSHIFT MCT 7', gears: [4.377, 2.859, 1.921, 1.368, 1.000, 0.820, 0.728], finalDrive: 2.82, loss: 12 },
    VW_DQ500_7: { name: 'VW DQ500 7DSG', gears: [3.562, 2.526, 1.678, 1.022, 0.788, 0.761, 0.635], finalDrive: 4.059, loss: 10 },
    Audi_STronic_7: { name: 'Audi S-tronic DL501 7', gears: [3.692, 2.150, 1.406, 1.025, 0.787, 0.625, 0.519], finalDrive: 4.093, loss: 10 },
    GR6_DCT: { name: 'Nissan GR6 DCT', gears: [4.056, 2.301, 1.595, 1.248, 1.000, 0.795], finalDrive: 3.70, loss: 10 },
    Getrag_R34: { name: 'Getrag 6-spd (R34 GT-R)', gears: [3.214, 1.925, 1.302, 1.000, 0.752, 0.634], finalDrive: 3.545, loss: 14 },
    Aisin_6: { name: 'Aisin/Getrag V160 6-spd', gears: [3.827, 2.360, 1.685, 1.312, 1.000, 0.793], finalDrive: 3.133, loss: 12 },
    // Phase6 Euro supercar DCT marque presets (published-leaning). Legacy DCT_7_AMG kept empty of fleet after Phase6 remap.
    Ferrari_DCT_7: { name: 'Ferrari Getrag F1 DCT 7', gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], finalDrive: 5.14, loss: 10 },
    Ferrari_DCT_8: { name: 'Ferrari Magna 8DCT (SF90)', gears: [3.61, 2.34, 1.74, 1.40, 1.07, 0.87, 0.77, 0.67], finalDrive: 4.51, loss: 10 },
    Ferrari_F1_6: { name: 'Ferrari F1 6-spd AMT', gears: [3.29, 2.16, 1.61, 1.27, 1.03, 0.82], finalDrive: 4.30, loss: 12 },
    McLaren_SSG_7: { name: 'McLaren SSG 7DCT', gears: [3.98, 2.61, 1.91, 1.48, 1.16, 0.91, 0.69], finalDrive: 3.31, loss: 10 },
    Lambo_LDF_7: { name: 'Lamborghini LDF 7DCT', gears: [3.133, 2.083, 1.575, 1.244, 0.979, 0.788, 0.677], finalDrive: 4.89, loss: 10 },
    Lambo_ISR_7: { name: 'Lamborghini ISR 7 AMT', gears: [3.909, 2.438, 1.810, 1.458, 1.185, 0.967, 0.844], finalDrive: 2.867, loss: 12 },
    Lambo_EGear_6: { name: 'Lamborghini e-gear 6 AMT (Gallardo)', gears: [3.31, 2.05, 1.46, 1.14, 0.94, 0.78], finalDrive: 3.08, loss: 12 },
    Lambo_EGear_V12_6: { name: 'Lamborghini e-gear 6 AMT (Murciélago)', gears: [3.091, 2.105, 1.565, 1.241, 1.065, 0.939], finalDrive: 2.53, loss: 12 },
    Bugatti_DSG_7: { name: 'Bugatti DSG 7DCT', gears: [3.18, 2.26, 1.67, 1.29, 1.06, 0.88, 0.80], finalDrive: 3.64, loss: 10 },
    BMW_M_DCT_7: { name: 'BMW M DCT 7 (GS7D36SG)', gears: [4.806, 2.583, 1.701, 1.277, 1.000, 0.844, 0.671], finalDrive: 3.462, loss: 10 },
    // Legacy key kept for any residual Tremec clone; GT500 = Tremec_TR9070_7DCT; Phase6 remaps Euro supercars off this
    DCT_7_AMG: { name: 'Tremec TR-9070 DCT 7 (legacy key)', gears: [3.14, 2.05, 1.43, 1.10, 0.86, 0.68, 0.56], finalDrive: 3.73, loss: 10 },
    Tremec_TR9070_7DCT: { name: 'Tremec TR-9070 DCT 7', gears: [3.14, 2.05, 1.43, 1.10, 0.86, 0.68, 0.56], finalDrive: 3.73, loss: 10 },
    Ford_10R80: { name: 'Ford 10R80 10-spd Auto', gears: [4.696, 2.985, 2.146, 1.769, 1.520, 1.275, 1.000, 0.854, 0.689, 0.636], finalDrive: 3.15, loss: 15 },
    GM_10L90: { name: 'GM 10L90 10-spd Auto', gears: [4.70, 2.99, 2.15, 1.80, 1.52, 1.28, 1.00, 0.85, 0.69, 0.64], finalDrive: 2.85, loss: 15 },
    Tremec_TR9080_8DCT: { name: 'Tremec TR-9080 8DCT', gears: [2.91, 1.76, 1.22, 0.88, 0.65, 0.51, 0.40, 0.33], finalDrive: 5.20, loss: 10 },
    Bike_Sport_6: { name: 'Sportbike 6-spd (liter)', gears: [2.600, 2.158, 1.882, 1.650, 1.476, 1.304], finalDrive: 3.96, loss: 12 },
    Bike_Hyper_6: { name: 'Hyperbike 6-spd', gears: [2.562, 1.934, 1.526, 1.285, 1.125, 1.041], finalDrive: 3.81, loss: 12 },
    EV_Single: { name: 'EV Single-Speed', gears: [1.00], finalDrive: 9.0, loss: 8 },
    // Phase 4 EV / oddball — published-leaning (Tesla manuals / Porsche Newsroom / Koenigsegg KDD)
    Tesla_EV_Plaid: { name: 'Tesla Plaid single-speed', gears: [1.00], finalDrive: 7.56, loss: 8 },
    Tesla_EV_Cybertruck: { name: 'Tesla Cybertruck single-speed', gears: [1.00], finalDrive: 15.02, loss: 8 },
    Porsche_Taycan_2: { name: 'Porsche Taycan 2-spd rear', gears: [1.925, 1.00], finalDrive: 8.05, loss: 8 },
    Koenigsegg_KDD: { name: 'Koenigsegg Direct Drive', gears: [1.00], finalDrive: 2.73, loss: 8 },
    // Phase 5 residual ZF8/TR6060 filler — published-leaning OEM autos + JDM manuals
    GM_4L60E: { name: 'GM 4L60-E 4-spd Auto', gears: [3.06, 1.63, 1.00, 0.70], finalDrive: 3.42, loss: 16 },
    GM_4L65E: { name: 'GM 4L65-E 4-spd Auto', gears: [3.06, 1.63, 1.00, 0.70], finalDrive: 3.42, loss: 16 },
    GM_2004R: { name: 'GM THM 200-4R 4-spd Auto', gears: [2.74, 1.57, 1.00, 0.67], finalDrive: 3.42, loss: 16 },
    GM_6L80: { name: 'GM 6L80 6-spd Auto', gears: [4.027, 2.364, 1.532, 1.152, 0.852, 0.667], finalDrive: 3.27, loss: 15 },
    GM_6L90: { name: 'Hydra-Matic 6L90 6-spd Auto', gears: [4.03, 2.36, 1.53, 1.15, 0.85, 0.67], finalDrive: 3.23, loss: 15 },
    Chrysler_NAG1_5: { name: 'Chrysler NAG1/W5A580 5-spd Auto', gears: [3.59, 2.19, 1.41, 1.00, 0.83], finalDrive: 3.06, loss: 15 },
    Mazda_Miata_5: { name: 'Mazda Miata NA 5-spd', gears: [3.136, 1.888, 1.330, 1.000, 0.814], finalDrive: 4.30, loss: 13 },
    Honda_S2000_6: { name: 'Honda S2000 6-spd (AP1)', gears: [3.133, 2.045, 1.481, 1.161, 0.970, 0.810], finalDrive: 4.756, loss: 12 },
    Toyota_FA86_6: { name: 'Toyota/Subaru FA86 6-spd', gears: [3.626, 2.188, 1.541, 1.213, 1.000, 0.767], finalDrive: 4.10, loss: 12 },
    // Phase 7 OEM boxes — T56 vs TR-6060, classic GM autos, Ford MT era, JDM/Euro manuals
    Tremec_T56: { name: 'Tremec T56 6-spd', gears: [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], finalDrive: 3.42, loss: 12 },
    GM_TH350: { name: 'GM TH350 3-spd', gears: [2.52, 1.52, 1.00], finalDrive: 3.42, loss: 18 },
    GM_700R4: { name: 'GM 700R4 4-spd Auto', gears: [3.06, 1.63, 1.00, 0.70], finalDrive: 3.42, loss: 16 },
    Tremec_TR3650: { name: 'Tremec TR-3650 5-spd', gears: [3.38, 2.00, 1.32, 1.00, 0.68], finalDrive: 3.55, loss: 13 },
    Tremec_T45: { name: 'Tremec T45 5-spd', gears: [3.37, 1.99, 1.33, 1.00, 0.67], finalDrive: 3.27, loss: 13 },
    Tremec_TR3160: { name: 'Tremec TR-3160 6-spd', gears: [3.25, 2.23, 1.61, 1.24, 1.00, 0.63], finalDrive: 3.73, loss: 12 },
    Aisin_AY6: { name: 'Aisin AY6 6-spd (Camaro V6)', gears: [4.48, 2.58, 1.63, 1.19, 1.00, 0.75], finalDrive: 3.27, loss: 12 },
    Honda_CTR_6: { name: 'Honda Civic Type R 6-spd', gears: [3.625, 2.115, 1.529, 1.125, 0.911, 0.735], finalDrive: 4.111, loss: 12 },
    Honda_NSX_5: { name: 'Honda NSX 5-spd', gears: [3.071, 1.727, 1.230, 0.967, 0.771], finalDrive: 4.062, loss: 12 },
    Honda_5MT: { name: 'Honda 5-spd (Prelude/Integra era)', gears: [3.230, 1.900, 1.250, 0.909, 0.702], finalDrive: 4.40, loss: 13 },
    Subaru_6MT: { name: 'Subaru 6MT (STI)', gears: [3.636, 2.235, 1.521, 1.137, 0.971, 0.756], finalDrive: 3.90, loss: 14 },
    Mitsubishi_5MT: { name: 'Mitsubishi 5MT (Evo VIII)', gears: [2.928, 1.950, 1.407, 1.031, 0.720], finalDrive: 4.529, loss: 14 },
    Mitsubishi_6MT: { name: 'Mitsubishi 6MT (Evo X)', gears: [2.909, 1.944, 1.434, 1.100, 0.868, 0.693], finalDrive: 4.583, loss: 14 },
    Nissan_FS6R31A: { name: 'Nissan FS6R31A 6-spd (350Z)', gears: [3.794, 2.324, 1.624, 1.271, 1.000, 0.794], finalDrive: 3.538, loss: 12 },
    Nissan_Z_6: { name: 'Nissan Z 6-spd (RZ34)', gears: [3.794, 2.324, 1.624, 1.271, 1.000, 0.794], finalDrive: 3.538, loss: 12 },
    Mazda_6MT: { name: 'Mazda 6-spd (RX-8)', gears: [3.760, 2.269, 1.645, 1.187, 1.000, 0.843], finalDrive: 4.444, loss: 12 },
    BMW_Getrag_6: { name: 'BMW Getrag 420G 6-spd', gears: [4.227, 2.528, 1.669, 1.226, 1.000, 0.828], finalDrive: 3.62, loss: 12 },
    Porsche_CGT_6: { name: 'Porsche Carrera GT 6-spd', gears: [3.20, 1.87, 1.36, 1.07, 0.90, 0.75], finalDrive: 4.44, loss: 12 },
    Ford_Ricardo_6: { name: 'Ford GT Ricardo 6-spd', gears: [2.611, 1.708, 1.233, 0.943, 0.767, 0.625], finalDrive: 3.36, loss: 12 },
    Lambo_Manual_5: { name: 'Lamborghini Diablo 5-spd', gears: [2.31, 1.52, 1.12, 0.88, 0.68], finalDrive: 3.73, loss: 12 },
    Aston_Graziano_6: { name: 'Aston Martin Graziano 6-spd', gears: [3.15, 1.94, 1.41, 1.09, 0.88, 0.70], finalDrive: 3.91, loss: 12 },
    CIMA_6: { name: 'CIMA 6-spd (Koenigsegg CCX)', gears: [2.88, 1.77, 1.27, 1.00, 0.83, 0.69], finalDrive: 3.36, loss: 12 },
    Saleen_Ricardo_6: { name: 'Saleen S7 Ricardo 6-spd', gears: [2.86, 1.76, 1.25, 0.96, 0.78, 0.64], finalDrive: 3.60, loss: 12 },
    Toyota_iT6: { name: 'Toyota iT6 6-spd (GR Corolla)', gears: [3.538, 2.238, 1.535, 1.163, 0.878, 0.661], finalDrive: 4.294, loss: 12 },
    Hyundai_6MT: { name: 'Hyundai/Kia 6MT (Genesis Coupe)', gears: [3.818, 2.294, 1.624, 1.271, 1.000, 0.794], finalDrive: 3.727, loss: 12 },
    Audi_Getrag_6: { name: 'Audi/Getrag 6MT (RS4 B7)', gears: [3.667, 2.211, 1.520, 1.133, 0.919, 0.778], finalDrive: 3.82, loss: 12 },
    Ford_6R80: { name: 'Ford 6R80 6-spd Auto', gears: [4.17, 2.34, 1.52, 1.14, 0.87, 0.69], finalDrive: 3.31, loss: 15 },
    Ford_C6: { name: 'Ford C6 3-spd Auto', gears: [2.46, 1.46, 1.00], finalDrive: 3.00, loss: 18 },
    Ford_C4: { name: 'Ford C4 3-spd Auto', gears: [2.46, 1.46, 1.00], finalDrive: 3.00, loss: 18 },
    Chrysler_727: { name: 'Chrysler TorqueFlite 727 3-spd', gears: [2.45, 1.45, 1.00], finalDrive: 3.23, loss: 18 },
    Toyota_A340E: { name: 'Toyota A340E 4-spd Auto', gears: [2.804, 1.531, 1.000, 0.705], finalDrive: 3.27, loss: 16 },
Tremec_TR6060_ZR1_MH3: { name: 'Tremec TR-6060 MH3 (C6 ZR1 close-ratio)', gears: [2.29, 1.61, 1.21, 1.00, 0.82, 0.68], finalDrive: 3.42, loss: 12 },
    Audi_RTronic_6: { name: 'Audi R-tronic 6-spd AMT (R8)', gears: [4.373, 2.709, 1.925, 1.502, 1.239, 1.035], finalDrive: 3.077, loss: 12 },
    Aston_Sportshift_III_7: { name: 'Aston Martin Sportshift III 7-spd', gears: [3.286, 2.158, 1.609, 1.269, 1.034, 0.848, 0.675], finalDrive: 3.727, loss: 12 },
    Koenigsegg_LST_9: { name: 'Koenigsegg Light Speed Transmission 9', gears: [4.72, 3.6441, 2.8744, 2.25, 1.7371, 1.3702, 1.0783, 0.8325, 0.6566], finalDrive: 2.73, loss: 10 },
    Subaru_22B_5MT: { name: 'Subaru 22B STI 5MT', gears: [3.083, 2.062, 1.545, 1.151, 0.825], finalDrive: 4.444, loss: 14 },
    Honda_Prelude_SH_5: { name: 'Honda Prelude Type SH 5MT (M2U4)', gears: [3.285, 1.956, 1.344, 1.034, 0.812], finalDrive: 4.266, loss: 13 },
    Honda_RSX_TypeS_6: { name: 'Acura RSX Type-S 6MT', gears: [3.267, 2.13, 1.517, 1.147, 0.921, 0.738], finalDrive: 4.389, loss: 12 },
    MazdaSpeed_6MT: { name: 'MazdaSpeed 6MT (MS3/MS6)', gears: [3.538, 2.238, 1.535, 1.171, 1.085, 0.853], finalDrive: 3.941, loss: 12 },
    Honda_EK9_5: { name: 'Honda Civic Type R EK9 5MT', gears: [3.23, 2.105, 1.458, 1.107, 0.848], finalDrive: 4.4, loss: 13 },
    Subaru_WRX_Bugeye_5MT: { name: 'Subaru WRX Bugeye 5MT (TY752)', gears: [3.454, 2.062, 1.448, 1.088, 0.825], finalDrive: 3.9, loss: 14 },
    Mitsubishi_Eclipse4G_5MT: { name: 'Mitsubishi Eclipse 4G 5MT (F5M51)', gears: [2.928, 1.95, 1.407, 1.031, 0.72], finalDrive: 4.111, loss: 14 },
    Toyota_Scion_tC_6: { name: 'Toyota/Scion tC 6MT', gears: [3.3, 1.9, 1.42, 1.0, 0.71, 0.61], finalDrive: 3.82, loss: 12 },
    Mitsubishi_Eclipse3G_5MT: { name: 'Mitsubishi Eclipse 3G GSX 5MT (F5M42)', gears: [3.583, 1.947, 1.379, 1.03, 0.82], finalDrive: 3.722, loss: 14 },
    Honda_Accord_EuroR_5: { name: 'Honda Accord Euro R 5MT (T2W4)', gears: [3.285, 2.09, 1.481, 1.071, 0.812], finalDrive: 4.266, loss: 13 },
    Ford_TorqShift_6R140: { name: 'Ford TorqShift 6R140 6-spd Auto', gears: [3.97, 2.32, 1.51, 1.14, 0.85, 0.67], finalDrive: 3.73, loss: 15 },
    Toyota_AB60E: { name: 'Toyota AB60E 6-spd Auto', gears: [3.333, 1.96, 1.353, 1.0, 0.728, 0.588], finalDrive: 4.3, loss: 15 },
    Toyota_A750E: { name: 'Toyota A750E/F 5-spd Auto', gears: [3.52, 2.042, 1.4, 1.0, 0.716], finalDrive: 3.727, loss: 16 },
    Ford_4R75E: { name: 'Ford 4R75E 4-spd Auto', gears: [2.84, 1.55, 1.0, 0.7], finalDrive: 3.73, loss: 16 },
    Nissan_RE5R05A: { name: 'Nissan RE5R05A 5-spd Auto', gears: [3.827, 2.368, 1.52, 1.0, 0.834], finalDrive: 2.937, loss: 15 },
    Nissan_RE7R01A: { name: 'Nissan/Infiniti RE7R01A 7-spd Auto (Q50)', gears: [4.783, 3.103, 1.984, 1.371, 1.000, 0.871, 0.776], finalDrive: 2.937, loss: 15 },
    Ford_TorqShift_5R110W: { name: 'Ford TorqShift 5R110W 5-spd Auto', gears: [3.09, 2.2, 1.53, 1.0, 0.71], finalDrive: 3.73, loss: 16 },
    Ford_CruiseOMatic_3: { name: 'Ford Cruise-O-Matic / Fordomatic 3-spd', gears: [2.4, 1.47, 1.0], finalDrive: 3.56, loss: 18 },
    Chrysler_42RLE: { name: 'Chrysler 42RLE 4-spd Auto', gears: [2.84, 1.57, 1.0, 0.69], finalDrive: 3.73, loss: 16 },
    Honda_Pilot_5AT: { name: 'Honda Pilot 5-spd Auto', gears: [2.697, 1.565, 1.023, 0.782, 0.595], finalDrive: 4.312, loss: 16 },
    Mitsubishi_Eclipse2G_5MT: { name: 'Mitsubishi Eclipse 2G GSX 5MT', gears: [3.083, 1.684, 1.222, 0.886, 0.666], finalDrive: 4.312, loss: 14 },
    Honda_Integra_SiR_5: { name: 'Honda Integra SiR / GS-R 5MT (Y80)', gears: [3.23, 1.9, 1.25, 0.909, 0.702], finalDrive: 4.4, loss: 13 },
    Honda_Accord_SiR_5: { name: 'Honda Accord SiR 5MT', gears: [3.285, 1.956, 1.344, 1.034, 0.812], finalDrive: 4.266, loss: 13 },
    Mazda_ND_Miata_6: { name: 'Mazda MX-5 ND 6MT', gears: [5.087, 2.991, 2.035, 1.594, 1.286, 1.0], finalDrive: 2.866, loss: 12 },
    Acura_10AT: { name: 'Acura/Honda 10-spd Auto (TLX Type S)', gears: [5.25, 3.27, 2.19, 1.6, 1.3, 1.0, 0.78, 0.65, 0.58, 0.52], finalDrive: 3.59, loss: 15 },
    Maserati_MC12_Cambiocorsa_6: { name: 'Maserati MC12 Cambiocorsa 6 AMT', gears: [3.15, 2.18, 1.57, 1.19, 0.94, 0.71], finalDrive: 4.10, loss: 12 },
    Toyota_U151E: { name: 'Toyota U151E/U151F 5-spd Auto (Highlander)', gears: [4.235, 2.360, 1.517, 1.047, 0.756], finalDrive: 3.478, loss: 16 },
    ZF_6HP: { name: 'ZF 6HP Auto', gears: [4.17, 2.34, 1.52, 1.14, 0.87, 0.69], finalDrive: 3.46, loss: 15 }
  };

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function airDensityFromDA(daFt) {
    return RHO0 * Math.exp(-daFt / 145366.45);
  }

  function computeDensityAltitude(tempF, humidityPct, pressureInHg) {
    var tempC = (tempF - 32.0) * 5.0 / 9.0;
    var tempK = tempC + 273.15;
    var pHpa = pressureInHg * 33.8639;
    var es = 6.1078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
    var e = es * (clamp(Number(humidityPct) || 0, 0, 100) / 100.0);
    // Virtual temperature: moist air is less dense → higher DA. Prior tip computed
    // this then discarded it with void(...) — humidity never reached DA/rho/wx.
    var tvK = tempK * (1.0 + 0.61 * (e / Math.max(pHpa, 1e-6)));
    var tvC = tvK - 273.15;
    var pAlt = (1.0 - Math.pow(pHpa / 1013.25, 0.190284)) * 145366.45;
    return pAlt + 118.8 * (tvC - (15.0 - 0.0019812 * pAlt));
  }

  function getTorqueAtRpm(curve, rpm) {
    if (!curve) return 0;
    var keys, map = {};
    if (Array.isArray(curve)) {
      keys = [];
      for (var i = 0; i < curve.length; i++) {
        var pt = curve[i];
        var r = Number(pt.rpm != null ? pt.rpm : pt[0]);
        var t = pt.tq != null ? pt.tq : (pt.torque != null ? pt.torque : pt[1]);
        if (!isFinite(r)) continue;
        keys.push(r);
        map[r] = t;
      }
      keys.sort(function (a, b) { return a - b; });
    } else {
      keys = Object.keys(curve).map(Number).filter(function (k) { return isFinite(k); });
      keys.sort(function (a, b) { return a - b; });
      map = curve;
    }
    if (!keys.length) return 0;
    rpm = Number(rpm);
    if (!isFinite(rpm)) return 0;
    function tAt(k) {
      var v = Number(map[k]);
      if (!isFinite(v)) v = Number(map[String(Math.round(k))]);
      return isFinite(v) ? v : 0;
    }
    if (rpm <= keys[0]) return tAt(keys[0]);
    if (rpm >= keys[keys.length - 1]) return tAt(keys[keys.length - 1]);
    for (var j = 0; j < keys.length - 1; j++) {
      var r1 = keys[j], r2 = keys[j + 1];
      if (rpm >= r1 && rpm <= r2) {
        var t1 = tAt(r1), t2 = tAt(r2);
        if (!isFinite(t1) && !isFinite(t2)) return 0;
        if (!isFinite(t1)) return t2;
        if (!isFinite(t2)) return t1;
        if (r2 === r1) return t1;
        return t1 + (t2 - t1) * ((rpm - r1) / (r2 - r1));
      }
    }
    // Nearest-neighbor fallback — never drop mid-range samples to 0
    var best = keys[0], bestD = Math.abs(rpm - keys[0]);
    for (var n = 1; n < keys.length; n++) {
      var d = Math.abs(rpm - keys[n]);
      if (d < bestD) { bestD = d; best = keys[n]; }
    }
    return tAt(best);
  }


  /**
   * Peak-TQ RPM from baked curve (fallback when car.peakTqRpm missing).
   */
  function peakTqRpmFromCurve(curve) {
    if (!curve) return 0;
    var bestR = 0, bestT = -1;
    var keys = Array.isArray(curve)
      ? curve.map(function (pt) { return Number(pt.rpm != null ? pt.rpm : pt[0]); })
      : Object.keys(curve).map(Number);
    for (var i = 0; i < keys.length; i++) {
      var r = keys[i];
      if (!isFinite(r)) continue;
      var t = getTorqueAtRpm(curve, r);
      if (t > bestT) { bestT = t; bestR = r; }
    }
    return bestR;
  }

  /**
   * Leave / brake-launch target RPM.
   * launchRpm is the intended leave; absurd ICE values (idle / near-zero) seed
   * toward the peak-TQ band so stock slip→lockup has a sane tach start.
   * EV keeps launchRpm as-is (motor rpm for TQ; Power % dial uses timeline rpm).
   */
  function resolveLeaveRpm(car, launchRpm, redline, curve) {
    var lr = Number(launchRpm);
    if (!isFinite(lr) || lr < 0) lr = DEFAULT_LAUNCH_RPM;
    redline = Number(redline) || DEFAULT_SHIFT_RPM;
    if (car && car.isEv) {
      return clamp(lr, 0, Math.max(redline, lr));
    }
    var peakTq = Number(car && car.peakTqRpm);
    if (!(peakTq > 0)) peakTq = peakTqRpmFromCurve(curve);
    if (!(peakTq > 0)) peakTq = Math.min(4000, redline * 0.55);
    // Absurd leave (calib leftovers / idle): seed ~0.9× peak-TQ band.
    // Manual and DCT keep the number they were given, even a low one.
    // Do not lift either family toward the torque peak. Only a missing
    // number uses the default. Never floor a clutch leave at 800.
    var leaveFam = car ? resolveShiftDriveFamily(car) : '';
    var clutchLeave = leaveFam === 'manual' || leaveFam === 'dct';
    if (lr < 1000 && !clutchLeave) {
      lr = Math.round(clamp(peakTq * 0.9, 1800, Math.min(redline - 200, peakTq)));
    }
    if (clutchLeave) {
      if (!(lr > 0)) return 2200;
      if (lr > redline) return redline;
      return lr;
    }
    // Auto launch mode already seeded a calm 2200 leave before this call.
    // Do not clamp Custom / Soft / Aggressive back to 2200. A stock
    // converter has to sample the torque curve at the commanded rpm while
    // it is stalled; clamping every stock auto made a 2200–6000 sweep one
    // identical run.
    return clamp(lr, 800, redline);
  }

  /**
   * Suggested leave for a clutch car (manual or DCT). Tire grip sets it.
   * Street unprepped is a low realistic leave; more grip suggests higher.
   * A high dump (4500 drag radial / 5200 slick) is suggested only on a
   * prepped surface when that car already stored launchRpm >= 4000.
   * customLaunchRpm > 0 on the car wins and is not raised. With no custom
   * number the suggestion replaces the stored launch, so a 5750 garage
   * dump on street becomes 2200. Missing tire uses car.tireType. Missing
   * prep is unprepped.
   * Indexes: 0 Street, 1 Drag Radial, 2 Slick, 3 Summer, 4 UHP, 5 R-Compound.
   */
  function suggestedClutchLaunchRpm(car, tireType, trackPrep) {
    var custom = car && Number(car.customLaunchRpm);
    if (custom > 0) return custom;
    var tire;
    if (tireType != null && tireType !== '' && isFinite(Number(tireType))) {
      tire = Number(tireType) | 0;
    } else if (car && car.tireType != null && isFinite(Number(car.tireType))) {
      tire = Number(car.tireType) | 0;
    } else {
      tire = 0;
    }
    var prep = normalizeTrackPrep(trackPrep);
    var stored = car && car.launchRpm != null ? Number(car.launchRpm) : 0;
    if (!(stored > 0) || !isFinite(stored)) stored = 0;
    if (prep === 'prepped' && stored >= 4000 && (tire === 1 || tire === 2)) {
      return tire === 1 ? 4500 : 5200;
    }
    var table = prep === 'prepped'
      ? { 0: 2600, 1: 3400, 2: 3600, 3: 2800, 4: 3200, 5: 3600 }
      : { 0: 2200, 1: 3200, 2: 3400, 3: 2400, 4: 2600, 5: 3000 };
    var rpm = table[tire];
    if (!(rpm > 0)) rpm = prep === 'prepped' ? 2600 : 2200;
    return rpm;
  }

  /**
   * Dyno-honest torque curve from peak HP (+ optional peak TQ/HP RPM).
   * Jorge: HP+weight alone must yield believable trap/ET — post-peak HP fall
   * is span-aware (~18–26%), not a crater. Peak TQ ~10–14% above TQ@peakHP.
   */
  function synthesizeTorqueCurve(peakHp, peakTqRpm, redline, peakHpRpm) {
    peakHp = clamp(Number(peakHp) || 300, 1, 15000);
    redline = clamp(Number(redline) || 6500, 2000, 16000);
    // Sane defaults when user only enters HP (and maybe redline)
    if (!(Number(peakTqRpm) > 0)) {
      peakTqRpm = redline > 9000 ? Math.round(redline * 0.72) : Math.round(redline * 0.58);
    }
    peakTqRpm = clamp(Number(peakTqRpm), 800, Math.min(12000, redline - 100));
    if (!(Number(peakHpRpm) > 0)) {
      peakHpRpm = Math.min(redline * 0.92, peakTqRpm + Math.max(1200, redline * 0.18));
    }
    peakHpRpm = clamp(Number(peakHpRpm), peakTqRpm, redline);
    // Peak TQ from published HP@RPM via HP = TQ*RPM/5252 (consistent by construction)
    var tqAtPeakHp = (peakHp * 5252) / peakHpRpm;
    // Typical NA/FI: ~10–14% more TQ at peak-TQ RPM than at peak-HP RPM
    var peakTq = tqAtPeakHp * 1.12;
    var span = Math.max(1, redline - peakHpRpm);
    // Target HP fall peak→redline — short spans (peak near limiter) only tip off gently
    var hpFallFrac = span < 400 ? 0.08 : (span < 800 ? 0.14 : (span < 1400 ? 0.20 : (span < 2200 ? 0.24 : 0.26)));
    var curve = {};
    for (var r = 1000; r <= redline; r += 100) {
      var tq;
      if (r <= peakTqRpm) {
        var u = r / peakTqRpm;
        // Rising flank — soft start then fill (dyno-like, not a flat blob)
        tq = peakTq * (0.50 + 0.50 * Math.pow(u, 0.70));
      } else if (r <= peakHpRpm) {
        var v = (r - peakTqRpm) / Math.max(1, peakHpRpm - peakTqRpm);
        // TQ falls gradually so HP keeps climbing to peakHpRpm
        tq = peakTq + (tqAtPeakHp - peakTq) * (0.20 * v + 0.80 * v * v);
      } else {
        var w = (r - peakHpRpm) / span;
        // Shape HP fall smoothly; convert to TQ so HP lands on target tip
        var hpHere = peakHp * (1.0 - hpFallFrac * (0.75 * w + 0.25 * w * w));
        tq = (hpHere * 5252) / r;
      }
      curve[r] = Math.max(10, tq);
    }
    // Pin exact peaks + redline HP tip
    curve[peakTqRpm] = peakTq;
    curve[peakHpRpm] = tqAtPeakHp;
    var hpRed = peakHp * (1.0 - hpFallFrac);
    curve[redline] = Math.max(10, (hpRed * 5252) / redline);
    return sanitizeTorqueCurvePostPeak(curve, peakHpRpm);
  }

  function peakHpFromCurve(curve) {
    var keys = Object.keys(curve).map(Number);
    var peak = 0;
    for (var i = 0; i < keys.length; i++) {
      var hp = (Number(curve[keys[i]]) * keys[i]) / 5252;
      if (hp > peak) peak = hp;
    }
    return peak;
  }

  /**
   * Real dyno past peak HP: HP must keep falling toward redline — no uptick and
   * no flat plateau at the tip. Preserves natural declining samples; when the
   * bake would rise or flatten, continue the established negative slope.
   */
  /** Jorge Z28 Mustang-dyno engine curve: keep stored post-peak tip (no steepen). */
  var PRESERVE_STORED_DYNO_TIP_IDS = {
    '2001-chevrolet-camaro-z28-h-c-e-ms3-tsp5-3stage2-5-1-3-4lt-trueduals': true
  };

  function preserveStoredDynoTip(carOrId) {
    if (carOrId == null) return false;
    var id = typeof carOrId === 'string' ? carOrId : carOrId.id;
    return !!(id && PRESERVE_STORED_DYNO_TIP_IDS[id]);
  }

  function sanitizeTorqueCurvePostPeak(curve, peakHpRpmOpt, carOrId) {
    if (preserveStoredDynoTip(carOrId)) return curve;
    if (!curve || typeof curve !== 'object') return curve;
    var keys = Object.keys(curve).map(Number).filter(function (k) { return isFinite(k); });
    keys.sort(function (a, b) { return a - b; });
    if (keys.length < 3) return curve;
    var peakHp = 0;
    var peakRpm = keys[0];
    var i;
    for (i = 0; i < keys.length; i++) {
      var hp0 = (Number(curve[keys[i]]) * keys[i]) / 5252;
      if (hp0 > peakHp) {
        peakHp = hp0;
        peakRpm = keys[i];
      }
    }
    var redline = keys[keys.length - 1];
    var pinned = Number(peakHpRpmOpt);
    if (isFinite(pinned) && pinned > 0) {
      var pinHp = (Number(curve[pinned]) * pinned) / 5252;
      if (!isFinite(pinHp)) pinHp = (Number(curve[String(Math.round(pinned))]) * pinned) / 5252;
      // Pin only when there is room past the pin to fall (not peak==redline shelf)
      if (isFinite(pinHp) && pinHp >= peakHp * 0.97 && pinned < redline - 80) {
        peakRpm = pinned;
        peakHp = pinHp;
      }
    }
    var span = Math.max(1, redline - peakRpm);
    // Tip fall: short spans (peak≈redline) tip gently; long spans ~20–26%.
    // Steepest ~30% on long spans (was 45% cliff). Never invent a 16% drop in 200 rpm.
    var targetFallFrac = span < 400 ? 0.08 : (span < 800 ? 0.14 : (span < 1600 ? 0.20 : 0.26));
    var maxFallFrac = span < 400 ? 0.14 : (span < 800 ? 0.20 : (span < 1600 ? 0.28 : 0.30));
    var fallPerRpm = -(peakHp * targetFallFrac) / span;
    var maxSlope = -(peakHp * maxFallFrac) / span; // steepest HP/rpm allowed
    var minSlope = -(peakHp * targetFallFrac) / span;
    var floorHp = peakHp * (1.0 - maxFallFrac);
    var prevHp = peakHp;
    var prevR = peakRpm;
    for (i = 0; i < keys.length; i++) {
      var r = keys[i];
      if (r <= peakRpm) continue;
      var tq = Number(curve[r]);
      if (!isFinite(tq)) continue;
      var hp = (tq * r) / 5252;
      var dr = r - prevR;
      if (dr <= 0) continue;
      var minDrop = Math.max(0.005 * dr, peakHp * 0.00012 * dr);
      // Strictly decreasing: reject rise OR flat (within 0.15 hp)
      if (hp >= prevHp - 0.15) {
        var cont = prevHp + fallPerRpm * dr;
        if (!(cont < prevHp - minDrop)) cont = prevHp - minDrop;
        if (cont < floorHp) cont = floorHp;
        if (cont >= prevHp) cont = prevHp - minDrop;
        curve[r] = Math.max(5, (cont * 5252) / r);
        hp = (curve[r] * r) / 5252;
        fallPerRpm = minSlope;
      } else {
        var natSlope = (hp - prevHp) / dr;
        if (natSlope > minSlope * 0.85) {
          // Too flat — continue at target slope
          var cont2 = prevHp + minSlope * dr;
          if (cont2 < floorHp) cont2 = floorHp;
          if (cont2 >= prevHp - 0.15) cont2 = prevHp - minDrop;
          curve[r] = Math.max(5, (cont2 * 5252) / r);
          hp = (curve[r] * r) / 5252;
          fallPerRpm = minSlope;
        } else if (natSlope < maxSlope) {
          // Too steep / cratered tip — lift toward max allowed fall (trap honesty)
          var cont3 = prevHp + maxSlope * dr;
          if (cont3 < floorHp) cont3 = floorHp;
          if (cont3 >= prevHp - 0.15) cont3 = prevHp - minDrop;
          curve[r] = Math.max(5, (cont3 * 5252) / r);
          hp = (curve[r] * r) / 5252;
          fallPerRpm = maxSlope;
        } else {
          fallPerRpm = natSlope;
        }
      }
      prevHp = hp;
      prevR = r;
    }
    return curve;
  }

  /**
   * Scale torque map so curve peak HP cannot exceed peakHpCap (tiny rounding slack).
   * Returns same object if already within cap or cap invalid.
   */
  function capTorqueCurveToPeakHp(curve, peakHpCap) {
    if (!curve || !(peakHpCap > 0)) return curve;
    var peak = peakHpFromCurve(curve);
    if (!(peak > 0) || peak <= peakHpCap * 1.002) return curve;
    var scale = peakHpCap / peak;
    var keys = Object.keys(curve);
    for (var i = 0; i < keys.length; i++) {
      var v = Number(curve[keys[i]]);
      if (!isFinite(v)) continue;
      curve[keys[i]] = Math.max(5, v * scale);
    }
    return curve;
  }

  /** FI boost on torque. Use only when curve is NA baseline; dyno curves already include boost. */
  function boostTorqueMult(model, boostPsi, rpm, redline, ambientInHg) {
    model = String(model || 'na').toLowerCase();
    if (model === 'na' || model === 'none' || model === 'ev') return 1.0;
    boostPsi = clamp(Number(boostPsi) || 0, 0, 80);
    if (boostPsi <= 0) return 1.0;
    var atmPsi = (Number(ambientInHg) || 29.92) * 0.491154;
    var pr = (atmPsi + boostPsi) / atmPsi;
    var ideal = 1.0 + (pr - 1.0) * 0.88;
    var spool = 1.0;
    var r = Number(rpm) || 0;
    var red = Math.max(3000, Number(redline) || 6500);
    if (model === 'turbo') {
      var a = red * 0.28, b = red * 0.55;
      if (r <= a) spool = 0.15;
      else if (r >= b) spool = 1.0;
      else spool = 0.15 + 0.85 * ((r - a) / (b - a));
    } else if (model === 'twincharge') {
      var a2 = red * 0.18, b2 = red * 0.42;
      if (r <= a2) spool = 0.55;
      else if (r >= b2) spool = 1.0;
      else spool = 0.55 + 0.45 * ((r - a2) / (b2 - a2));
    } else {
      spool = clamp(0.7 + 0.3 * (r / red), 0.7, 1.0);
    }
    return 1.0 + (ideal - 1.0) * spool;
  }


  /**
   * Hybrid electric assist (lb-ft added to ICE crank TQ before drivetrain loss).
   * Documented model — separate motor assist, not a second FI boost curve:
   *   peakAssist ≈ hybridAssistFrac × (peakHp×5252/peakHpRpm)  (default frac 0.22)
   *   full assist ≤ 0.40×redline; linear fade to ~27% of peak by 0.85×redline; hold after.
   * Garage hybrids bake an ICE-fraction dyno (~82% of published system HP) so ICE+assist
   * lands near the published combined figure. Custom Builder: toggling Hybrid vs NA on the
   * same ICE curve changes ET (assist on/off).
   */
  function hybridAssistTorqueLbFt(rpm, car) {
    if (!car || !car.isHybrid || car.isEv) return 0;
    var peakHp = Number(car.peakHp) || 400;
    var peakHpRpm = Math.max(1000, Number(car.peakHpRpm) || 6000);
    var red = Math.max(peakHpRpm, Number(car.redline) || 7000);
    var tqRef = (peakHp * 5252) / peakHpRpm;
    var fracPeak = car.hybridAssistFrac != null ? Number(car.hybridAssistFrac) : 0.22;
    if (!isFinite(fracPeak) || fracPeak < 0) fracPeak = 0.22;
    var peakAssist = tqRef * fracPeak;
    var lo = red * 0.40;
    var hi = red * 0.85;
    var r = Number(rpm) || 0;
    var shape;
    if (r <= lo) shape = 1.0;
    else if (r >= hi) shape = 0.27;
    else shape = 1.0 + (0.27 - 1.0) * ((r - lo) / Math.max(1, hi - lo));
    return peakAssist * shape;
  }

  function weatherTorqueFactor(opts, daFt, rho) {
    if (opts.isEv) return 1.0;
    var df = rho / RHO0;
    // Density-honest: torque scales with intake density ratio only.
    // df = rho/RHO0 already comes from airDensityFromDA(daFt) — do NOT multiply by
    // an extra (1 - k·DA_kft) term (that double-counted altitude vs density).
    // daFt kept in signature for callers / probes; unused after honesty fix.
    void daFt;
    if (opts.isHybrid) {
      // ~70% e-motor (density-independent) + ~30% ICE share
      return 0.70 + 0.30 * df;
    }
    if (opts.isNA && !opts.isFI) {
      return df;
    }
    if (opts.isFI && !opts.isNA) {
      // FI less density-sensitive than NA (boost partially compensates); identity at RHO0
      return 0.55 + 0.45 * df;
    }
    return df;
  }

  /** windDirDeg 0 = headwind. Gusts oscillate along track. */
  function relativeAirspeedMps(vMps, windMph, windDirDeg, gustMph, tSec) {
    var wind = Number(windMph) || 0;
    var gust = Number(gustMph) || 0;
    var dir = (((Number(windDirDeg) || 0) % 360) + 360) % 360;
    var longFrac = Math.cos((dir * Math.PI) / 180);
    var gustWave = gust > 0 ? gust * Math.sin(tSec * 2.7 + 0.4) * 0.65 : 0;
    return Math.max(0, vMps + (wind + gustWave) * longFrac * MPH_TO_MPS);
  }

  /**
   * Tire µ ladder + traction character (Jorge Guerra — deepen realism).
   * Prep mainly boosts DR/Slick toward strip; Street/Summer/UHP/R-Comp modest.
   * Default trackPrep = unprepped (garage Excel SOI / fleet verify).
   * Ladder always: Street < Summer < UHP < R-Comp < Drag Radial < Slick (both modes).
   *
   * Peak µ sources (sportsman Coulomb scale; NOT Top Fuel tread-momentum 3–5):
   *   Wong/HPWizard dry asphalt street peak ~0.80–0.90; racing tires up to ~1.8
   *     http://www.hpwizard.com/tire-friction-coefficient.html
   *   Drag-radial effective µ from 60′ back-calc ~1.5–1.8 on prepared surface
   *     https://www.ls1gto.com/threads/drag-radial-tire-coefficients-of-friction.448707/
   *   Prepped-strip example µ≈1.6 (LivePhysics drag traction)
   *     https://livephysics.com/infographics/engineering-drag-racing-traction-and-the-prepped-track/
   *   Hallum SAE 942484: TF effective >>2 via tread momentum — out of scope here
   *   No-prep culture: slicks need rubber/VHT; unprep slick ≪ prepped slick
   *   MechCodex µ-slip: street peak ~1.0–1.3; racing slick ~1.4–1.8; sliding 10–30% below peak
   *     https://mechcodex.com/learn/dynamics-vibration/tire-slip-ratio
   *   R-compound / 200TW sits between UHP street and DOT drag radial (track-day reality)
   *
   * Kinetic falloff (past peak slip): street compounds shed drive harder; DR/Slick
   * hold more of peak while spinning (softer / glue-like). Prep softens falloff for
   * DR/Slick (VHT + rubber). Matches real 60′ character: Street spins → slow 60′;
   * Slick on prep hooks → low 1.x; Slick on unprep barely beats DR.
   *
   *   Authoritative 60ft targets: TARGET_60FT_BY_PREP (Jorge Mustang GT 10AT chart).
   */
  /** Explicit 60ft targets used to bake TIRE_MU_BY_PREP (Jorge Mustang GT chart). */
  var TARGET_60FT_BY_PREP = {
    unprepped: { 0: 2.200, 3: 2.103, 4: 1.960, 5: 1.900, 1: 1.820, 2: 1.908 },
    prepped:   { 0: 2.040, 3: 1.989, 4: 1.900, 5: 1.850, 1: 1.730, 2: 1.708 }
  };

  var TIRE_MU_BY_PREP = {
    /**
     * Jorge Guerra AUTHORITATIVE Mustang GT 10AT 60ft chart.
     * Baked at forceScale=1, driver 200 lb, launch auto, 70°F / 45% / 29.92 inHg,
     * AFTER stock-automatic stall torque ratio (10R80 STR 1.70, fades by SR 0.90).
     * Unprep: Street 2.200 · Summer 2.103 · UHP 1.960 · R-Comp 1.900 · DR 1.820 · Slick 1.908
     * Prep:   Street 2.040 · Summer 1.989 · UHP 1.900 · R-Comp 1.850 · DR 1.730 · Slick 1.708
     * With STR the unprep power floor is ~1.80s, so every unprep gold time is reachable.
     * Prep DR floors ~1.799 and prep Slick ~1.776 (VHT drive lift). Gold 1.730 / 1.708
     * are under that floor — µ is parked on the hook knee, not raised to fake it.
     * Do not raise peakHp / cut Cd to fake a faster floor.
     */
    unprepped: {
      0: 1.143,  // Street → 2.200
      3: 1.187,  // Summer → 2.103
      4: 1.305,  // UHP → 1.960
      2: 1.331,  // Slick → 1.908
      5: 1.362,  // R-Compound → 1.902 (gold 1.900)
      1: 1.509   // Drag Radial → 1.820
    },
    prepped: {
      0: 1.253,  // Street → 2.039
      3: 1.284,  // Summer → 1.989
      4: 1.371,  // UHP → 1.900
      5: 1.435,  // R-Compound → 1.850
      1: 1.650,  // DR → ~1.799 floor (gold 1.730)
      2: 1.700   // Slick → ~1.776 floor (gold 1.708)
    }
  };

  /**
   * Kinetic fall coefficient by tire (applied as kin = 1 - fall * slip^exp).
   * Higher = more drive lost when spinning (street). Lower = holds better (DR/Slick).
   * Research: sliding µ often 10–30% below peak (MechCodex / Wong sliding column).
   */
  var TIRE_KINETIC_FALL = {
    0: 0.30,  // Street — harsh fall past peak
    3: 0.26,  // Summer
    4: 0.24,  // UHP
    5: 0.20,  // R-Compound
    1: 0.16,  // Drag Radial — soft compound holds while spinning
    2: 0.13   // Slick — glue-like; least kinetic penalty when warm/prepped
  };
  /** Slip exponent: higher → gentler early-slip then steeper late (street-ish). */
  var TIRE_KINETIC_EXP = {
    0: 0.68,
    3: 0.72,
    4: 0.74,
    5: 0.76,
    1: 0.80,
    2: 0.85
  };

  function normalizeTrackPrep(trackPrep) {
    var p = String(trackPrep == null ? 'unprepped' : trackPrep).toLowerCase();
    if (p === 'prepped' || p === 'prep' || p === '1' || p === 'true') return 'prepped';
    return 'unprepped';
  }

  /** Tire ladder: 0 Street, 1 Drag Radial, 2 Slick, 3 Summer, 4 UHP, 5 R-Compound. */
  function tireGripForType(tireType, trackPrep) {
    var prep = normalizeTrackPrep(trackPrep);
    var table = TIRE_MU_BY_PREP[prep] || TIRE_MU_BY_PREP.unprepped;
    var mu = table[tireType | 0];
    return mu != null ? mu : DEFAULT_MU;
  }

  /** Kinetic falloff for spin — prep softens DR/Slick/R-Comp fall (VHT/rubber). */
  function tireKineticParams(tireType, trackPrep) {
    var id = tireType | 0;
    var fall = TIRE_KINETIC_FALL[id];
    var exp = TIRE_KINETIC_EXP[id];
    if (fall == null) fall = 0.22;
    if (exp == null) exp = 0.75;
    if (normalizeTrackPrep(trackPrep) === 'prepped') {
      // Sticky strip: street compounds tiny help; race tires meaningfully milder spin loss
      if (id === 1 || id === 2) fall *= 0.82;
      else if (id === 5) fall *= 0.90;
      else fall *= 0.96;
    }
    return { fall: fall, exp: exp };
  }

  var TIRE_LABELS = {
    0: 'Street',
    1: 'Drag Radial',
    2: 'Slick',
    3: 'Summer',
    4: 'UHP',
    5: 'R-Compound'
  };
  function tireLabelForType(tireType) {
    return TIRE_LABELS[tireType | 0] || TIRE_LABELS[0];
  }
  function trackPrepLabel(trackPrep) {
    return normalizeTrackPrep(trackPrep) === 'prepped' ? 'Prepped' : 'Unprepped';
  }

  function emptyResult(car, env) {
    return {
      carName: (car && car.name) || '',
      reactionTime: 0,
      sixtyFootTime: 0,
      threeThirtyTime: 0,
      eighthMileTime: 0,
      eighthMileSpeedMph: 0,
      thousandFootTime: 0,
      quarterMileTime: 0,
      quarterMileSpeedMph: 0,
      zeroToSixty: null,
      zeroToHundred: null,
      sixtyToOneThirty: null,
      hundredToOneFifty: null,
      peakG: 0,
      peakHorsepower: 0,
      peakTorque: 0,
      wheelspinPercent: 0,
      totalShifts: 0,
      shifts: [],
      densityAltitudeFeet: 0,
      airTempF: (env && env.tempF) != null ? env.tempF : 59,
      launchRpm: 0,
      shiftRpm: 0,
      tireDescription: (env && env.tireLabel) || '',
      timeline: [],
      powerCurve: [],
      gearsUsed: [],
      finalDrive: 0,
      finished: false,
      airDensity: RHO0,
      weatherFactor: 1,
      topSpeedMph: 0,
      topSpeedTime: 0,
      topSpeedFeet: 0,
      vmaxReached: false,
      vmaxReason: '',
      halfMileTime: null,
      halfMileSpeedMph: null,
      mileTime: null,
      mileSpeedMph: null,
      zeroToMph: {},
      zeroToOneThirty: null,
      hundredToTwoHundredKmh: null,
      twoHundredToTwoFiftyKmh: null
    };
  }

  /**
   * @param {object} car
   * @param {object} [env]
   */

  /**
   * Published electronic top-speed limiter (mph).
   * Field: speedLimiterMph (alias topSpeedMph).
   * Enforced whenever OEM/custom limiter is set (>0) — EV, Hybrid, and ICE hypercars
   * with documented electronic Vmax (Chiron/Divo/GT2 RS/etc). Do not invent limiters.
   */
  function resolveSpeedLimiterMph(car) {
    if (!car) return 0;
    var raw = car.speedLimiterMph != null ? car.speedLimiterMph : car.topSpeedMph;
    var lim = Number(raw);
    if (!(lim > 0) || !isFinite(lim)) return 0;
    return lim;
  }


  /**
   * Stock torque-converter stall torque ratio (STR).
   * Only stock automatics. Aftermarket converters keep their own multiply.
   * Manuals, DCT, sequential, MCT, and EVs are not torque-converter autos.
   *
   * TR falls with speed ratio, not a flat 2× through the 60':
   *   speed ratio SR = turbine / engine (0 at stall, ~1 when coupled)
   *   TR = STR at SR 0, linear to 1.0 at the coupling point SR 0.90
   *   (SAE J643-style stall→coupling line).
   *
   * STR assumptions (literature band, not a per-car dyno):
   *   Classic 3/4-speed and the stock LS1 4L60E/4L65E: 1.90.
   *     LS1Tech treats ~1.8 as a tight street STR and calls the stock
   *     F-body converter low-STR; late F-body stall is ~1850 rpm.
   *     1.90 sits in the 1.8–2.0 stock-LS1 band.
   *   6-speed automatics (6L80/6L90/6R80/6HP): 1.80.
   *   Modern 8/10-speed (10R80, 10L90, ZF8, 8L): 1.70.
   *     They flash higher and couple sooner; published STR is often ~1.6–1.8.
   *     The Mustang GT 10R80 60-foot chart is baked on 1.70. Do not raise it.
   *   NAG1 and other 5-speeds: 2.00. Real stock stall is about 1.8–2.2,
   *     not a loose 2.8 converter. 2.00 is the middle of that band.
   */
  function stockStallTorqueRatio(car) {
    var blob = (String(car.txKey || '') + ' ' + String(car.transmission || '') + ' ' +
      String(car.txFactoryLabel || '')).toLowerCase();
    if (/10r|10l|8l90|8l45|8hp|zf8|9hp|10at|8at|10-spd|8-spd|10spd|8spd/.test(blob)) return 1.70;
    if (/6l80|6l90|6r80|6r140|zf_6|6hp|6at|6-spd|6spd/.test(blob)) return 1.80;
    // 5-speed converters (NAG1, 5R110, RE5R05A, A750, U151, "*5AT").
    // Gear count catches a 5-speed whose key does not say "5".
    var gearsN = car && car.gearRatios ? car.gearRatios.length : 0;
    if (/nag1|5at|5r110|5-spd|5spd|re5r|a750|u151/.test(blob) || gearsN === 5) return 2.00;
    return 1.90;
  }

  /**
   * Per-axle traction (L/R split + load sensitivity + street LSD blend).
   * Same formula the launch loop uses. driveType picks the lock fraction.
   */
  function axleTractionLimitN(nAxle, muAx, leftP, driveType) {
    var nL = nAxle * (leftP / 100.0);
    var nR = nAxle * (1.0 - leftP / 100.0);
    var nRef = Math.max(1e-6, nAxle * 0.5);
    function sideForce(n) {
      var sens = Math.pow(nRef / Math.max(n, nRef * 0.12), 0.14);
      return muAx * n * clamp(sens, 0.72, 1.18);
    }
    var fL = sideForce(nL);
    var fR = sideForce(nR);
    var locked = fL + fR;
    var open = 2.0 * Math.min(fL, fR);
    var lockFrac = driveType === 'AWD' ? 0.72 : 0.60;
    return open * (1.0 - lockFrac) + locked * lockFrac;
  }

  /**
   * Slipping-clutch inertia ratio from engine torque, not from the tire fitted.
   * Steady wheel force already able to break an unprepped street tire → 1.0.
   * A single fleet ratio (the old 3.20) added torque on cars that were already
   * loose and slowed them (2018 GT PP2 street 60-foot ~2.11 → ~2.37).
   * Under that street tire → only enough to land ~8% over unprepped-street
   * grip (inside the 5–12% band). The same ratio is used on every compound:
   * a stickier tire must not raise the spike, or street and slick accelerate
   * the same and the 60-foot ladder goes flat.
   * Cap 2.9 is the clutch-inertia ceiling, not a fleet ratio. 2.2 peaked
   * near 15,950 N on the stock Camaro at 2000 rpm, under about 18,200 N of
   * weight-transferred street grip, so a normal leave stayed hooked. The
   * street-grip target for that car is about 2.87; 2.9 lets that target
   * through. Cars already over the street tire stay at 1.0. It is not 3.20.
   * gripN is the unprepped-street reference only.
   */
  var CLUTCH_INERTIA_CAP = 2.9;
  var CLUTCH_OVER_GRIP = 1.08;
  function manualClutchInertiaRatio(steadyForceN, gripN) {
    if (!(steadyForceN > 1) || !(gripN > 1)) return 1.0;
    if (steadyForceN >= gripN) return 1.0;
    var need = (gripN * CLUTCH_OVER_GRIP) / steadyForceN;
    if (need < 1.0) return 1.0;
    if (need > CLUTCH_INERTIA_CAP) return CLUTCH_INERTIA_CAP;
    return need;
  }

  /**
   * Unprepped-street traction the clutch spike is sized against.
   * Solved at the street-tire traction limit so weight transfer is in the
   * reference, but the fitted tire's mu and its acceleration are not.
   * Same number for street, slick, prepped, and unprepped.
   */
  function streetReferenceGripN(mass, g, frontPct, rearPct, leftPct, driveType, mu, cg, wb) {
    var w = mass * g;
    var cgWb = cg / Math.max(wb, 1e-6);
    var nMin = w * 0.08;
    if (driveType === 'AWD') {
      var nF = Math.max(nMin, w * (frontPct / 100.0));
      var nR = Math.max(nMin, w * (rearPct / 100.0));
      return axleTractionLimitN(nF, mu, leftPct, driveType) +
        axleTractionLimitN(nR, mu, leftPct, driveType);
    }
    if (driveType === 'FWD') {
      var denomF = 1.0 + mu * cgWb;
      if (denomF < 0.25) denomF = 0.25;
      var nFront = w * (frontPct / 100.0) / denomF;
      if (nFront < nMin) nFront = nMin;
      return axleTractionLimitN(nFront, mu, leftPct, driveType);
    }
    var denomR = 1.0 - mu * cgWb;
    if (denomR < 0.25) denomR = 0.25;
    var nRear = w * (rearPct / 100.0) / denomR;
    if (nRear < nMin) nRear = nMin;
    var nRearMax = w - nMin;
    if (nRear > nRearMax) nRear = nRearMax;
    return axleTractionLimitN(nRear, mu, leftPct, driveType);
  }

  function isStockTorqueConverterAuto(car) {
    if (!car || car.isEv || car.powerSource === 'ev' || car.hasAftermarketConverter) return false;
    if (resolveShiftDriveFamily(car) !== 'automatic') return false;
    var blob = (String(car.txKey || '') + ' ' + String(car.transmission || '') + ' ' +
      String(car.txFactoryLabel || '')).toLowerCase();
    // Wet-clutch / direct-drive units labeled Auto are not converters.
    if (/mct|koenigsegg_kdd|direct drive|direct-drive/.test(blob)) return false;
    return true;
  }

  /**
   * ---------------------------------------------------------------------------
   * 2026 Tesla Roadster ONLY — car-scoped add-on path (credit Jorge Guerra).
   * Two physical terms that stock PowerCurve does not model:
   *   1) Fan suction downforce (both trims): a speed-independent normal force
   *      added to the tire loads (split by static F/R %). ESTIMATE.
   *   2) Rear cold-gas thrusters (Thrust trim only): COPV blowdown → choked
   *      converging-diverging nozzles. Thrust acts on the body directly (does
   *      not go through the tires), and the vented gas mass leaves the car.
   *
   * Gate: the add-on is resolved ONLY when car.id is one of ROADSTER_ADDON_IDS
   * AND car.roadsterAddon.model === ROADSTER_ADDON_MODEL. Any other car (incl.
   * Custom Builder, id 'custom') gets null and runs the exact stock code path.
   *
   * Thruster physics (all inputs are ESTIMATES; Tesla published only ">80 kN"):
   *   Tank: fixed volume V at fill pressure P0, fill temp T0 (dry air).
   *     Fill density from Peng-Robinson (Tc 132.5 K, Pc 3.766 MPa, ω 0.035),
   *     so 700 bar air is ~589 kg/m³ (Z≈1.41), not the ideal-gas 832 kg/m³.
   *   Blowdown: ISENTROPIC (adiabatic) — a ~1 s vent leaves no time for heat
   *     in from the tank walls. Gas temp follows T = T0·(ρ/ρ0)^(γ−1) (ideal-gas
   *     entropy, γ=1.4); pressure from Peng-Robinson at that (ρ, T).
   *   Throat: choked flow, ṁ = Cd·A*·Γ·√(P·ρ), Γ = √γ·(2/(γ+1))^((γ+1)/(2(γ−1))).
   *   Nozzle: fixed area ratio ε; exit Mach from ε (supersonic root), exit
   *     pressure pe = P·(1+(γ−1)/2·Me²)^(−γ/(γ−1)), ve = Me·√(γ·(P/ρ)·Te/T).
   *   Thrust: F = η·[ṁ·ve + (pe − pa)·Ae]  (pressure term goes negative when
   *     over-expanded late in the blowdown). Floored at 0.
   *   Throat area A* is sized so the FIRST-INSTANT thrust equals thrustPeakN
   *     (the reported 80 kN). Everything after that (taper, burn time) is an
   *     output of the blowdown, not a fitted number.
   *   Burn: valves open at t=0 (green) and stay open until tank pressure falls
   *     to cutoffPa or thrust ≤ 0. Mass loss: car mass −= ṁ·dt each step.
   * ---------------------------------------------------------------------------
   */
  var ROADSTER_ADDON_IDS = { '2026-tesla-roadster': 1, '2026-tesla-roadster-thrust': 1 };
  var ROADSTER_ADDON_MODEL = 'tesla-roadster-2026-v1';
  var CG_GAMMA = 1.4, CG_R = 287.05, CG_M = 0.028965;
  var CG_GAMMA_FN = Math.sqrt(CG_GAMMA) * Math.pow(2 / (CG_GAMMA + 1), (CG_GAMMA + 1) / (2 * (CG_GAMMA - 1)));

  function cgPrPressure(rho, T) {
    var Ru = 8.314462618, Tc = 132.5, Pc = 3.766e6, w = 0.035;
    var vm = CG_M / rho;
    var k = 0.37464 + 1.54226 * w - 0.26992 * w * w;
    var al = Math.pow(1 + k * (1 - Math.sqrt(T / Tc)), 2);
    var a = 0.45724 * Ru * Ru * Tc * Tc / Pc * al, b = 0.07780 * Ru * Tc / Pc;
    return Ru * T / (vm - b) - a / (vm * vm + 2 * b * vm - b * b);
  }
  function cgPrDensity(P, T) {
    var lo = 1e-4, hi = 1000;
    for (var i = 0; i < 120; i++) { var m = 0.5 * (lo + hi); if (cgPrPressure(m, T) < P) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }
  function cgAreaRatio(M) {
    var g = CG_GAMMA;
    return (1 / M) * Math.pow((2 / (g + 1)) * (1 + 0.5 * (g - 1) * M * M), (g + 1) / (2 * (g - 1)));
  }
  function cgExitMach(eps) {
    var lo = 1.0000001, hi = 20;
    for (var i = 0; i < 100; i++) { var m = 0.5 * (lo + hi); if (cgAreaRatio(m) < eps) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }
  /** Per-unit-throat-area nozzle state at tank (P, ρ, T). */
  function cgNozzle(P, rho, T, cfg, Me) {
    var g = CG_GAMMA;
    var ratioT = 1 + 0.5 * (g - 1) * Me * Me;
    var pe = P * Math.pow(ratioT, -g / (g - 1));
    var ve = Me * Math.sqrt(g * (P / rho) / ratioT);
    var mdotPerA = cfg.dischargeCoeff * CG_GAMMA_FN * Math.sqrt(P * rho);
    var fPerA = cfg.thrustEfficiency * (mdotPerA * ve + (pe - cfg.ambientPa) * cfg.areaRatio);
    return { mdotPerA: mdotPerA, fPerA: fPerA, pe: pe, ve: ve };
  }
  function coldGasThrusterInit(cfg) {
    var V = cfg.tankVolumeL / 1000;
    var rho0 = cgPrDensity(cfg.fillPressurePa, cfg.fillTempK);
    var Me = cgExitMach(cfg.areaRatio);
    var n0 = cgNozzle(cfg.fillPressurePa, rho0, cfg.fillTempK, cfg, Me);
    var aStar = cfg.thrustPeakN / n0.fPerA;
    return {
      cfg: cfg, V: V, rho0: rho0, rho: rho0, T: cfg.fillTempK, P: cfg.fillPressurePa,
      gasMass0: rho0 * V, gasMass: rho0 * V, Me: Me, aStar: aStar,
      throatDiaPerNozzleMm: Math.sqrt(4 * aStar / cfg.nozzleCount / Math.PI) * 1000,
      active: true, burnEnd: null, impulse: 0, peakThrust: 0, F: 0, mdot: 0
    };
  }
  /** Advance the thruster one step; returns thrust (N). Mutates st. */
  function coldGasThrusterStep(st, dt, t) {
    if (!st.active) { st.F = 0; st.mdot = 0; return 0; }
    var n = cgNozzle(st.P, st.rho, st.T, st.cfg, st.Me);
    var F = n.fPerA * st.aStar;
    var mdot = n.mdotPerA * st.aStar;
    if (F <= 0 || st.P <= st.cfg.cutoffPa || st.gasMass <= 0) {
      st.active = false; st.burnEnd = t; st.F = 0; st.mdot = 0; return 0;
    }
    var dm = Math.min(mdot * dt, st.gasMass);
    st.gasMass -= dm;
    st.rho = st.gasMass / st.V;
    st.T = st.cfg.fillTempK * Math.pow(st.rho / st.rho0, CG_GAMMA - 1);
    st.P = cgPrPressure(st.rho, st.T);
    st.impulse += F * dt;
    if (F > st.peakThrust) st.peakThrust = F;
    st.F = F; st.mdot = dm / dt;
    return F;
  }
  function resolveRoadsterAddon(car) {
    if (!car || !Object.prototype.hasOwnProperty.call(ROADSTER_ADDON_IDS, String(car.id))) return null;
    var a = car.roadsterAddon;
    if (!a || a.model !== ROADSTER_ADDON_MODEL) return null;
    var out = { suctionN: Math.max(0, Number(a.suctionDownforceLbf) || 0) * 4.4482216152605, thruster: null };
    if (car.id === '2026-tesla-roadster-thrust' && a.thruster) {
      var th = a.thruster;
      out.thruster = coldGasThrusterInit({
        tankVolumeL: Number(th.tankVolumeL), fillPressurePa: Number(th.fillPressureBar) * 1e5,
        fillTempK: Number(th.fillTempK), areaRatio: Number(th.nozzleAreaRatio),
        dischargeCoeff: Number(th.dischargeCoeff), thrustEfficiency: Number(th.thrustEfficiency),
        ambientPa: 101325, cutoffPa: Number(th.cutoffBar) * 1e5,
        thrustPeakN: Number(th.thrustPeakN), nozzleCount: Number(th.nozzleCount) || 4
      });
    }
    return out;
  }

  function runQuarterMile(car, env) {
    env = env || {};
    var result = emptyResult(car, env);

    var gears = (car.gearRatios || []).map(Number).filter(function (g) { return g > 0; });
    if (!gears.length) return result;

    // Curb + driver: prefer env.driverWeightLbs (recalib/UI), else car.driverWeightLbs, else 200.
    var curbLbs = clamp(Number(car.weightLbs) || 3500, 20, 120000);
    var driverRaw;
    if (env.driverWeightLbs != null && env.driverWeightLbs !== '') {
      driverRaw = Number(env.driverWeightLbs);
    } else if (car.driverWeightLbs != null && car.driverWeightLbs !== '') {
      driverRaw = Number(car.driverWeightLbs);
    } else {
      driverRaw = 200;
    }
    if (!isFinite(driverRaw)) driverRaw = 200;
    var driverLbs = clamp(driverRaw, 0, 500);
    var weightLbs = curbLbs + driverLbs;
    var mass = weightLbs * 0.453592;
    var tireRadius = (Number(car.tireRadiusInches) || 13.0) * 0.0254;
    var frontalArea = (Number(car.frontalAreaSqFt) || 22.0) * 0.092903;
    var cd = Number(car.dragCoefficient) || 0.35;
    var finalDrive = Number(car.finalDriveRatio) || 3.73;
    var loss = (car.drivetrainLossPercent != null ? Number(car.drivetrainLossPercent) : DEFAULT_LOSS_PCT) / 100.0;
    var shiftTime = car.shiftTimeSeconds != null ? Number(car.shiftTimeSeconds) : DEFAULT_SHIFT_TIME;
    var shiftRpm = car.shiftRpm != null ? Number(car.shiftRpm) : DEFAULT_SHIFT_RPM;
    var launchRpm = car.launchRpm != null ? Number(car.launchRpm) : DEFAULT_LAUNCH_RPM;
    // Motorcycles: car defaults (WB 8.5 ft / CG 1.5 ft) understate weight transfer and
    // starve RWD traction — use sportbike + rider geometry when unset.
    var isBikeChassis = !!(car.category === 'Motorcycle' ||
      /ninja|hayabusa|yamaha yzf|suzuki gsx|honda cbr|ducati|bmw s1000|motorcycle|bike\b|panigale/i.test(String(car.name || '')));
    var wbFtDefault = isBikeChassis ? 4.70 : DEFAULT_WB_FT;
    var cgFtDefault = isBikeChassis ? 1.85 : DEFAULT_CG_FT;
    var wheelbaseM = (Number(car.wheelbaseFeet) || wbFtDefault) * FEET_TO_M;
    var cgHeightM = (Number(car.cgHeightFeet) || cgFtDefault) * FEET_TO_M;
    var wDist = resolveWeightDistribution(car);
    var frontPct = wDist.frontWeightPercent;
    var rearPct = wDist.rearWeightPercent;
    var leftPct = wDist.leftWeightPercent;
    var muBase = env.tireGrip != null ? Number(env.tireGrip) : tireGripForType(env.tireType, env.trackPrep);
    var driveType = String(car.driveType || 'RWD').toUpperCase();
    // AWD already sums BOTH axle traction limits — do NOT multiply µ again (old ×1.25 invented grip).

    var curve = car.torqueCurve;
    if (!curve || (typeof curve === 'object' && !Array.isArray(curve) && !Object.keys(curve).length)) {
      curve = synthesizeTorqueCurve(car.peakHp || car.horsepower, car.peakTqRpm, car.redline, car.peakHpRpm);
    } else {
      // peakHp honesty for ICE + EV. Post-peak dyno-fall sanitize is ICE-only;
      // both are capped to published peakHp when set (no inflated motor-map cheat).
      curve = Object.assign({}, curve);
      if (!car.isEv) sanitizeTorqueCurvePostPeak(curve, car.peakHpRpm, car);
      if (car.peakHp > 0) capTorqueCurveToPeakHp(curve, car.peakHp);
    }

    var tempF = env.tempF != null ? Number(env.tempF) : 59;
    var humidity = env.humidity != null ? Number(env.humidity) : 50;
    var pressureInHg = env.pressureInHg != null ? Number(env.pressureInHg) : 29.92;
    var daFt;
    if (env.densityAltitudeFtInput != null && !isNaN(Number(env.densityAltitudeFtInput))) {
      daFt = Number(env.densityAltitudeFtInput);
    } else {
      // Always compute real DA (humidity + pressure + temp) — including EVs.
      // EV motors ignore DA via weatherTorqueFactor→1; aero must still feel rho.
      daFt = computeDensityAltitude(tempF, humidity, pressureInHg);
    }
    var rho = airDensityFromDA(daFt);
    var wx = weatherTorqueFactor(
      {
        isEv: !!car.isEv,
        isHybrid: !!car.isHybrid,
        isNA: !!(car.isNA || (!car.isFI && !car.isEv && !car.isHybrid)),
        isFI: !!car.isFI
      },
      daFt, rho
    );

    var windMph = Number(env.windSpeedMph) || 0;
    var windDir = Number(env.windDirDeg) || 0;
    var gustMph = Number(env.gustMph) || 0;
    var boostModel = car.boostModel || 'na';
    var boostPsi = Number(car.boostPsi) || 0;
    var redline = Number(car.redline) || shiftRpm;

    var launchMode = env.launchMode || 'auto';
    // Named steps blend Soft (0) toward Aggressive (1) on the knobs those two already use.
    // 60-foot is not linear in those knobs. Medium is unchanged: drive 0.35,
    // leave/slip/stall/flash/hold halfway, grip at Aggressive, tip/keep at Soft.
    // Mild and Hard use those same knobs. Leave/slip/flash/hold sit halfway between
    // the neighbor steps. Grip stays at Aggressive. Drive is set for the street
    // 60-foot. Mild stall and Hard tip are the extra existing knobs that put the
    // prepped slick on the same average. Weights stay inside Soft and Aggressive.
    // Soft, Medium, and Aggressive weights are unchanged.
    var mediumDrive = 0.35;
    var mediumLeave = 0.50;
    var mediumMu = 1.0;
    var mediumTip = 0.0;
    // Halfway leave from Soft (0) to Medium (0.50). Stall is hotter than that
    // halfway; tied stall left the slick 60-foot long once drive fit the street car.
    var mildDrive = 0.09;
    var mildLeave = 0.25;
    var mildStall = 0.62;
    var mildMu = 1.0;
    var mildTip = 0.0;
    // Leave is just above halfway from Medium (0.50) to Aggressive (1).
    // Tip is what lets the street car meet the average at a drive the slick can live with.
    var hardDrive = 0.64;
    var hardLeave = 0.80;
    var hardMu = 1.0;
    var hardTip = 0.80;
    // Jorge Guerra: stock AUTOMATICS — calm D-gate leave at 2200 in Auto
    // launch mode. Cap brake-stand dumps, and raise an unrealistic bog
    // (stored launch below 2200, e.g. 1200) up to 2200. Never above 2200.
    // Manuals, EVs, DCT, sequential, and aftermarket converters are not
    // touched. Soft/Aggressive/Custom stay user-intent (applied after this).
    var STOCK_AUTO_CALM_LAUNCH = 2200;
    if (!car.isEv && !car.hasAftermarketConverter &&
        (launchMode === 'auto' || launchMode == null || launchMode === '') &&
        /auto/i.test(String(car.transmission || '')) &&
        !/manual|mt\b|stick/i.test(String(car.transmission || ''))) {
      launchRpm = STOCK_AUTO_CALM_LAUNCH;
    }
    var slipTarget = 0.10;
    var launchDriveMult = 1.0;
    // Soft = cooler leave/tach (NOT mu-cheat fastest). Aggressive = hotter ATC flash-stall
    // + full drive (on slicks often quicker if grip holds — NOT systematically slowest).
    // Auto = identity. slipTarget is live for Soft/Agg/Custom (mu + traction band).
    var launchStallBias = 0;
    var launchFlashSpanScale = 1.0;
    var launchFlashTimeScale = 1.0;
    var launchFlashMphScale = 1.0;
    var clutchLaunchFamily = resolveShiftDriveFamily(car);
    var clutchLaunchLocked = clutchLaunchFamily === 'manual' || clutchLaunchFamily === 'dct';
    var launchBlend = null;
    if (launchMode === 'mild') launchBlend = { drive: mildDrive, leave: mildLeave, mu: mildMu, tip: mildTip, stall: mildStall };
    else if (launchMode === 'medium') launchBlend = { drive: mediumDrive, leave: mediumLeave, mu: mediumMu, tip: mediumTip };
    else if (launchMode === 'hard') launchBlend = { drive: hardDrive, leave: hardLeave, mu: hardMu, tip: hardTip };
    if (launchMode === 'soft') {
      // Lower leave, muted converter flash/stall, mild drive ease — cooler tach
      // Manual and DCT rpm is the user's number. Soft does not move it.
      if (!clutchLaunchLocked) {
        launchRpm = Math.max(car.isEv ? 200 : 1100, launchRpm - 800);
      }
      slipTarget = 0.06;
      launchDriveMult = car.isEv ? 0.86 : 0.875;
      launchStallBias = -500;
      launchFlashSpanScale = 0.40;
      launchFlashTimeScale = 0.50;
      launchFlashMphScale = 0.68;
    } else if (launchBlend) {
      // Manual and DCT rpm is the user's number. These modes do not move it.
      if (!clutchLaunchLocked) {
        var softLeave = Math.max(car.isEv ? 200 : 1100, launchRpm - 800);
        var aggLeave = Math.min(redline, launchRpm + (car.isEv ? 1400 : 1000));
        launchRpm = softLeave + (aggLeave - softLeave) * launchBlend.leave;
      }
      slipTarget = 0.06 + (0.15 - 0.06) * launchBlend.leave;
      launchDriveMult = car.isEv
        ? (0.86 + (1.12 - 0.86) * launchBlend.drive)
        : (0.875 + (1.11 - 0.875) * launchBlend.drive);
      var stallW = launchBlend.stall != null ? launchBlend.stall : launchBlend.leave;
      launchStallBias = -500 + (400 - -500) * stallW;
      launchFlashSpanScale = 0.40 + (1.52 - 0.40) * launchBlend.leave;
      launchFlashTimeScale = 0.50 + (1.30 - 0.50) * launchBlend.leave;
      launchFlashMphScale = 0.68 + (1.25 - 0.68) * launchBlend.leave;
    } else if (launchMode === 'aggressive') {
      // Higher leave, hotter flash-stall ceiling, full+ drive — slicks often quicker
      // Manual and DCT rpm is the user's number. Aggressive does not raise it.
      if (!clutchLaunchLocked) {
        launchRpm = Math.min(redline, launchRpm + (car.isEv ? 1400 : 1000));
      }
      slipTarget = 0.15;
      launchDriveMult = car.isEv ? 1.12 : 1.11;
      launchStallBias = 400;
      launchFlashSpanScale = 1.52;
      launchFlashTimeScale = 1.30;
      launchFlashMphScale = 1.25;
    } else if (launchMode === 'custom') {
      if (env.customLaunchRpm > 0) launchRpm = env.customLaunchRpm;
      if (env.customSlipTarget > 0) slipTarget = env.customSlipTarget;
    }
    // slipTarget → narrow mu (Soft ~1.03 max). Aggressive forced to full grip (1.0)
    // so hot leave is NOT systematically slowest via mu kneecap.
    var launchMuMult = 1.0;
    if (launchMode === 'soft' || launchMode === 'custom') {
      launchMuMult = clamp(1.0 + (0.10 - slipTarget) * 0.6, 0.96, 1.04);
    } else if (launchBlend) {
      // mu = 1 uses Aggressive full grip. Soft's higher mu left the street 60-foot short of the average.
      var softMu = clamp(1.0 + (0.10 - 0.06) * 0.6, 0.96, 1.04);
      launchMuMult = softMu + (1.0 - softMu) * launchBlend.mu;
    } else if (launchMode === 'aggressive') {
      launchMuMult = 1.0; // full grip; slipTarget used in traction keep band
    }
    // EV factory traction control / AWD launch (Jorge Guerra): stock EVs — especially
    // AWD — leave hard with TC metering torque to available grip. Auto mode is not
    // ICE-identity; give a mild drive + µ lift so 60ft/0-60 match real EV launches.
    // Does not invent fleet-wide AWD µ×1.25 (axles already summed). Soft/Agg unchanged.
    if (car.isEv && (launchMode === 'auto' || launchMode == null || launchMode === '')) {
      var evAwd = driveType === 'AWD';
      launchDriveMult = evAwd ? 1.10 : 1.05;
      launchMuMult = evAwd ? 1.06 : 1.03;
      slipTarget = evAwd ? 0.12 : 0.10;
      // Per-car OEM/TC launch bake (Jorge Guerra EV Excel full-match). Optional overrides
      // on top of AWD/FWD stock TC — not Soft/Agg. forceScale stays 1.
      if (car.evLaunchDriveMult != null && isFinite(Number(car.evLaunchDriveMult))) {
        launchDriveMult = clamp(Number(car.evLaunchDriveMult), 0.70, 1.85);
      }
      if (car.evLaunchMuMult != null && isFinite(Number(car.evLaunchMuMult))) {
        launchMuMult = clamp(Number(car.evLaunchMuMult), 0.85, 1.40);
      }
      if (car.evLaunchSlipTarget != null && isFinite(Number(car.evLaunchSlipTarget))) {
        slipTarget = clamp(Number(car.evLaunchSlipTarget), 0.04, 0.22);
      }
    }
    // Prepped strip race-tire hook (Jorge Guerra Mustang GT chart): µ alone cannot
    // beat Mustang ~1.738s power floor for Prep DR 1.730 / Slick 1.708. Mild auto-mode
    // drive lift for DR/Slick on Prepped only — models VHT/rubber hook beyond peak µ.
    // Tunable constants; forceScale stays 1. Soft/Agg unchanged.
    if ((launchMode === 'auto' || launchMode == null || launchMode === '') &&
        normalizeTrackPrep(env.trackPrep) === 'prepped') {
      var prepTire = env.tireType != null ? (env.tireType | 0) : (car.tireType | 0);
      if (prepTire === 2) { // Slick
        launchDriveMult *= 1.039;
      } else if (prepTire === 1) { // Drag Radial
        launchDriveMult *= 1.011;
      }
    }

    // Clutch cars (manual and DCT): a typed rpm wins and is never raised.
    // With no typed rpm the tire-grip suggestion replaces a stored dump.
    // Soft and aggressive already left this number alone.
    if (clutchLaunchLocked) {
      if (env.customLaunchRpm > 0) {
        launchRpm = Number(env.customLaunchRpm);
      } else {
        launchRpm = suggestedClutchLaunchRpm(car, env.tireType, env.trackPrep);
      }
    }

    // Effective leave target (absurd ICE launchRpm → peak-TQ band)
    var leaveRpm = resolveLeaveRpm(car, launchRpm, redline, curve);
    launchRpm = leaveRpm; // soft/aggressive/custom already applied above
    result.launchRpm = Math.round(leaveRpm);
    result.shiftRpm = Math.round(shiftRpm);
    result.densityAltitudeFeet = daFt;
    result.airTempF = tempF;
    result.airDensity = rho;
    result.weatherFactor = wx;
    result.gearsUsed = gears.slice();
    result.finalDrive = finalDrive;

    var keys = Object.keys(curve).map(Number).filter(function (k) { return isFinite(k); });
    keys.sort(function (a, b) { return a - b; });
    if (keys.length) {
      var r0 = Math.floor(keys[0] / 100) * 100;
      if (r0 < keys[0]) r0 += 100;
      var r1 = Math.max(keys[keys.length - 1], redline);
      for (var rk = r0; rk <= r1 + 0.01; rk += 100) {
        var rpmK = Math.round(rk);
        var tq0 = getTorqueAtRpm(curve, rpmK);
        if (!car.isEv) {
          tq0 *= boostTorqueMult(boostModel, boostPsi, rpmK, redline, pressureInHg);
          tq0 += hybridAssistTorqueLbFt(rpmK, car);
        }
        result.powerCurve.push({ rpm: rpmK, torque: tq0, horsepower: (tq0 * rpmK) / 5252 });
      }
    }

    var v = 0, dist = 0, t = 0, rpm = launchRpm, gear = 1;
    var launchLocked = false; // after first catch, always follow mechRpm (preserve shift drops)
    // High clutch dump only. Set when 1st is slipping above the torque peak.
    var manualBog = false;
    var prevSpinPct = 0; // prior-step wheelspin % — shapes stock flash/dip (vehicle-varying)
    var shifting = false, shiftTimer = 0;
    // ATC post-upshift hang: engine RPM floor after unlock-on-shift (0 = inactive).
    // Launch flash/stall/mph-lockup path is untouched when this is 0.
    // Seed remembers the post-shift floor; hang soft-climbs continuously toward shiftRpm while slipping.
    var tcPostShiftHangRpm = 0;
    var tcPostShiftHangSeed = 0;
    var tcPostShiftMechSeed = 0; // turbine at unlock; hang lerps seed→shift with mech progress
    var shiftFamily = resolveShiftDriveFamily(car);
    var shiftResidualFrac = shiftResidualFraction(shiftFamily);
    var shiftReleaseFrac = shiftReleaseFraction(shiftFamily);
    var shiftEngageDur = shiftEngageTime(shiftFamily);
    var shiftEngageOS = shiftEngageOvershoot(shiftFamily);
    var lastDriveWhTQ = 0; // last applied (post-ATC) wheel torque — shift blend source
    var engageTimer = 0;   // post-shift soft engage countdown
    var engageFromTQ = 0;  // TQ at shift-end (notch/recover) — engage blend start
    // Driveline compliance tracks POST-TRACTION tire force (g ↔ TRACTION % hand-in-hand).
    // Underdamped half-shaft / converter — tips on launch/engage/TQ/traction events only.
    // No decorative IMU jitter decoupled from tire force.
    var dlForce = 0;
    var dlVel = 0;
    var dlSeeded = false;
    var DL_WN = 110.0;   // rad/s ≈ 17.5 Hz — snappy tips on traction/engage/TQ
    var DL_ZETA = 0.38;  // underdamped: rings on real events, settles without stairs
    var driveFLp = 0;
    var driveFLpSeeded = false;
    var peakEngTQRef = 0;
    if (curve) {
      if (Array.isArray(curve)) {
        for (var ci = 0; ci < curve.length; ci++) {
          var ct = Number(curve[ci] && (curve[ci].torque != null ? curve[ci].torque : curve[ci].tq));
          if (ct > peakEngTQRef) peakEngTQRef = ct;
        }
      } else {
        Object.keys(curve).forEach(function (k) {
          var ct = Number(curve[k]);
          if (ct > peakEngTQRef) peakEngTQRef = ct;
        });
      }
    }
    if (peakEngTQRef < 50) peakEngTQRef = 400;
    var shiftProbe = env.shiftCoastProbe ? { family: shiftFamily, residual: shiftResidualFrac, release: shiftReleaseFrac, engageS: shiftEngageDur, overshoot: shiftEngageOS, n: 0, sumA: 0, minA: Infinity, sumWhTQ: 0, minWhTQ: Infinity } : null;
    var spinSum = 0, spinN = 0, prevA = 0;
    var hit60 = false, hit330 = false, hit660 = false, hit1000 = false, hit1320 = false;
    var hitHalf = false, hitMile = false;
    var qmT = null, qmMph = null;
    var t060 = null, t0100 = null, t60_130 = null, t100_150 = null;
    var at60 = null, at100 = null;
    // 0–N mph crossings (same 1 ms step as 0-60). Missing marks stay unset.
    var ZERO_MPH_MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
    var zeroToMph = {};
    var nextZeroIdx = 0;
    // km/h windows: exact mph = km/h / 1.609344 (international mile).
    var KMH_PER_MPH = 1.609344;
    var mph100kmh = 100 / KMH_PER_MPH;
    var mph200kmh = 200 / KMH_PER_MPH;
    var mph250kmh = 250 / KMH_PER_MPH;
    var t100kmh = null, t200kmh = null, t250kmh = null;
    var peakG = 0, peakHP = 0, peakTQ = 0;
    var sampleAcc = 0;
    var rollBase = 0.015 * mass * G;
    // Tesla Roadster 2026 only (null for every other car → stock path untouched).
    var rsAddon = resolveRoadsterAddon(car);
    var rsGasMass = 0, rsThrustF = 0, rsT1ft = null, rsTrace = null;
    if (rsAddon && rsAddon.thruster) {
      // Car curb weight includes the full gas charge; it leaves as it vents.
      rsGasMass = rsAddon.thruster.gasMass0;
      rsTrace = [];
    }
    var vmaxHold = 0;
    var vmaxDone = false;
    var vmaxReason = '';
    var peakMph = 0, peakMphT = 0, peakMphFt = 0;
    var distCapM = VMAX_DIST_CAP_FT * FEET_TO_M;
    var speedLimiterMph = resolveSpeedLimiterMph(car);
    // When an OEM/custom limiter is set, it becomes the operative Vmax (Nevera-class may exceed the 250 safety).
    var operativeCapMph = speedLimiterMph > 0 ? speedLimiterMph : VMAX_SPEED_CAP_MPH;
    var speedCapMps = operativeCapMph * MPH_TO_MPS;
    var limiterMps = speedLimiterMph > 0 ? speedLimiterMph * MPH_TO_MPS : 0;

    // Continue past 1320 ft to mechanical/aero Vmax (or OEM limiter / safety cap)
    while (!vmaxDone && t <= MAX_T) {
      if (shifting) {
        shiftTimer -= DT;
        if (shiftTimer <= 0) {
          shifting = false;
          // Arm post-shift engagement from torque at shift-end (ATC may have recovered above hole).
          engageFromTQ = (shiftFamily === 'automatic')
            ? (lastDriveWhTQ * Math.max(shiftResidualFrac, 0.70))
            : (lastDriveWhTQ * shiftResidualFrac);
          engageTimer = shiftEngageDur;
        }
      }

      var inLaunch = (t < LAUNCH_HOLD && v < LAUNCH_V_THRESH) || (dist < LAUNCH_DIST_M && t < LAUNCH_HOLD + 0.4);
      var wheelRpm = tireRadius > 0 ? (v / (2 * Math.PI * tireRadius)) * 60.0 : 0;

      if (!shifting) {
        var gNow = gears[Math.min(gear, gears.length) - 1];
        var mechRpm = wheelRpm * gNow * finalDrive;
        var mphNow = v * MPS_TO_MPH;
        if (car.hasAftermarketConverter) {
          /**
           * Aftermarket stall converter (realistic-lite):
           * - Stall RPM = engine speed against a stalled/near-stalled turbine (brake launch).
           * - Flash RPM = brief free-rev peak as the converter unloads off the line
           *   (high-stall default scales well above stall — Circle D 4400 → ~6400).
           * - Slip decays with road speed toward lockup (~1:1 by ~50 mph).
           * - Post-upshift ONLY: unlock/slip hang lerps seed→shiftRpm with turbine
           *   progress (smooth tach all the way to next shift); stall 1500–5500
           *   scales gap/slip/multiply (low=larger gap/less slip; high=smaller gap/more
           *   slip + torque-multiply). Trap-unlock / postFade Excel-chase invents retired.
           */
          var stall = Number(car.stallRpm) || 2800;
          stall = Math.max(1200, stall + launchStallBias);
          // Stall factor spans real converter band 1500→5500 (not clamped flat below 2200).
          // High-stall ATC flash ceiling scales with stall; Circle D 4400 → ~6400-class.
          // Optional car.flashRpm still wins if baked; UI no longer exposes it. Stock/non-ATC never enters here.
          // Soft/Aggressive modulate stall + flash span; Auto bias0/span1 = prior path.
          var stallFacFlash = clamp((stall - 1500) / 4000, 0, 1);
          var flash = Number(car.flashRpm) || Math.max(stall + Math.round(240 + stallFacFlash * 900), stall + 200);
          if (flash < stall) flash = stall;
          var flashSpan = Math.max(0, flash - stall);
          flash = stall + flashSpan * launchFlashSpanScale;
          if (flash > Math.max(shiftRpm, stall)) flash = Math.max(shiftRpm, stall);
          if (flash < stall) flash = stall;
          if (tcPostShiftHangRpm > 0) {
            // Inter-shift open-converter climb: seed keeps ~1200-class drop, then hang
            // RPM lerps seed→shiftRpm as turbine/mech progresses toward shiftRpm.
            // Tach rises continuously/evenly all the way to the next shift (no
            // fast-then-slow kink, no seed+520 plateau). Slip decays as mech catches.
            var mechSpan = shiftRpm - tcPostShiftMechSeed;
            var hangSpan = shiftRpm - tcPostShiftHangSeed;
            var prog = (mechSpan > 80)
              ? clamp((mechRpm - tcPostShiftMechSeed) / mechSpan, 0, 1)
              : 1;
            // Stall slip ease: high stall lags lerp (tach hangs / more open-converter feel).
            // Low stall lag=0 — less slip comes from larger unload (hang seed closer to mech).
            // Circle D 4400 lag = 0 (identity with continuous-climb tip).
            var stallHang = Number(car.stallRpm) || 2800;
            var stallFacHang = clamp((stallHang - 1500) / 4000, 0, 1);
            var lag = clamp(0.00 + (stallFacHang - 0.725) * 0.22, 0, 0.20); // 0@4400; high stall lags more
            var progEff = prog * (1.0 - lag);
            var targetHang = tcPostShiftHangSeed + Math.max(0, hangSpan) * progEff;
            if (targetHang < tcPostShiftHangRpm) targetHang = tcPostShiftHangRpm; // no mid-gear sag
            // Soft slew so discrete mech steps do not stair-step the gauge
            var maxStep = (480 + stallFacHang * 60) * DT; // ~480–540 rpm/s slew cap
            var delta = targetHang - tcPostShiftHangRpm;
            if (delta > maxStep) delta = maxStep;
            if (delta < 0) delta = 0;
            tcPostShiftHangRpm = tcPostShiftHangRpm + delta;
            if (tcPostShiftHangRpm > shiftRpm) tcPostShiftHangRpm = shiftRpm;
            if (mechRpm >= tcPostShiftHangRpm - 25) {
              tcPostShiftHangRpm = 0;
              tcPostShiftHangSeed = 0;
              tcPostShiftMechSeed = 0;
              rpm = mechRpm;
            } else {
              rpm = Math.max(mechRpm, tcPostShiftHangRpm);
            }
          } else {
            // Lockup progress: 0 at standstill → 1 by stall-scaled mph.
            // Anchored at ~50 mph for Circle D 4400 (Auto launch identity); low stall
            // couples earlier, high stall stays open longer (real converter behavior).
            var lockMph = 38 + (stallFacFlash - 0.725) * 20; // Jorge Z28 gold tone-down v2 (38@4400)
            if (lockMph < 28) lockMph = 28;
            if (lockMph > 70) lockMph = 70;
            var lockup = clamp(mphNow / lockMph, 0, 1);
            // Flash pulse: peaks early while slow (window mode-scaled; Auto = 0.55s/28mph)
            var flashPulse = 0;
            var flashWinT = 0.55 * launchFlashTimeScale;
            var flashWinMph = 28.0 * launchFlashMphScale;
            if (flashWinT < 0.15) flashWinT = 0.15;
            if (t < flashWinT && mphNow < flashWinMph) {
              // High-stall ATC: wider flash window so Circle-D-class flash is visible on tach
              flashPulse = Math.sin((Math.min(t, flashWinT) / flashWinT) * Math.PI);
            }
            var target = stall + (flash - stall) * flashPulse;
            // Soft couples earlier (cooler peak); Aggressive holds flash vs early lockup.
            // Auto hold=0 → identical prior blend.
            var lockEff = lockup;
            if (flashPulse > 0.05) {
              var hold = 0.0;
              if (launchMode === 'aggressive') hold = 0.55 * flashPulse;
              else if (launchMode === 'soft') hold = -0.30 * flashPulse;
              else if (launchBlend) hold = (-0.30 + (0.55 - -0.30) * launchBlend.leave) * flashPulse;
              lockEff = clamp(lockup * (1.0 - hold), 0, 1);
            }
            rpm = target * (1 - lockEff) + mechRpm * lockEff;
            // Never fall below stall while still heavily slipped (< ~25 mph)
            if (mphNow < 25 && rpm < stall) rpm = stall;
            // Soft ceiling: don't wildly exceed flash during flash window
            if (flashPulse > 0.05 && rpm > flash) rpm = flash;
          }
        } else {
          /**
           * Stock slip→lockup (ATC off) — continuous launch tach (no couple=0 hard hold):
           * - Seed at leaveRpm; once rolling, tach MUST move (flash / dip / crawl / flare).
           * - AT: mild flash above leave (spin-scaled), then open-converter crawl with mph
           *   while still slipping — matches stall→acceleration→coupling (not frozen leave).
           * - MT: clutch-bite dip toward mech when hooked; wheelspin flares toward shift.
           * - EV: fast couple to mech (no converter drama).
           * - After first lock (mech caught leave / clutch fade): always follow mechRpm,
           *   including post-shift (must NOT re-hold leave).
           * - Shaped by prevSpin + leave/shift headroom so strong vs weak launchers differ.
           * - ATC flash/stall path above is untouched.
           */
          if (launchLocked) {
            rpm = mechRpm;
          } else {
            var isManual = /^manual$/i.test(String(car.transmission || '').trim());
            var isEvStock = !!(car.isEv || car.powerSource === 'ev');
            var stall = leaveRpm;
            // spinFrac 0..1 — do NOT name this spinN (that counter averages wheelspin%)
            var spinFrac = clamp((typeof prevSpinPct === 'number' ? prevSpinPct : 0) / 100.0, 0, 1);
            var headroom = Math.max(200, shiftRpm - stall);

            if (isEvStock) {
              // EV: near-immediate mech follow once rolling
              var evCouple = Math.max(
                clamp(mphNow / 8.0, 0, 1),
                clamp(mechRpm / Math.max(stall, 1), 0, 1)
              );
              rpm = stall * (1 - evCouple) + Math.max(mechRpm, stall) * evCouple;
              if (evCouple >= 0.85 || mechRpm >= stall) {
                launchLocked = true;
                rpm = mechRpm;
              }
            } else {
              // Mild stock flash ceiling (well below ATC Circle-D class unless spinning hard)
              var flashAdd;
              if (isManual) {
                // Stay on the rpm the user set. Do not flare above it.
                flashAdd = 0;
              } else {
                // Spin-scaled flash stall — stronger launchers (more wheelspin) flash higher
                flashAdd = Math.min(headroom * 0.40, 280 + 720 * spinFrac);
              }
              var flash = Math.min(shiftRpm, stall + Math.max(120, flashAdd));

              var lockMph = isManual ? 28.0 : 45.0;
              var flashWinT = isManual ? 0.40 : 0.48;
              var flashWinMph = isManual ? 20.0 : 26.0;
              var flashPulse = 0;
              if (flashWinT > 0.05 && t < flashWinT && mphNow < flashWinMph) {
                flashPulse = Math.sin((Math.min(t, flashWinT) / flashWinT) * Math.PI);
              }

              // Open-converter / clutch-slip engine target (moves as soon as rolling)
              var openRpm;
              if (isManual && spinFrac < 0.15) {
                // Bite dip under load when hooked (HPA) — modest street dip, recovers via crawl
                var dipTo = Math.max(mechRpm, stall * 0.85);
                openRpm = stall + (dipTo - stall) * (0.40 * flashPulse);
              } else {
                // AT flash / MT spin flare above leave
                openRpm = stall + (flash - stall) * flashPulse;
              }

              // Acceleration-phase crawl with mph — continuous tach motion while slipped
              // (no re-freeze at leave after flash). Weak cars crawl slower (same formula,
              // less mph progress); strong cars flash higher via spinN then crawl.
              var mphProg = clamp(mphNow / Math.max(lockMph, 1), 0, 1);
              var crawlGain = isManual ? 0.24 : 0.42;
              var crawl = stall + headroom * crawlGain * mphProg;
              if (crawl > stall + headroom * 0.55) crawl = stall + headroom * 0.55;
              // Manuals do not crawl up toward the shift point on their own.
              if (!isManual) openRpm = Math.max(openRpm, crawl);
              if (isManual && openRpm > stall) openRpm = stall;
              if (openRpm > shiftRpm) openRpm = shiftRpm;
              if (openRpm < 900) openRpm = 900;

              if (mechRpm >= stall) {
                // Turbine/road caught leave — lock and follow mech (shift drops preserved)
                launchLocked = true;
                rpm = mechRpm;
              } else if (isManual && manualBog) {
                // Dump was above the torque peak and the street tire was already
                // loose. The clutch pulls the engine down to this gear instead of
                // holding dump rpm for the whole 60-foot. 0.6s is that grab.
                // A leave under the peak never sets manualBog.
                var gapB = rpm - mechRpm;
                rpm = rpm - gapB * Math.min(1, DT / 0.60);
                if (rpm < mechRpm) rpm = mechRpm;
                if (mechRpm >= rpm * 0.90) {
                  launchLocked = true;
                  rpm = mechRpm;
                  manualBog = false;
                }
              } else if (isManual) {
                // Slip until road speed catches the leave. Do not force the
                // clutch out on a clock: t/0.55 blended every manual to mechRpm
                // and the 900 rpm floor while still in 1st, so the car pulled
                // idle torque (~0.36 g) and could not use the tire. Bite floor
                // is 85% of leave until the gear actually catches.
                var clutch = clamp(mphNow / 28.0, 0, 1);
                rpm = openRpm * (1 - clutch) + mechRpm * clutch;
                if (mechRpm < stall && rpm < stall * 0.85) rpm = stall * 0.85;
                if (rpm < 900) rpm = 900;
                if (clutch >= 0.85 && mechRpm >= stall * 0.92) {
                  launchLocked = true;
                  rpm = mechRpm;
                }
              } else {
                // AT open converter: tach tracks openRpm (flash/crawl) while slipped.
                // Soft-blend toward mech as turbine nears leave (no cliff at catch).
                var catchProg = clamp(mechRpm / Math.max(stall, 1), 0, 1);
                var blend = catchProg > 0.65
                  ? clamp((catchProg - 0.65) / 0.35, 0, 1)
                  : 0;
                var nearCouple = clamp(
                  (mphNow - lockMph * 0.78) / Math.max(lockMph * 0.22, 1),
                  0, 1
                );
                blend = Math.max(blend, nearCouple * 0.45);
                rpm = openRpm * (1 - blend) + mechRpm * blend;
                // Stall floor while still heavily open (fluid converter)
                if (blend < 0.40 && rpm < stall) rpm = stall;
              }
            }
          }
        }
      }

      if (!shifting && rpm >= shiftRpm && gear < gears.length) {
        gear++;
        shifting = true;
        shiftTimer = shiftTime;
        engageTimer = 0; // new shift preempts any in-flight engage ramp
        result.totalShifts++;
        // Record shift marker for SPEED VS DISTANCE chart (gear # + MPH @ distance/time)
        result.shifts.push({
          gear: gear,
          mph: +(v * MPS_TO_MPH).toFixed(1),
          feet: +(dist / FEET_TO_M).toFixed(1),
          t: +t.toFixed(3)
        });
        // ATC only: unlock on upshift — seed hang floor so post-shift tach stays in
        // powerband (~characteristic unload below shift RPM) instead of locked-ratio dump.
        // Stall gap/slip: low stall → larger RPM drop (less slip); high stall → smaller
        // drop / higher hang (more slip + multiply). Circle D 4400 ~1200-class drop.
        if (car.hasAftermarketConverter) {
          var stallU = Number(car.stallRpm) || 2800;
          // Anchor unload ~1294 @ 4400 (1200±300). Invert vs stallFac so:
          //   1500 → larger gap / tighter couple; 5500 → smaller gap / looser hang.
          var stallFac = clamp((stallU - 1500) / 4000, 0, 1);
          var unload = 1294 - (stallFac - 0.725) * 800; // ~1874@1500, ~1294@4400, ~1074@5500
          if (unload < 850) unload = 850;
          if (unload > 2100) unload = 2100;
          tcPostShiftHangSeed = Math.max(0, rpm - unload);
          tcPostShiftHangRpm = tcPostShiftHangSeed;
          var gNew = gears[Math.min(gear, gears.length) - 1];
          tcPostShiftMechSeed = Math.max(0, wheelRpm * gNew * finalDrive);
        }
      }

      var engTQ = getTorqueAtRpm(curve, rpm);
      // EV: no ICE FI boost path. Hybrid: ICE boost (if any) + motor assist band.
      if (!car.isEv) {
        engTQ *= boostTorqueMult(boostModel, boostPsi, rpm, redline, pressureInHg);
        engTQ += hybridAssistTorqueLbFt(rpm, car);
      }
      engTQ *= wx;
      engTQ *= (1.0 - loss);

      var gRatio = gears[Math.min(gear, gears.length) - 1];
      var fullWhTQ = engTQ * gRatio * finalDrive;
      var mph = v * MPS_TO_MPH;

      // Engaged (next-gear) wheel torque — includes ATC multiply so shift-end blend
      // matches the first post-shift tick (no cliff when shifting clears).
      var engagedWhTQ = fullWhTQ;
      if (car.hasAftermarketConverter) {
        // Torque multiplication from converter slip: ~2.1× at stall → 1.0 at lockup.
        // Stall 1500→5500 scales multiply; Circle D 4400 anchored to LIVE leave/unlock math.
        // Computed every tick (incl. mid-shift) so engagement endpoint stays continuous.
        var mech = wheelRpm * gRatio * finalDrive;
        var slipR = rpm > 0 ? Math.max(0, (rpm - mech) / rpm) : 0;
        // (retired) load-breathing slip floor — invented residual multiply when locked
        var stallN = Number(car.stallRpm) || 2800;
        var stallFacN = clamp((stallN - 1500) / 4000, 0, 1);
        // LIVE used stallBoost≈0.196 @4400 ((4400-2200)/2800*0.25). Keep that at 4400;
        // widen endpoints so 1500 is tighter and 5500 is looser.
        var stallBoost = 0.06 + (stallFacN - 0.725) * 0.32; // Jorge Z28 gold tone-down v2 (~0@1500, 0.06@4400)
        if (stallBoost < 0) stallBoost = 0;
        var tMult = 1.0 + Math.min(0.65, slipR * (0.9 + stallBoost));
        // Jorge Z28 gold: launch multiply fades out by ~32 mph so 60ft can
        // hook without over-carrying into 0-60 / ET (tone-down vs prior 2.2×/1.35).
        if (mph > 5) {
          // Jorge Z28 gold v2: earlier multiply fade so 0-60/ET slow without wrecking 60ft
          var fadeSpan = 14 + (stallFacN - 0.725) * 9; // ~14@4400
          if (fadeSpan < 8) fadeSpan = 8;
          if (fadeSpan > 24) fadeSpan = 24;
          var fade = Math.min(1.0, Math.max(0, (mph - 5) / fadeSpan));
          tMult = 1.0 + (tMult - 1.0) * (1.0 - fade);
        }
        // (retired) post-shift mph-gated trap-unlock multiply — Excel-chase invent
        engagedWhTQ = fullWhTQ * tMult;
      } else if (isStockTorqueConverterAuto(car)) {
        // Stock converter: STR at stall, 1.0 once coupled. Do not stack on the
        // aftermarket path above (hasAftermarketConverter already returned).
        var mechStock = wheelRpm * gRatio * finalDrive;
        var slipStock = rpm > 50 ? Math.max(0, (rpm - mechStock) / rpm) : 0;
        var speedRatio = 1.0 - slipStock;
        var coupleSR = 0.90;
        var str = stockStallTorqueRatio(car);
        var trStock = speedRatio >= coupleSR ? 1.0
          : 1.0 + (str - 1.0) * ((coupleSR - speedRatio) / coupleSR);
        engagedWhTQ = fullWhTQ * trStock;
      } else if ((shiftFamily === 'manual' || shiftFamily === 'dct') && gear === 1) {
        // Slipping clutch in 1st only, manuals and DCTs. Same shape as a
        // stock converter: manualClutchInertiaRatio for the whole slip,
        // 1.0 at SR 0.90. Not stacked on a torque converter. It does not
        // grow for a stickier tire. Higher gears stay steady.
        var mechMan = wheelRpm * gRatio * finalDrive;
        var slipMan = rpm > 50 ? Math.max(0, (rpm - mechMan) / rpm) : 0;
        var speedRatioMan = 1.0 - slipMan;
        // Same coupling point as stockStallTorqueRatio: full ratio while the
        // clutch is actually slipping, 1.0 once speed ratio reaches 0.90.
        // Do not multiply by slip again and do not fade 8→28 mph. That product
        // dropped the Camaro under the tire within a fraction of a foot, while
        // a converter holds STR until it couples.
        var ratioMan = 1.0;
        if (slipMan > 0.10) {
          // Street reference only. Fitted mu must not raise the ratio.
          var muStreet = tireGripForType(0, 'unprepped') * gripMultSmooth(mph);
          if (inLaunch && launchMuMult !== 1.0) muStreet *= launchMuMult;
          var gripStreet = streetReferenceGripN(
            mass, G, frontPct, rearPct, leftPct, driveType, muStreet, cgHeightM, wheelbaseM);
          var LBFT_TO_NM_C = 1.3558179483314;
          var steadyN = tireRadius > 0 ? (fullWhTQ * LBFT_TO_NM_C) / tireRadius : 0;
          steadyN *= driveForceMultSmooth(mph);
          // Already over the tire that is on the ground right now → 1.0.
          // The closed-form reference can sit above that live load; using it
          // alone gave the PP2 a ratio and slowed the launch.
          var wXferL = (mass * prevA * cgHeightM) / Math.max(wheelbaseM, 1e-6);
          var nRearL = mass * G * (rearPct / 100.0) + wXferL;
          var nFrontL = mass * G * (frontPct / 100.0) - wXferL;
          var nMinL = mass * G * 0.08;
          if (nRearL < nMinL) nRearL = nMinL;
          if (nFrontL < nMinL) nFrontL = nMinL;
          var liveStreet;
          if (driveType === 'AWD') {
            liveStreet = axleTractionLimitN(nFrontL, muStreet, leftPct, driveType) +
              axleTractionLimitN(nRearL, muStreet, leftPct, driveType);
          } else if (driveType === 'FWD') {
            liveStreet = axleTractionLimitN(nFrontL, muStreet, leftPct, driveType);
          } else {
            liveStreet = axleTractionLimitN(nRearL, muStreet, leftPct, driveType);
          }
          if (steadyN >= liveStreet) ratioMan = 1.0;
          else ratioMan = manualClutchInertiaRatio(steadyN, gripStreet);
        }
        var trMan = (ratioMan <= 1.0 || speedRatioMan >= 0.90) ? 1.0 : ratioMan;
        engagedWhTQ = fullWhTQ * trMan;
        var peakTqRpm = Number(car.peakTqRpm) || 0;
        if (trMan > 1.05 && peakTqRpm > 0 && rpm > peakTqRpm && (rpm - mechMan) > 1800) {
          manualBog = true;
        }
      }

      var whTQ;
      if (shifting) {
        // Soft release into residual; ATC V-notch recovers before shift-end (no deep flat well).
        var shiftDur = shiftTime > 1e-6 ? shiftTime : 1e-6;
        var pShift = 1 - clamp(shiftTimer / shiftDur, 0, 1);
        var holeTQ = lastDriveWhTQ * shiftResidualFrac;
        var recoverStart = null;
        var recoverTQ = holeTQ;
        if (shiftFamily === 'automatic') {
          // Pure V-notch — recover right after release (no flat hole / square well).
          recoverStart = Math.min(0.96, shiftReleaseFrac + 0.02);
          recoverTQ = lastDriveWhTQ * Math.max(shiftResidualFrac, 0.70);
        }
        whTQ = shiftReleaseTorque(pShift, lastDriveWhTQ, holeTQ, shiftReleaseFrac, recoverStart, recoverTQ);
      } else if (engageTimer > 0) {
        // Post-shift clutch/TC/DCT engage ramp + optional tip spike above engaged TQ.
        var engDur = shiftEngageDur > 1e-6 ? shiftEngageDur : 1e-6;
        var pEng = 1 - clamp(engageTimer / engDur, 0, 1);
        whTQ = shiftEngageTorque(pEng, engageFromTQ, engagedWhTQ, shiftEngageOS);
        engageTimer -= DT;
        if (engageTimer <= 0) {
          engageTimer = 0;
          lastDriveWhTQ = engagedWhTQ;
        }
      } else {
        whTQ = engagedWhTQ;
        // Store *applied* drive (post-ATC) so the next shift starts continuous.
        lastDriveWhTQ = engagedWhTQ;
      }

      // SI drive force: F(N) = (whTQ_lbft × LBFT_TO_NM) / tireRadius_m
      // LBFT_TO_NM = 1.3558179483314. Matches mass(kg)/drag(N)/traction(N).
      var LBFT_TO_NM = 1.3558179483314;
      var driveF = tireRadius > 0 ? (whTQ * LBFT_TO_NM) / tireRadius : 0;
      // Smooth FORCE bands — kill 30/60 square stairs; continuous taper with speed (A/E).
      driveF *= driveForceMultSmooth(mph);
      if (inLaunch && launchDriveMult !== 1.0) driveF *= launchDriveMult;

      var airV = relativeAirspeedMps(v, windMph, windDir, gustMph, t);
      var dragF = 0.5 * rho * cd * frontalArea * airV * airV;
      var rollF = v > 0.05 ? rollBase : 0;

      // Longitudinal weight transfer: nose up under accel → load rear, unload front
      var wXfer = (mass * prevA * cgHeightM) / wheelbaseM;
      var nFront = mass * G * (frontPct / 100.0) - wXfer;
      var nRear = mass * G * (rearPct / 100.0) + wXfer;
      var nMin = mass * G * 0.08;
      if (nFront < nMin) nFront = nMin;
      if (nRear < nMin) nRear = nMin;
      if (rsAddon && rsAddon.suctionN > 0) {
        nFront += rsAddon.suctionN * (frontPct / 100.0);
        nRear += rsAddon.suctionN * (rearPct / 100.0);
      }

      var mu = muBase;
      if (inLaunch && launchMuMult !== 1.0) {
        mu = muBase * launchMuMult;
      }
      // Smooth GRIP bands — kill 20/40/60 cliffs so mu/tracLim (and g) are continuous (A/E).
      mu *= gripMultSmooth(mph);

      /**
       * Per-axle traction with L/R split.
       * 50/50 → same as mu*nAxle. Bias toward open-diff (limited by light wheel) so
       * uneven L/R meaningfully cuts launch grip; load sensitivity softens the heavy side.
       */
      function axleTractionLimit(nAxle, muAx, leftP) {
        // Load sensitivity + street LSD blend live in axleTractionLimitN.
        return axleTractionLimitN(nAxle, muAx, leftP, driveType);
      }

      var tracLim;
      if (driveType === 'AWD') {
        // Both axles contribute; F/R static + transfer sets each axle's normal
        tracLim = axleTractionLimit(nFront, mu, leftPct) + axleTractionLimit(nRear, mu, leftPct);
      } else if (driveType === 'FWD') {
        tracLim = axleTractionLimit(nFront, mu, leftPct);
      } else {
        // RWD — drive axle is rear (gains load under accel)
        tracLim = axleTractionLimit(nRear, mu, leftPct);
      }
      // Traction and G-Force go hand in hand (Jorge): longitudinal g is driven by the
      // SAME tire-force path as TRACTION % / slip. When grip limits, applied (and g)
      // notches with it; when grip recovers, applied (and g) push recovers.
      // Soft knee = sharp launch tip then settle (D); no brick-wall shelf; no fake IMU.
      var appliedCmd = driveF;
      var spinPct = 0;
      if (tracLim > 0 && driveF > 0) {
        // Pre-compute slip so launch tip cannot invent grip while already spinning.
        var slipPre = driveF > tracLim ? (driveF - tracLim) / driveF : 0;
        var tip = Math.exp(-t / 0.080);
        // Overshoot only when hooked; dies with slip (Dragy: spin → no tall g spike).
        var overshoot = (0.006 + 0.055 * tip) * (1.0 - clamp(slipPre, 0, 1));
        if (launchMode === 'aggressive') overshoot = (0.008 + 0.070 * tip) * (1.0 - 0.85 * clamp(slipPre, 0, 1));
        else if (launchMode === 'soft') overshoot = (0.002 + 0.030 * tip) * (1.0 - clamp(slipPre, 0, 1));
        else if (launchBlend) {
          var overBase = 0.002 + (0.008 - 0.002) * launchBlend.tip;
          var tipC = 0.030 + (0.070 - 0.030) * launchBlend.tip;
          var slipC = 1.0 + (0.85 - 1.0) * launchBlend.tip;
          overshoot = (overBase + tipC * tip) * (1.0 - slipC * clamp(slipPre, 0, 1));
        }
        appliedCmd = softTractionForce(driveF, tracLim, overshoot);
        if (!driveFLpSeeded) { driveFLp = driveF; driveFLpSeeded = true; }
        driveFLp += (driveF - driveFLp) * Math.min(1, 16.0 * DT);
        if (driveF > tracLim) {
          var slip = slipPre;
          spinSum += slip;
          spinN++;
          spinPct = slip * 100.0;
          // Kinetic µ by tire type (Jorge): street sheds drive harder past peak;
          // DR/Slick hold more while spinning; prep softens race-tire falloff.
          // ~65% slip street → kin≈0.78; slick/prepped → kin≈0.88 — real 60′ spread.
          var kinP = tireKineticParams(env.tireType, env.trackPrep);
          var kin = 1.0 - kinP.fall * Math.pow(clamp(slip, 0, 1), kinP.exp);
          appliedCmd *= kin;
          // Traction-fight chatter (deterministic): noisy valleys while spinning.
          var chatter = 0.048 * Math.sin(t * 78.0 + slip * 11.0)
            + 0.026 * Math.sin(t * 143.0 - slip * 7.0);
          appliedCmd *= (1.0 + chatter * kin);
          // Hard ceiling at kinetic grip — never invent above tracLim*kin*(1+tiny tip).
          var kinCeil = tracLim * kin * (1.0 + Math.min(0.05, overshoot + 0.02));
          // Mean-neutral AC ripple inside the kinetic envelope only.
          appliedCmd += 0.38 * (driveF - driveFLp) * kin;
          var acHi = Math.min(driveF, kinCeil * 1.02);
          var acLo = tracLim * kin * 0.82;
          if (appliedCmd > acHi) appliedCmd = acHi;
          if (appliedCmd < acLo) appliedCmd = acLo;
          if (appliedCmd > kinCeil) appliedCmd = kinCeil;
          if ((launchMode === 'aggressive' || launchBlend) && slip <= Math.max(0.20, slipTarget * 1.6)) {
            var band = Math.max(0.20, slipTarget * 1.6);
            var keep = clamp(1.0 - slip / band, 0.35, 0.80);
            // Aggressive keep is 0.22. Soft has none (0). Blended modes use the same tip weight.
            var keepGain = launchBlend ? (0.22 * launchBlend.tip) : 0.22;
            appliedCmd = appliedCmd + (Math.min(driveF, kinCeil) - appliedCmd) * keep * keepGain;
            if (appliedCmd > kinCeil) appliedCmd = kinCeil;
          }
        }
      }

      prevSpinPct = spinPct;

      // forceScale is retired as a calibration knob — always 1.0 (garage must bake fs=1).
      appliedCmd *= CalibrationFactor;

      // Underdamped driveline tracks POST-TRACTION command — tips on traction/engage/TQ
      // changes only. Cap relative to appliedCmd so g cannot invent peaks above tire force.
      if (!dlSeeded) {
        dlForce = appliedCmd;
        dlVel = 0;
        dlSeeded = true;
      }
      var dlErr = appliedCmd - dlForce;
      var dlAcc = DL_WN * DL_WN * dlErr - 2.0 * DL_ZETA * DL_WN * dlVel;
      dlVel += dlAcc * DT;
      dlForce += dlVel * DT;
      if (dlForce < 0 && appliedCmd >= 0) dlForce = 0;
      // Tight cap — driveline ring must not invent g above commanded tire force
      var dlCap = appliedCmd >= 0 ? appliedCmd * 1.035 : appliedCmd;
      if (appliedCmd >= 0 && dlForce > dlCap) {
        dlForce = dlCap;
        if (dlVel > 0) dlVel *= 0.45;
      }
      var applied = dlForce;

      var net = applied - dragF - rollF;
      if (rsAddon && rsAddon.thruster) {
        rsThrustF = coldGasThrusterStep(rsAddon.thruster, DT, t);
        net += rsThrustF;
      }
      // Allow negative net after launch so aero can balance at Vmax
      if (net < 0 && !hit1320 && v < 5.0) net = 0;
      var a = net / mass;
      if (shiftProbe && shifting) {
        shiftProbe.n++;
        shiftProbe.sumA += a;
        if (a < shiftProbe.minA) shiftProbe.minA = a;
        shiftProbe.sumWhTQ += whTQ;
        if (whTQ < shiftProbe.minWhTQ) shiftProbe.minWhTQ = whTQ;
      }
      prevA = a;

      if (rsAddon && rsAddon.thruster) {
        // Vented gas leaves the car (mass loss).
        var rsLeft = rsAddon.thruster.gasMass;
        mass -= (rsGasMass - rsLeft);
        rsGasMass = rsLeft;
        if (rsTrace && (Math.round(t * 1000) % 20 === 0)) {
          rsTrace.push({ t: t, thrustN: rsThrustF, tankBar: rsAddon.thruster.P / 1e5,
            tankK: rsAddon.thruster.T, gasKg: rsLeft, massKg: mass, mph: v * MPS_TO_MPH });
        }
      }
      v += a * DT;
      if (v < 0) v = 0;
      // OEM/custom electronic speed limiter — hard clamp (not aero equilibrium)
      if (limiterMps > 0 && v > limiterMps) {
        v = limiterMps;
        a = 0;
        prevA = 0;
      }
      dist += v * DT;
      t += DT;

      mph = v * MPS_TO_MPH;
      var feet = dist / FEET_TO_M;
      var gForce = a / G;
      if (gForce > peakG) peakG = gForce;
      var instHp = (engTQ * rpm) / 5252;
      if (instHp > peakHP) peakHP = instHp;
      if (engTQ > peakTQ) peakTQ = engTQ;
      if (mph > peakMph) {
        peakMph = mph;
        peakMphT = t;
        peakMphFt = feet;
      }

      if (rsAddon && rsT1ft == null && dist >= FEET_TO_M) rsT1ft = t;
      if (!hit60 && dist >= DIST_60) { result.sixtyFootTime = t; hit60 = true; }
      if (!hit330 && dist >= DIST_330) { result.threeThirtyTime = t; hit330 = true; }
      if (!hit660 && dist >= DIST_660) {
        result.eighthMileTime = t;
        result.eighthMileSpeedMph = mph;
        hit660 = true;
      }
      if (!hit1000 && dist >= DIST_1000) { result.thousandFootTime = t; hit1000 = true; }
      if (!hit1320 && dist >= DIST_1320) {
        hit1320 = true;
        qmT = t;
        qmMph = mph;
      }
      if (!hitHalf && dist >= DIST_MILE * 0.5) {
        hitHalf = true;
        result.halfMileTime = t;
        result.halfMileSpeedMph = mph;
      }
      if (!hitMile && dist >= DIST_MILE) {
        hitMile = true;
        result.mileTime = t;
        result.mileSpeedMph = mph;
      }

      if (mph >= 60 && t060 == null) t060 = t;
      if (mph >= 100 && t0100 == null) t0100 = t;
      if (mph >= 60 && at60 == null) at60 = t;
      if (mph >= 130 && t60_130 == null && at60 != null) t60_130 = t - at60;
      if (mph >= 100 && at100 == null) at100 = t;
      if (mph >= 150 && t100_150 == null && at100 != null) t100_150 = t - at100;
      while (nextZeroIdx < ZERO_MPH_MARKS.length && mph >= ZERO_MPH_MARKS[nextZeroIdx]) {
        zeroToMph[ZERO_MPH_MARKS[nextZeroIdx]] = t;
        nextZeroIdx++;
      }
      if (t100kmh == null && mph >= mph100kmh) t100kmh = t;
      if (t200kmh == null && mph >= mph200kmh) t200kmh = t;
      if (t250kmh == null && mph >= mph250kmh) t250kmh = t;

      // Quick metrics mode (calib): stop after QM + optional speed windows, no Vmax crawl
      if (env.quickMetrics && hit1320) {
        var need130 = env.needSixtyToOneThirty !== false;
        var need150 = !!env.needHundredToOneFifty;
        var got130 = !need130 || t60_130 != null;
        var got150 = !need150 || t100_150 != null;
        if (got130 && got150) {
          vmaxDone = true;
          vmaxReason = 'quick_metrics';
        } else if (t > (qmT || 0) + 50.0) {
          // Won't reach requested window (aero-limited) — stop for calib speed
          vmaxDone = true;
          vmaxReason = 'quick_metrics_timeout';
        }
      }

      // Vmax / safety-cap detection (only after quarter-mile markers recorded).
      // Latch the reason when Vmax is reached, but keep stepping until the mile
      // marker (or time/dist cap) so 1/2 and 1-mile ET are real crossings, not blanks.
      if (hit1320 && !env.quickMetrics) {
        var vmaxWhy = '';
        if (speedLimiterMph > 0 && v >= limiterMps - 1e-6) {
          vmaxWhy = 'speed_limiter_' + speedLimiterMph + 'mph';
        } else if (v >= speedCapMps) {
          vmaxWhy = 'speed_cap_' + VMAX_SPEED_CAP_MPH + 'mph';
        } else if (dist >= distCapM) {
          vmaxWhy = 'dist_cap_' + VMAX_DIST_CAP_FT + 'ft';
        } else if (a < VMAX_A_THRESH) {
          vmaxHold += DT;
          if (vmaxHold >= VMAX_HOLD_S) vmaxWhy = 'aero_mech_equilibrium';
        } else {
          vmaxHold = 0;
        }
        if (vmaxWhy && !vmaxReason) vmaxReason = vmaxWhy;
        var hardCap = vmaxWhy.indexOf('dist_cap_') === 0;
        if (vmaxWhy && (hitMile || hardCap)) vmaxDone = true;
      }
      if (t >= MAX_T) {
        vmaxDone = true;
        if (!vmaxReason) vmaxReason = 'time_cap_' + MAX_T + 's';
      }

      if (!env.quickMetrics) {
        sampleAcc += DT;
        var sampleEvery = hit1320 ? 0.05 : 0.02;
        if (sampleAcc >= sampleEvery) {
          sampleAcc = 0;
          result.timeline.push({
            t: +t.toFixed(3),
            mph: +mph.toFixed(2),
            feet: +feet.toFixed(1),
            rpm: Math.round(rpm),
            gear: gear,
            g: +gForce.toFixed(3),
            wheelspin: +spinPct.toFixed(1)
          });
        }
      }
    }

    if (qmT != null) {
      result.quarterMileTime = qmT;
      result.quarterMileSpeedMph = qmMph;
    } else {
      result.quarterMileTime = t;
      result.quarterMileSpeedMph = v * MPS_TO_MPH;
    }
    if (spinN > 0) result.wheelspinPercent = (spinSum / spinN) * 100.0;
    result.zeroToSixty = t060;
    if (rsAddon) {
      result.roadster = {
        suctionDownforceN: rsAddon.suctionN,
        zeroToSixtyRollout1ft: (t060 != null && rsT1ft != null) ? (t060 - rsT1ft) : null,
        oneFootTime: rsT1ft
      };
      if (rsAddon.thruster) {
        var th = rsAddon.thruster;
        result.roadster.thruster = {
          tankVolumeL: th.cfg.tankVolumeL, fillPressureBar: th.cfg.fillPressurePa / 1e5,
          fillDensityKgM3: th.rho0, gasMassKg: th.gasMass0, gasLeftKg: th.gasMass,
          throatAreaCm2: th.aStar * 1e4, throatDiaPerNozzleMm: th.throatDiaPerNozzleMm,
          exitMach: th.Me, peakThrustN: th.peakThrust, impulseNs: th.impulse,
          burnEndS: th.burnEnd, endTankBar: th.P / 1e5, endTankK: th.T, trace: rsTrace
        };
      }
    }
    result.zeroToHundred = t0100;
    result.sixtyToOneThirty = t60_130;
    result.hundredToOneFifty = t100_150;
    // Canonical 0-60 / 0-100 stay the existing fields (same crossing).
    if (t060 != null) zeroToMph[60] = t060;
    if (t0100 != null) zeroToMph[100] = t0100;
    result.zeroToMph = zeroToMph;
    result.zeroToOneThirty = (zeroToMph[130] != null) ? zeroToMph[130] : null;
    result.hundredToTwoHundredKmh = (t100kmh != null && t200kmh != null) ? (t200kmh - t100kmh) : null;
    result.twoHundredToTwoFiftyKmh = (t200kmh != null && t250kmh != null) ? (t250kmh - t200kmh) : null;
    result.peakG = peakG;
    result.peakHorsepower = peakHP;
    result.peakTorque = peakTQ;
    result.finished = hit1320;
    result.topSpeedMph = peakMph;
    result.topSpeedTime = peakMphT;
    result.topSpeedFeet = peakMphFt;
    result.vmaxReached = vmaxDone && vmaxReason.indexOf('equilibrium') >= 0;
    result.vmaxReason = vmaxReason || (hit1320 ? 'incomplete' : 'did_not_finish_quarter');
    if (shiftProbe) {
      result.shiftCoastProbe = {
        family: shiftProbe.family,
        residual: shiftProbe.residual,
        release: shiftProbe.release,
        engageS: shiftProbe.engageS,
        samples: shiftProbe.n,
        minAccel: shiftProbe.n ? shiftProbe.minA : null,
        avgAccel: shiftProbe.n ? shiftProbe.sumA / shiftProbe.n : null,
        minWhTQ: shiftProbe.n ? shiftProbe.minWhTQ : null,
        avgWhTQ: shiftProbe.n ? shiftProbe.sumWhTQ / shiftProbe.n : null
      };
    }
    return result;
  }

  var API = {
    runQuarterMile: runQuarterMile,
    resolveSpeedLimiterMph: resolveSpeedLimiterMph,
    getTorqueAtRpm: getTorqueAtRpm,
    synthesizeTorqueCurve: synthesizeTorqueCurve,
    peakHpFromCurve: peakHpFromCurve,
    sanitizeTorqueCurvePostPeak: sanitizeTorqueCurvePostPeak,
    preserveStoredDynoTip: preserveStoredDynoTip,
    capTorqueCurveToPeakHp: capTorqueCurveToPeakHp,
    suggestedWeightDistribution: suggestedWeightDistribution,
    resolveWeightDistribution: resolveWeightDistribution,
    computeDensityAltitude: computeDensityAltitude,
    airDensityFromDA: airDensityFromDA,
    boostTorqueMult: boostTorqueMult,
    hybridAssistTorqueLbFt: hybridAssistTorqueLbFt,
    FactoryTransmissions: FactoryTransmissions,
    SHIFT_RESIDUAL_DRIVE: SHIFT_RESIDUAL_DRIVE,
    SHIFT_RELEASE_FRACTION: SHIFT_RELEASE_FRACTION,
    SHIFT_ENGAGE_TIME: SHIFT_ENGAGE_TIME,
    SHIFT_ENGAGE_OVERSHOOT: SHIFT_ENGAGE_OVERSHOOT,
    resolveShiftDriveFamily: resolveShiftDriveFamily,
    suggestedClutchLaunchRpm: suggestedClutchLaunchRpm,
    shiftResidualFraction: shiftResidualFraction,
    shiftReleaseFraction: shiftReleaseFraction,
    shiftEngageTime: shiftEngageTime,
    shiftEngageOvershoot: shiftEngageOvershoot,
    smoothstep01: smoothstep01,
    shiftReleaseTorque: shiftReleaseTorque,
    shiftEngageTorque: shiftEngageTorque,
    gripMultSmooth: gripMultSmooth,
    driveForceMultSmooth: driveForceMultSmooth,
    softTractionForce: softTractionForce,
    tireGripForType: tireGripForType,
    ROADSTER_ADDON_MODEL: ROADSTER_ADDON_MODEL,
    coldGasThrusterInit: coldGasThrusterInit,
    coldGasThrusterStep: coldGasThrusterStep,
    resolveRoadsterAddon: resolveRoadsterAddon,
    tireLabelForType: tireLabelForType,
    tireKineticParams: tireKineticParams,
    trackPrepLabel: trackPrepLabel,
    normalizeTrackPrep: normalizeTrackPrep,
    TIRE_LABELS: TIRE_LABELS,
    TIRE_MU_BY_PREP: TIRE_MU_BY_PREP,
    TARGET_60FT_BY_PREP: TARGET_60FT_BY_PREP,
    TIRE_KINETIC_FALL: TIRE_KINETIC_FALL,
    TIRE_KINETIC_EXP: TIRE_KINETIC_EXP,
    get CalibrationFactor() { return CalibrationFactor; },
    set CalibrationFactor(v) { CalibrationFactor = Number(v) || CalibrationFactor; },
    constants: {
      HYBRID_ICE_FRAC: 0.82,
      HYBRID_ASSIST_FRAC: 0.22,
      DEFAULT_LAUNCH_RPM: DEFAULT_LAUNCH_RPM,
      DEFAULT_SHIFT_RPM: DEFAULT_SHIFT_RPM,
      DEFAULT_SHIFT_TIME: DEFAULT_SHIFT_TIME,
      RHO0: RHO0,
      DT: DT,
      MAX_T: MAX_T,
      VMAX_SPEED_CAP_MPH: VMAX_SPEED_CAP_MPH,
      VMAX_DIST_CAP_FT: VMAX_DIST_CAP_FT,
      VMAX_A_THRESH: VMAX_A_THRESH,
      VMAX_HOLD_S: VMAX_HOLD_S
    }
  };

  global.VelocityBenchPowerCurve = API;
})(__rsHost);

  var PC = __rsHost.VelocityBenchPowerCurve;
  var CARS = {"2026-tesla-roadster":{"id":"2026-tesla-roadster","name":"2026 Tesla Roadster (Performance) — ESTIMATES","weightLbs":3700,"dragCoefficient":0.3,"frontalAreaSqFt":20.45,"tireRadiusInches":14.1,"finalDriveRatio":8.4,"gearRatios":[1],"drivetrainLossPercent":8,"launchRpm":800,"shiftRpm":23000,"redline":23000,"shiftTimeSeconds":0.01,"driveType":"RWD","peakHp":1073,"peakTqRpm":500,"peakHpRpm":6368,"powerSource":"ev","isEv":true,"isHybrid":false,"isNA":false,"isFI":false,"boostModel":"na","boostPsi":0,"hasAftermarketConverter":false,"stallRpm":2800,"forceScale":1,"tireType":5,"engineLayout":"Dual","torqueCurve":{"500":885,"600":885,"700":885,"800":885,"900":885,"1000":885,"1100":885,"1200":885,"1300":885,"1400":885,"1500":885,"1600":885,"1700":885,"1800":885,"1900":885,"2000":885,"2100":885,"2200":885,"2300":885,"2400":885,"2500":885,"2600":885,"2700":885,"2800":885,"2900":885,"3000":885,"3100":885,"3200":885,"3300":885,"3400":885,"3500":885,"3600":885,"3700":885,"3800":885,"3900":885,"4000":885,"4100":885,"4200":885,"4300":885,"4400":885,"4500":885,"4600":885,"4700":885,"4800":885,"4900":885,"5000":885,"5100":885,"5200":885,"5300":885,"5400":885,"5500":885,"5600":885,"5700":885,"5800":885,"5900":885,"6000":885,"6100":885,"6200":885,"6300":885,"6400":880.5306,"6500":866.984,"6600":853.8479,"6700":841.1039,"6800":828.7347,"6900":816.7241,"7000":805.0566,"7100":793.7177,"7200":782.6939,"7300":771.9721,"7400":761.54,"7500":751.3861,"7600":741.4995,"7700":731.8696,"7800":722.4867,"7900":713.3413,"8000":704.4245,"8100":695.7279,"8200":687.2434,"8300":678.9634,"8400":670.8805,"8500":662.9878,"8600":655.2786,"8700":647.7467,"8800":640.3859,"8900":633.1906,"9000":626.1551,"9100":619.2743,"9200":612.543,"9300":605.9566,"9400":599.5102,"9500":593.1996,"9600":587.0204,"9700":580.9687,"9800":575.0404,"9900":569.2319,"10000":563.5396,"10100":557.96,"10200":552.4898,"10300":547.1258,"10400":541.865,"10500":536.7044,"10600":531.6411,"10700":526.6725,"10800":521.7959,"10900":517.0088,"11000":512.3087,"11100":507.6933,"11200":503.1604,"11300":498.7076,"11400":494.333,"11500":490.0344,"11600":485.81,"11700":481.6578,"11800":477.5759,"11900":473.5627,"12000":469.6163,"12100":465.7352,"12200":461.9177,"12300":458.1623,"12400":454.4674,"12500":450.8317,"12600":447.2537,"12700":443.732,"12800":440.2653,"12900":436.8524,"13000":433.492,"13100":430.1829,"13200":426.9239,"13300":423.714,"13400":420.5519,"13500":417.4367,"13600":414.3674,"13700":411.3428,"13800":408.362,"13900":405.4242,"14000":402.5283,"14100":399.6735,"14200":396.8589,"14300":394.0836,"14400":391.3469,"14500":388.648,"14600":385.986,"14700":383.3603,"14800":380.77,"14900":378.2145,"15000":375.6931,"15100":373.205,"15200":370.7497,"15300":368.3265,"15400":365.9348,"15500":363.5739,"15600":361.2433,"15700":358.9424,"15800":356.6706,"15900":354.4274,"16000":352.2122,"16100":350.0246,"16200":347.864,"16300":345.7298,"16400":343.6217,"16500":341.5392,"16600":339.4817,"16700":337.4489,"16800":335.4402,"16900":333.4554,"17000":331.4939,"17100":329.5553,"17200":327.6393,"17300":325.7454,"17400":323.8733,"17500":322.0226,"17600":320.193,"17700":318.384,"17800":316.5953,"17900":314.8266,"18000":313.0776,"18100":311.3478,"18200":309.6371,"18300":307.9451,"18400":306.2715,"18500":303.6227,"18600":301.0023,"18700":298.41,"18800":295.8453,"18900":293.3076,"19000":290.7968,"19100":288.3121,"19200":285.8534,"19300":283.4202,"19400":281.012,"19500":278.6286,"19600":276.2694,"19700":273.9342,"19800":271.6226,"19900":269.3343,"20000":267.0688,"20100":264.8258,"20200":262.6051,"20300":260.4062,"20400":258.2289,"20500":256.0729,"20600":253.9377,"20700":251.8233,"20800":249.7291,"20900":247.655,"21000":245.6006,"21100":243.5657,"21200":241.55,"21300":239.5532,"21400":237.5751,"21500":235.6154,"21600":233.6738,"21700":231.7502,"21800":229.8441,"21900":227.9555,"22000":226.0841,"22100":224.2296,"22200":222.3918,"22300":220.5704,"22400":218.7654,"22500":216.9764,"22600":215.2032,"22700":213.4456,"22800":211.7035,"22900":209.9765,"23000":208.2646},"speedLimiterMph":230,"category":"EV","cgHeightFeet":1.4,"estimatesDisclaimer":true,"roadsterAddon":{"model":"tesla-roadster-2026-v1","suctionDownforceLbf":3700},"wheelbaseFeet":8.2,"frontWeightPercent":40,"rearWeightPercent":60,"leftWeightPercent":50,"rightWeightPercent":50},"2026-tesla-roadster-thrust":{"id":"2026-tesla-roadster-thrust","name":"2026 Tesla Roadster (Thrust, cold-gas) — ESTIMATES","weightLbs":4064,"dragCoefficient":0.3,"frontalAreaSqFt":20.45,"tireRadiusInches":14.1,"finalDriveRatio":8.4,"gearRatios":[1],"drivetrainLossPercent":8,"launchRpm":800,"shiftRpm":23000,"redline":23000,"shiftTimeSeconds":0.01,"driveType":"RWD","peakHp":1341,"peakTqRpm":500,"peakHpRpm":6818,"powerSource":"ev","isEv":true,"isHybrid":false,"isNA":false,"isFI":false,"boostModel":"na","boostPsi":0,"hasAftermarketConverter":false,"stallRpm":2800,"forceScale":1,"tireType":5,"engineLayout":"Dual","torqueCurve":{"500":1033,"600":1033,"700":1033,"800":1033,"900":1033,"1000":1033,"1100":1033,"1200":1033,"1300":1033,"1400":1033,"1500":1033,"1600":1033,"1700":1033,"1800":1033,"1900":1033,"2000":1033,"2100":1033,"2200":1033,"2300":1033,"2400":1033,"2500":1033,"2600":1033,"2700":1033,"2800":1033,"2900":1033,"3000":1033,"3100":1033,"3200":1033,"3300":1033,"3400":1033,"3500":1033,"3600":1033,"3700":1033,"3800":1033,"3900":1033,"4000":1033,"4100":1033,"4200":1033,"4300":1033,"4400":1033,"4500":1033,"4600":1033,"4700":1033,"4800":1033,"4900":1033,"5000":1033,"5100":1033,"5200":1033,"5300":1033,"5400":1033,"5500":1033,"5600":1033,"5700":1033,"5800":1033,"5900":1033,"6000":1033,"6100":1033,"6200":1033,"6300":1033,"6400":1033,"6500":1033,"6600":1033,"6700":1033,"6800":1033,"6900":1020.7148,"7000":1006.1331,"7100":991.9623,"7200":978.185,"7300":964.7852,"7400":951.7476,"7500":939.0576,"7600":926.7016,"7700":914.6665,"7800":902.94,"7900":891.5104,"8000":880.3665,"8100":869.4978,"8200":858.8941,"8300":848.546,"8400":838.4443,"8500":828.5802,"8600":818.9456,"8700":809.5324,"8800":800.3332,"8900":791.3407,"9000":782.548,"9100":773.9486,"9200":765.5361,"9300":757.3045,"9400":749.2481,"9500":741.3613,"9600":733.6387,"9700":726.0755,"9800":718.6665,"9900":711.4073,"10000":704.2932,"10100":697.32,"10200":690.4835,"10300":683.7798,"10400":677.205,"10500":670.7554,"10600":664.4275,"10700":658.2179,"10800":652.1233,"10900":646.1406,"11000":640.2665,"11100":634.4984,"11200":628.8332,"11300":623.2683,"11400":617.8011,"11500":612.4289,"11600":607.1493,"11700":601.96,"11800":596.8586,"11900":591.843,"12000":586.911,"12100":582.0605,"12200":577.2895,"12300":572.5961,"12400":567.9784,"12500":563.4346,"12600":558.9629,"12700":554.5616,"12800":550.2291,"12900":545.9637,"13000":541.764,"13100":537.6284,"13200":533.5555,"13300":529.5438,"13400":525.5919,"13500":521.6987,"13600":517.8626,"13700":514.0826,"13800":510.3574,"13900":506.6858,"14000":503.0666,"14100":499.4987,"14200":495.9811,"14300":492.5127,"14400":489.0925,"14500":485.7194,"14600":482.3926,"14700":479.111,"14800":475.8738,"14900":472.68,"15000":469.5288,"15100":466.4193,"15200":463.3508,"15300":460.3224,"15400":457.3332,"15500":454.3827,"15600":451.47,"15700":448.5944,"15800":445.7552,"15900":442.9517,"16000":440.1832,"16100":437.4492,"16200":434.7489,"16300":432.0817,"16400":429.4471,"16500":426.8444,"16600":424.273,"16700":421.7325,"16800":419.2221,"16900":416.7415,"17000":414.2901,"17100":411.8674,"17200":409.4728,"17300":407.1059,"17400":404.7662,"17500":402.4533,"17600":400.1666,"17700":397.9058,"17800":395.6703,"17900":393.4599,"18000":391.274,"18100":389.1123,"18200":386.9743,"18300":384.8597,"18400":382.768,"18500":379.4576,"18600":376.1828,"18700":372.943,"18800":369.7376,"18900":366.5662,"19000":363.4282,"19100":360.323,"19200":357.2502,"19300":354.2092,"19400":351.1995,"19500":348.2208,"19600":345.2724,"19700":342.354,"19800":339.465,"19900":336.6051,"20000":333.7737,"20100":330.9706,"20200":328.1952,"20300":325.4471,"20400":322.726,"20500":320.0314,"20600":317.363,"20700":314.7204,"20800":312.1032,"20900":309.511,"21000":306.9435,"21100":304.4004,"21200":301.8812,"21300":299.3857,"21400":296.9135,"21500":294.4643,"21600":292.0378,"21700":289.6337,"21800":287.2516,"21900":284.8913,"22000":282.5524,"22100":280.2347,"22200":277.9379,"22300":275.6616,"22400":273.4057,"22500":271.1699,"22600":268.9538,"22700":266.7573,"22800":264.58,"22900":262.4218,"23000":260.2823},"speedLimiterMph":230,"category":"EV","cgHeightFeet":1.4,"estimatesDisclaimer":true,"roadsterAddon":{"model":"tesla-roadster-2026-v1","suctionDownforceLbf":3700,"thruster":{"tankVolumeL":120,"fillPressureBar":700,"fillTempK":293.15,"nozzleAreaRatio":6,"dischargeCoeff":0.98,"thrustEfficiency":0.95,"cutoffBar":3,"thrustPeakN":80000,"nozzleCount":4}},"wheelbaseFeet":8.2,"frontWeightPercent":40,"rearWeightPercent":60,"leftWeightPercent":50,"rightWeightPercent":50}};
  /** Bench tire enum (0 All-season, 1 Summer, 2 UHP, 3 Soft compound, 4 Slicks) → PowerCurve tire id. */
  var TIRE_TO_PC = { 0: 0, 1: 3, 2: 4, 3: 5, 4: 2 };
  var BENCH_DRIVER_LBS = 200; // Bench curb fields carry a 200-lb driver baseline (app.js runTest)
  function handles(id) { return Object.prototype.hasOwnProperty.call(CARS, String(id)); }
  /** PowerCurve run car for these Bench inputs (weight / hp / loss / limiter edits respected). */
  function pcCarFor(opts) {
    var c = JSON.parse(JSON.stringify(CARS[opts.roadsterPcId]));
    var total = Number(opts.weightLbs);
    if (isFinite(total) && total > 0) c.weightLbs = total - BENCH_DRIVER_LBS;
    var hp = Number(opts.hp);
    if (isFinite(hp) && hp > 0 && Math.abs(hp - c.peakHp) > 0.5) {
      var k = hp / c.peakHp;
      Object.keys(c.torqueCurve).forEach(function (r) { c.torqueCurve[r] = c.torqueCurve[r] * k; });
      c.peakHp = hp;
    }
    if (opts.drivetrainLoss != null && isFinite(opts.drivetrainLoss)) c.drivetrainLossPercent = Number(opts.drivetrainLoss);
    if (opts.maxSpeedMph != null && isFinite(opts.maxSpeedMph) && opts.maxSpeedMph > 0) c.speedLimiterMph = Number(opts.maxSpeedMph);
    var tire = TIRE_TO_PC[Number(opts.tireType) | 0];
    c.tireType = tire == null ? c.tireType : tire;
    return c;
  }
  function interpAt(tl, ft) {
    for (var i = 1; i < tl.length; i++) {
      if (tl[i].feet >= ft) {
        var a = tl[i - 1], b = tl[i], u = (ft - a.feet) / ((b.feet - a.feet) || 1);
        return { t: a.t + (b.t - a.t) * u, mph: a.mph + (b.mph - a.mph) * u };
      }
    }
    return null;
  }
  function calculate(opts) {
    var car = pcCarFor(opts);
    var env = {
      tempF: opts.tempF, humidity: opts.humidity, pressureInHg: opts.pressureInHg,
      windSpeedMph: 0, windDirDeg: 0, gustMph: 0, launchMode: 'auto',
      tireType: car.tireType, tireLabel: PC.tireLabelForType(car.tireType), trackPrep: 'unprepped',
      driverWeightLbs: BENCH_DRIVER_LBS, needSixtyToOneThirty: true
    };
    if (opts.densityAltitudeFtInput != null && isFinite(opts.densityAltitudeFtInput)) env.densityAltitudeFtInput = Number(opts.densityAltitudeFtInput);
    var r = PC.runQuarterMile(car, env);
    var tl = r.timeline || [];
    var zero = {};
    for (var m = 0; m <= 150; m += 10) zero[m] = -1;
    zero[0] = tl.length ? tl[0].t : 0;
    Object.keys(r.zeroToMph || {}).forEach(function (k) { if (zero[k] != null) zero[k] = r.zeroToMph[k]; });
    var dist = {};
    var exact = { 60: [r.sixtyFootTime, null], 330: [r.threeThirtyTime, null], 660: [r.eighthMileTime, r.eighthMileSpeedMph],
      1000: [r.thousandFootTime, null], 1320: [r.quarterMileTime, r.quarterMileSpeedMph], 2640: [r.halfMileTime, r.halfMileSpeedMph], 5280: [r.mileTime, r.mileSpeedMph] };
    Object.keys(exact).forEach(function (k) {
      var e = exact[k], p = interpAt(tl, Number(k));
      var time = e[0] != null && e[0] > 0 ? e[0] : (p ? p.t : -1);
      var spd = e[1] != null && e[1] > 0 ? e[1] : (p ? p.mph : -1);
      dist[k] = { Time: time, SpeedMph: spd };
    });
    var steps = tl.map(function (s) { return { Time: s.t, SpeedMph: s.mph, DistanceFt: s.feet }; });
    var res = {
      Timestamp: opts.timestamp || new Date(),
      VmaxMph: r.topSpeedMph, StopReason: r.vmaxReason && r.vmaxReason.indexOf('limiter') >= 0 ? 'limiter' : 'vmax',
      RunDistanceFt: steps.length ? steps[steps.length - 1].DistanceFt : 0, RunTimeS: steps.length ? steps[steps.length - 1].Time : 0,
      ZeroToMphTimes: zero, DistanceMarkers: dist, Steps: steps,
      DensityAltitudeFt: r.densityAltitudeFeet, AirDensity: r.airDensity,
      ZeroToSixty: r.zeroToSixty, ZeroToHundred: r.zeroToHundred, ZeroToOneThirty: r.zeroToOneThirty,
      SixtyToOneThirty: r.sixtyToOneThirty, HundredToOneFifty: r.hundredToOneFifty,
      HundredToTwoHundredKmh: r.hundredToTwoHundredKmh, TwoHundredToTwoFiftyKmh: r.twoHundredToTwoFiftyKmh,
      Roadster: r.roadster, PowerCurveEngine: true
    };
    return res;
  }
  var DISCLAIMER = 'Estimates — not a tested car. Tesla revealed the Roadster on Oct 15, 2026; no instrumented test exists. ' +
    'Published/reported: RWD, ~3,700 lb, 800+ kW (1,000+ kW Thrust), 885 / 1,033 lb-ft, 0–60 claims <1.6 s / <0.9 s, >230 mph, thrusters >80 kN. ' +
    'Estimated: torque curve, motor rpm, ratio, Cd/area, tires, weight split, fan suction (~1 g) and the whole thruster model ' +
    '(120 L air COPV at 700 bar, isentropic blowdown, choked nozzles, vented mass leaves the car). Runs on VelocityBench PowerCurve physics. ' +
    "Tesla's 0–60 claims use a 1-ft rollout.";
  root.VBRoadsterBench = { handles: handles, calculate: calculate, pcCarFor: pcCarFor, DISCLAIMER: DISCLAIMER, PC: PC };

})(typeof window !== 'undefined' ? window : globalThis);
