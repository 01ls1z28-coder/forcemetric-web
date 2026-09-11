#!/usr/bin/env node
/**
 * Phase 29 — lean garage TireType + bake recalib harness.
 * HOLD: do not touch physics.js µ ladder.
 * Soft/Slicks bake defaults stay 0 unless documented drag-radial exception.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GARAGE_PATH = path.join(ROOT, 'js/garage-data.js');
const PHYSICS_PATH = path.join(ROOT, 'js/physics.js');

const TIRE = { AllSeason: 0, Summer: 1, UHP: 2, SoftCompound: 3, Slicks: 4 };
const TIRE_LABEL = ['All-season', 'Summer', 'UHP', 'SoftCompound', 'Slicks'];

function loadPhysics() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(PHYSICS_PATH, 'utf8'), ctx);
  return ctx.window.ForceMetricPhysics;
}

function loadGarageRaw() {
  return fs.readFileSync(GARAGE_PATH, 'utf8');
}

function parseGarage(raw) {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  return JSON.parse(raw.slice(start, end + 1));
}

function effLoss(base, tx) {
  const t = String(tx || 'Auto').toLowerCase();
  let loss = Number(base);
  if (!isFinite(loss)) loss = 15;
  if (t === 'manual') loss -= 2;
  else if (t === 'dct') loss -= 1;
  return Math.max(0, Math.min(35, loss));
}

function simulate(P, v, tireType, lossBase) {
  const weight = v.WeightLbs;
  const tx = v.Transmission || 'Auto';
  const loss = effLoss(lossBase != null ? lossBase : v.DrivetrainLossPercent, tx);
  const isFI = !!v.IsForcedInduction;
  const isNA = !v.IsEv && !isFI;
  const r = P.calculate({
    hp: v.Horsepower,
    weightLbs: weight,
    tireType: tireType != null ? tireType : v.TireType,
    Cd: v.DragCoefficient,
    frontalAreaSqFt: v.FrontalAreaSqFt,
    drivetrainLoss: loss,
    driveType: v.DriveType,
    isEv: !!v.IsEv,
    engineLayout: v.EngineLayout || 'Front',
    differential: v.Differential || 'LSD',
    tempF: 59,
    humidity: 0,
    pressureInHg: 29.92,
    densityAltitudeFtInput: NaN,
    isNA: isNA,
    isFI: isFI,
  });
  return {
    t60: r.DistanceMarkers['60'].Time,
    z60: r.ZeroToSixty,
    e8: r.DistanceMarkers['660'].Time,
    t8: r.DistanceMarkers['660'].SpeedMph,
    e4: r.DistanceMarkers['1320'].Time,
    t4: r.DistanceMarkers['1320'].SpeedMph,
    z60_130: r.SixtyToOneThirty,
    lossEff: loss,
  };
}

function parsePerf(src) {
  const out = {};
  const perf = ((src || '').match(/Perf:\s*([^|]+)/) || [])[1] || src || '';
  const all = [...perf.matchAll(/(\d+\.\d+)\s*\/\s*~?(\d+\.\d+)\s*@\s*(\d+)/g)];
  if (all.length) {
    const m = all[all.length - 1];
    out.z60 = +m[1];
    out.e4 = +m[2];
    out.t4 = +m[3];
  }
  return out;
}

/**
 * OEM tire suggestion (Phase 21 discipline).
 * Soft/Slicks never returned as bake default.
 */
function suggestedTire(v) {
  const n = v.Name;
  const year = +(n.match(/^(\d{4})/) || [])[1] || 0;
  if (year && year < 1990) return 0;
  if (v.WeightLbs <= 1500) return 0; // bikes stay AS

  // Cup / Trofeo / RS-track / Z06 / Performante / 1LE / hypercar track rubber → UHP
  if (
    /GT2 RS|GT3 RS|GT4 RS|\bZ06\b|Performante|Trofeo|\b1LE\b|Cup 2|\bZL1\b|SVJ\b|Senna\b|\bP1\b|One:1|Jesko|Agera|Venom GT|Speedtail|Sabre|Elva|Huayra BC|Zonda R|Apollo Sport|TSR-S|Regera|\bCCX\b/i.test(
      n
    )
  ) {
    return TIRE.UHP;
  }

  // Dedicated summer OEM modern performance / supercars
  if (
    /Ferrari|McLaren|Lamborghini|Koenigsegg|Pagani|Zenvo|Bugatti|Rimac|Nevera|Hennessey|Gumpert|Huayra|Zonda|Chiron|Veyron|Divo|720S|765LT|600LT|Artura|570S|650S|MP4-12C|SF90|LaFerrari|\bEnzo\b|812|488|F12|\bF8\b|458 Italia|\bF430\b|360 Modena|Roma|Portofino|\bGT3\b|\bGT2\b|\bGT4\b|Turbo S|AMG GT|M5 Competition|M3 Competition|\bM2\b|RS ?[34567]|RS5|RS4|WRX STI|GR Corolla|GR Supra|Golf R|Type R|Integra Type S|TLX Type S|GT350|GT500|Dark Horse|GT-R|Skyline|\bNSX\b|\bLFA\b|Corvette|911 Turbo|Cayman|Boxster|Vantage|\bDBS\b|Model S Plaid|Model 3 Performance|Air Sapphire|Lucid Air Sapphire|Taycan|Ioniq 5 N|Civic Type R|Huracán|Aventador|Gallardo|Murciélago|Diablo|Reventón/i.test(
      n
    )
  ) {
    return TIRE.Summer;
  }
  return null;
}

function tireLabelShort(t) {
  return TIRE_LABEL[t] || String(t);
}

function fitLoss(P, v, tireType, targetTrap, lo, hi) {
  lo = lo == null ? 5 : lo;
  hi = hi == null ? 32 : hi;
  let best = v.DrivetrainLossPercent;
  let bestErr = Infinity;
  for (let loss = lo; loss <= hi + 1e-9; loss += 0.5) {
    const r = simulate(P, v, tireType, loss);
    const err = Math.abs(r.t4 - targetTrap);
    if (err < bestErr) {
      bestErr = err;
      best = loss;
    }
  }
  const fineLo = Math.max(lo, best - 0.5);
  const fineHi = Math.min(hi, best + 0.5);
  for (let loss = fineLo; loss <= fineHi + 1e-9; loss += 0.1) {
    const rounded = Math.round(loss * 10) / 10;
    const r = simulate(P, v, tireType, rounded);
    const err = Math.abs(r.t4 - targetTrap);
    if (
      err < bestErr - 1e-9 ||
      (Math.abs(err - bestErr) < 1e-9 &&
        Math.abs(rounded - v.DrivetrainLossPercent) < Math.abs(best - v.DrivetrainLossPercent))
    ) {
      bestErr = err;
      best = rounded;
    }
  }
  return { loss: best, trapErr: bestErr };
}

function updateSource(src, tire, loss) {
  const note = `Phase 29 bake tire ${tireLabelShort(tire)}; loss ${loss}; driver 200; trap-first`;
  if (/Phase 29 bake tire/.test(src)) {
    return src.replace(/Phase 29 bake tire [^|]+/, note);
  }
  if (/Phase 21 bake tire/.test(src)) {
    return src.replace(/Phase 21 bake tire [^|]*/, note);
  }
  return src.replace(/\s*$/, '') + ` | ${note}`;
}

function countTires(arr) {
  const c = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const v of arr) c[v.TireType] = (c[v.TireType] || 0) + 1;
  return c;
}

/**
 * Choose bake tire ≤ OEM cap. Among candidates, minimize combined |z60|+|ET|
 * after a quick trap-first loss fit when trap target exists. Never Soft/Slicks.
 * Skip promote when already faster than published on AS.
 */
function chooseTire(P, v, oemCap) {
  const from = v.TireType;
  if (oemCap == null) return from;
  const cap = Math.min(oemCap, TIRE.UHP);
  if (cap <= from) return from;
  const targets = parsePerf(v.Source || '');
  const candidates = [];
  for (let t = from; t <= cap; t++) candidates.push(t);

  if (targets.z60 == null && targets.e4 == null) {
    // correctness-only: jump to cap for UHP-class; else keep
    return cap >= TIRE.UHP ? cap : from;
  }

  const base = simulate(P, v, from, v.DrivetrainLossPercent);
  const alreadyFast =
    (targets.z60 == null || base.z60 - targets.z60 < -0.2) &&
    (targets.e4 == null || base.e4 - targets.e4 < -0.15);
  if (alreadyFast) return from;

  function score(tire) {
    let loss = v.DrivetrainLossPercent;
    if (targets.t4 != null) loss = fitLoss(P, v, tire, targets.t4).loss;
    const r = simulate(P, v, tire, loss);
    const z = targets.z60 != null ? Math.abs(r.z60 - targets.z60) : 0;
    const e = targets.e4 != null ? Math.abs(r.e4 - targets.e4) : 0;
    // heavy penalty for large overshoot on 0-60 or ET
    const zOver = targets.z60 != null && r.z60 - targets.z60 < -0.45 ? 0.25 : 0;
    const eOver = targets.e4 != null && r.e4 - targets.e4 < -0.55 ? 0.25 : 0;
    return z * 1.1 + e + zOver + eOver;
  }

  let best = from;
  let bestScore = score(from);
  for (const t of candidates) {
    if (t === from) continue;
    const s = score(t);
    if (s + 0.04 < bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

function main() {
  const apply = process.argv.includes('--apply');
  const P = loadPhysics();
  const raw = loadGarageRaw();
  const garage = parseGarage(raw);
  const before = countTires(garage);

  const changes = [];
  const dragRadialExceptions = [];

  for (const v of garage) {
    const prevTire = v.TireType;
    const prevLoss = v.DrivetrainLossPercent;
    let nextTire = prevTire;

    if (prevTire >= TIRE.SoftCompound) {
      const sug = suggestedTire(v);
      nextTire = sug != null && sug < TIRE.SoftCompound ? sug : TIRE.UHP;
      dragRadialExceptions.push({
        name: v.Name,
        note: 'Had Soft/Slicks bake default — demoted (user-only compounds)',
      });
    } else {
      const sug = suggestedTire(v);
      nextTire = chooseTire(P, v, sug);
    }

    const targets = parsePerf(v.Source || '');
    let nextLoss = prevLoss;
    let lossChanged = false;

    if (nextTire !== prevTire && targets.t4 != null) {
      const fit = fitLoss(P, v, nextTire, targets.t4);
      nextLoss = fit.loss;
      lossChanged = Math.abs(nextLoss - prevLoss) >= 0.05;
    } else if (nextTire === prevTire && targets.t4 != null) {
      const cur = simulate(P, v, nextTire, prevLoss);
      const trapErr = cur.t4 - targets.t4;
      if (Math.abs(trapErr) > 1.0) {
        const fit = fitLoss(P, v, nextTire, targets.t4);
        const trial = simulate(P, v, nextTire, fit.loss);
        const newTrapErr = Math.abs(trial.t4 - targets.t4);
        const oldTrapErr = Math.abs(trapErr);
        if (newTrapErr + 0.35 < oldTrapErr) {
          const etOk =
            targets.e4 == null ||
            Math.abs(trial.e4 - targets.e4) <= Math.abs(cur.e4 - targets.e4) + 0.25;
          if (etOk) {
            nextLoss = fit.loss;
            lossChanged = Math.abs(nextLoss - prevLoss) >= 0.05;
          }
        }
      }
    }

    // If tire changed but no trap target, still annotate Source
    if (nextTire !== prevTire || lossChanged) {
      const beforeSim = simulate(P, v, prevTire, prevLoss);
      const afterSim = simulate(P, v, nextTire, nextLoss);
      changes.push({
        name: v.Name,
        fromTire: prevTire,
        toTire: nextTire,
        fromLoss: prevLoss,
        toLoss: nextLoss,
        targets,
        before: beforeSim,
        after: afterSim,
      });
      if (apply) {
        v.TireType = nextTire;
        v.DrivetrainLossPercent = nextLoss;
        v.Source = updateSource(v.Source || '', nextTire, nextLoss);
      }
    }
  }

  const afterCounts = apply
    ? countTires(garage)
    : (() => {
        const c = { 0: before[0], 1: before[1], 2: before[2], 3: before[3], 4: before[4] };
        for (const ch of changes) {
          c[ch.fromTire]--;
          c[ch.toTire]++;
        }
        return c;
      })();

  if (apply) {
    const header = raw.slice(0, raw.indexOf('['));
    let cleanedHeader = header.replace(/\s*window\.GARAGE_DATA\s*=\s*$/, '');
    if (!/Phase 29:/.test(cleanedHeader)) {
      cleanedHeader = cleanedHeader.replace(
        /\s*\*\/\s*$/,
        ' * Phase 29: lean TireType (OEM summer/UHP) + trap-first loss recalib; Soft/Slicks remain user-only.\n */\n'
      );
    }
    const body = JSON.stringify(garage, null, 2) + '\n';
    fs.writeFileSync(GARAGE_PATH, cleanedHeader.replace(/\s*$/, '\n') + 'window.GARAGE_DATA = ' + body);
  }

  const report = {
    vehicleCount: garage.length,
    before,
    after: afterCounts,
    changeCount: changes.length,
    tireChanges: changes.filter((c) => c.fromTire !== c.toTire).length,
    lossOnly: changes.filter((c) => c.fromTire === c.toTire).length,
    dragRadialExceptions,
    changes: changes.map((c) => ({
      name: c.name,
      tire: `${TIRE_LABEL[c.fromTire]}→${TIRE_LABEL[c.toTire]}`,
      loss: `${c.fromLoss}→${c.toLoss}`,
      src: c.targets,
      before: {
        z60: +c.before.z60.toFixed(2),
        e4: +c.before.e4.toFixed(2),
        t4: +c.before.t4.toFixed(1),
        t60: +c.before.t60.toFixed(2),
        e8: +c.before.e8.toFixed(2),
        z60_130: c.before.z60_130 != null ? +c.before.z60_130.toFixed(2) : null,
      },
      after: {
        z60: +c.after.z60.toFixed(2),
        e4: +c.after.e4.toFixed(2),
        t4: +c.after.t4.toFixed(1),
        t60: +c.after.t60.toFixed(2),
        e8: +c.after.e8.toFixed(2),
        z60_130: c.after.z60_130 != null ? +c.after.z60_130.toFixed(2) : null,
      },
    })),
  };

  fs.writeFileSync(path.join(ROOT, 'scripts/phase29_report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        apply,
        vehicleCount: report.vehicleCount,
        before: report.before,
        after: report.after,
        changeCount: report.changeCount,
        tireChanges: report.tireChanges,
        lossOnly: report.lossOnly,
        softSlicksAfter: (report.after[3] || 0) + (report.after[4] || 0),
      },
      null,
      2
    )
  );
  for (const c of report.changes) {
    console.log(
      c.tire,
      c.loss,
      c.name,
      'src',
      JSON.stringify(c.src),
      'z60',
      c.before.z60 + '→' + c.after.z60,
      'e4',
      c.before.e4 + '→' + c.after.e4,
      't4',
      c.before.t4 + '→' + c.after.t4
    );
  }
}

main();
