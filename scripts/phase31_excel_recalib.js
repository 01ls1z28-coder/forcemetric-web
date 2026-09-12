#!/usr/bin/env node
/**
 * Phase 31 — Excel-target TireType + DrivetrainLossPercent recalib.
 * HOLD: do not touch physics.js µ ladder (AS 0.80 / Summer 0.97 / UHP 1.12 / Soft 1.30 / Slicks 1.48).
 * Soft/Slicks bake ALLOWED when AS/Summer/UHP cannot hit Jorge's Excel times.
 * Match at Standard Day + Driver Weight 200 (mass = curb − 200 + 200 = curb).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GARAGE_PATH = path.join(ROOT, 'js/garage-data.js');
const PHYSICS_PATH = path.join(ROOT, 'js/physics.js');
const TARGETS_PATH =
  process.env.PHASE31_TARGETS ||
  '/workspace/garage-export/phase31_targets.json';

const SKIP_NAMES = new Set(["2011 - 2014 Ford F-150 Enrique's 3.5EB"]);

const TIRE_LABEL = ['AllSeason', 'Summer', 'UHP', 'SoftCompound', 'Slicks'];
const TOL = { z60: 0.05, e4: 0.05, t4: 1.0, z60_130: 0.1 };
const LOSS_LO = 5;
const LOSS_HI = 35;

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

function isPresent(v) {
  if (v == null) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s || s === 'n/a' || s === 'na' || s === 'none') return false;
  }
  return Number.isFinite(Number(v));
}

function numOrNull(v) {
  return isPresent(v) ? Number(v) : null;
}

function effLoss(base, tx) {
  const t = String(tx || 'Auto').toLowerCase();
  let loss = Number(base);
  if (!isFinite(loss)) loss = 15;
  if (t === 'manual') loss -= 2;
  else if (t === 'dct') loss -= 1;
  return Math.max(0, Math.min(40, loss));
}

function resolveMassLbs(curb) {
  const c = Number(curb);
  const driver = 200;
  if (c > 1500) return c - 200 + driver;
  return c - 115 + driver;
}

function simulate(P, v, tireType, lossBase) {
  const curb = v.WeightLbs;
  const weight = resolveMassLbs(curb);
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
    z60: r.ZeroToSixty,
    e4: r.DistanceMarkers['1320'].Time,
    t4: r.DistanceMarkers['1320'].SpeedMph,
    z60_130: r.SixtyToOneThirty,
    lossEff: loss,
  };
}

function residuals(sim, tgt) {
  return {
    dz60: sim.z60 - tgt.z60,
    de4: sim.e4 - tgt.e4,
    dt4: tgt.t4 != null ? sim.t4 - tgt.t4 : null,
    dz60130:
      tgt.z60_130 != null && sim.z60_130 != null ? sim.z60_130 - tgt.z60_130 : null,
  };
}

function meetsTol(res, tgt) {
  if (Math.abs(res.dz60) > TOL.z60) return false;
  if (Math.abs(res.de4) > TOL.e4) return false;
  if (tgt.t4 != null && Math.abs(res.dt4) > TOL.t4) return false;
  if (tgt.z60_130 != null && res.dz60130 != null && Math.abs(res.dz60130) > TOL.z60_130)
    return false;
  return true;
}

/**
 * Match-order weighted cost (normalized by tolerance).
 * Priority weights: 0-60 > ET > trap > 60-130.
 * Avoids pure-lex "nail 0-60 at any loss" that destroys trap by 5+ mph.
 */
function scoreCost(res, tgt) {
  let c = (Math.abs(res.dz60) / TOL.z60) * 4.0;
  c += (Math.abs(res.de4) / TOL.e4) * 2.0;
  if (tgt.t4 != null) c += (Math.abs(res.dt4) / TOL.t4) * 1.0;
  if (tgt.z60_130 != null && res.dz60130 != null) {
    c += (Math.abs(res.dz60130) / TOL.z60_130) * 0.5;
  }
  return c;
}

/** Lexicographic residual tuple for tie-breaks among equal cost / hit sets */
function scoreTuple(res, tgt) {
  return [
    Math.abs(res.dz60),
    Math.abs(res.de4),
    tgt.t4 != null ? Math.abs(res.dt4) : 0,
    tgt.z60_130 != null && res.dz60130 != null ? Math.abs(res.dz60130) : 0,
  ];
}

function cmpTuple(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-12) return -1;
    if (a[i] > b[i] + 1e-12) return 1;
  }
  return 0;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function consider(best, cand, v) {
  if (!best) return cand;
  if (cand.hit && !best.hit) return cand;
  if (!cand.hit && best.hit) return best;
  // both hit or both miss
  if (cand.hit && best.hit) {
    // among hits: prefer lower cost, then lex, then closer loss
    if (cand.cost < best.cost - 1e-9) return cand;
    if (Math.abs(cand.cost - best.cost) <= 1e-9) {
      const c = cmpTuple(cand.sc, best.sc);
      if (c < 0) return cand;
      if (
        c === 0 &&
        Math.abs(cand.loss - v.DrivetrainLossPercent) <
          Math.abs(best.loss - v.DrivetrainLossPercent)
      )
        return cand;
    }
    return best;
  }
  // both miss: weighted cost; prefer lower tire-ish via cost only here
  if (cand.cost < best.cost - 1e-9) return cand;
  if (Math.abs(cand.cost - best.cost) <= 1e-9) {
    const c = cmpTuple(cand.sc, best.sc);
    if (c < 0) return cand;
    if (
      c === 0 &&
      Math.abs(cand.loss - v.DrivetrainLossPercent) <
        Math.abs(best.loss - v.DrivetrainLossPercent)
    )
      return cand;
  }
  return best;
}

function fitForTire(P, v, tire, tgt) {
  let best = null;
  // coarse 1.0
  for (let loss = LOSS_LO; loss <= LOSS_HI + 1e-9; loss += 1.0) {
    const sim = simulate(P, v, tire, loss);
    const res = residuals(sim, tgt);
    best = consider(
      best,
      {
        loss: round1(loss),
        sim,
        res,
        sc: scoreTuple(res, tgt),
        cost: scoreCost(res, tgt),
        hit: meetsTol(res, tgt),
      },
      v
    );
  }
  // fine 0.1 around best ±1.5 (wider — cost surface can be non-unimodal)
  const centers = [best.loss];
  // also refine around a trap-oriented second guess if trap present
  if (tgt.t4 != null) {
    let trapBest = null;
    for (let loss = LOSS_LO; loss <= LOSS_HI + 1e-9; loss += 1.0) {
      const sim = simulate(P, v, tire, loss);
      const err = Math.abs(sim.t4 - tgt.t4);
      if (!trapBest || err < trapBest.err) trapBest = { loss: round1(loss), err };
    }
    if (trapBest) centers.push(trapBest.loss);
  }
  for (const center of centers) {
    const fineLo = Math.max(LOSS_LO, center - 1.5);
    const fineHi = Math.min(LOSS_HI, center + 1.5);
    for (let loss = fineLo; loss <= fineHi + 1e-9; loss += 0.1) {
      const rounded = round1(loss);
      const sim = simulate(P, v, tire, rounded);
      const res = residuals(sim, tgt);
      best = consider(
        best,
        {
          loss: rounded,
          sim,
          res,
          sc: scoreTuple(res, tgt),
          cost: scoreCost(res, tgt),
          hit: meetsTol(res, tgt),
        },
        v
      );
    }
  }
  return best;
}

/**
 * Prefer lowest TireType that meets full tolerance.
 * Soft/Slicks allowed when AS/Summer/UHP cannot hit.
 * Best-effort: minimize weighted match-order cost; prefer lower tire within 0.25 cost.
 */
function choose(P, v, tgt) {
  const fits = [];
  for (let tire = 0; tire <= 4; tire++) {
    fits.push({ tire, ...fitForTire(P, v, tire, tgt) });
    // Early exit only when a low tire fully meets — still prefer lowest
    if (fits[fits.length - 1].hit) {
      // continue only if we might have same tire already; return lowest hit
      const hits = fits.filter((f) => f.hit);
      hits.sort((a, b) => a.tire - b.tire || a.cost - b.cost || cmpTuple(a.sc, b.sc));
      return hits[0];
    }
  }
  // no full hit — best-effort with soft preference for lower tire
  fits.sort((a, b) => {
    const costDiff = a.cost - b.cost;
    if (Math.abs(costDiff) > 0.25) return costDiff;
    if (a.tire !== b.tire) return a.tire - b.tire;
    return cmpTuple(a.sc, b.sc);
  });
  return fits[0];
}

function tireLabelShort(t) {
  return TIRE_LABEL[t] || String(t);
}

function updateSource(src, tire, loss) {
  const note = `Phase 31 Excel target; tire ${tireLabelShort(tire)}; loss ${loss}; driver 200`;
  if (/Phase 31 Excel target/.test(src)) {
    return src.replace(/Phase 31 Excel target[^|]*/, note);
  }
  if (/Phase 29 bake tire/.test(src)) {
    return src.replace(/Phase 29 bake tire [^|]*/, note);
  }
  if (/Phase 21 bake tire/.test(src)) {
    return src.replace(/Phase 21 bake tire [^|]*/, note);
  }
  return (src || '').replace(/\s*$/, '') + ` | ${note}`;
}

function countTires(arr) {
  const c = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const v of arr) c[v.TireType] = (c[v.TireType] || 0) + 1;
  return c;
}

function main() {
  const apply = process.argv.includes('--apply');
  const P = loadPhysics();
  const raw = loadGarageRaw();
  const garage = parseGarage(raw);
  const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf8'));
  const byName = new Map(garage.map((v) => [v.Name, v]));
  const before = countTires(garage);

  const changes = [];
  const softSlicks = [];
  const misses = [];
  const weightUpdates = [];
  const outliers = [];
  let skipped = 0;
  let unchanged = 0;
  let hitCount = 0;
  const tStart = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (SKIP_NAMES.has(t.Name)) {
      skipped++;
      continue;
    }
    const v = byName.get(t.Name);
    if (!v) {
      misses.push({ name: t.Name, reason: 'not in garage' });
      continue;
    }

    const tgt = {
      z60: numOrNull(t.ZeroToSixtySec),
      e4: numOrNull(t.QuarterEtSec),
      t4: numOrNull(t.QuarterMph),
      z60_130: numOrNull(t.SixtyToOneThirtySec),
    };
    if (tgt.z60 == null || tgt.e4 == null) {
      misses.push({ name: t.Name, reason: 'missing core targets' });
      continue;
    }

    const prevTire = v.TireType;
    const prevLoss = v.DrivetrainLossPercent;
    const prevW = v.WeightLbs;
    const prevHp = v.Horsepower;

    if (isPresent(t.WeightLbs) && Math.abs(Number(t.WeightLbs) - prevW) > 0.05) {
      weightUpdates.push({ name: t.Name, from: prevW, to: Number(t.WeightLbs) });
      v.WeightLbs = Number(t.WeightLbs);
    }
    if (isPresent(t.Horsepower) && Math.abs(Number(t.Horsepower) - prevHp) > 0.05) {
      v.Horsepower = Number(t.Horsepower);
    }

    const best = choose(P, v, tgt);
    const nextTire = best.tire;
    const nextLoss = best.loss;

    if (nextLoss < 5.05 || nextLoss > 32) {
      outliers.push({ name: t.Name, loss: nextLoss, tire: nextTire });
    }

    const changed =
      nextTire !== prevTire ||
      Math.abs(nextLoss - prevLoss) >= 0.05 ||
      Math.abs(v.WeightLbs - prevW) > 0.05 ||
      Math.abs(v.Horsepower - prevHp) > 0.05;

    const beforeSim = simulate(
      P,
      { ...v, WeightLbs: prevW, Horsepower: prevHp },
      prevTire,
      prevLoss
    );
    const afterSim = best.sim;
    const afterRes = best.res;

    if (best.hit) hitCount++;
    else {
      misses.push({
        name: t.Name,
        tire: nextTire,
        loss: nextLoss,
        target: tgt,
        sim: {
          z60: +afterSim.z60.toFixed(3),
          e4: +afterSim.e4.toFixed(3),
          t4: +afterSim.t4.toFixed(2),
          z60_130: afterSim.z60_130 != null ? +afterSim.z60_130.toFixed(3) : null,
        },
        residual: {
          dz60: +afterRes.dz60.toFixed(3),
          de4: +afterRes.de4.toFixed(3),
          dt4: afterRes.dt4 != null ? +afterRes.dt4.toFixed(2) : null,
          dz60130: afterRes.dz60130 != null ? +afterRes.dz60130.toFixed(3) : null,
        },
      });
    }

    if (nextTire >= 3) {
      softSlicks.push({
        name: t.Name,
        tire: tireLabelShort(nextTire),
        loss: nextLoss,
        hit: best.hit,
        residual: {
          dz60: +afterRes.dz60.toFixed(3),
          de4: +afterRes.de4.toFixed(3),
          dt4: afterRes.dt4 != null ? +afterRes.dt4.toFixed(2) : null,
        },
      });
    }

    if (changed) {
      changes.push({
        name: t.Name,
        fromTire: prevTire,
        toTire: nextTire,
        fromLoss: prevLoss,
        toLoss: nextLoss,
        weight: prevW !== v.WeightLbs ? [prevW, v.WeightLbs] : null,
        hit: best.hit,
        target: tgt,
        before: {
          z60: +beforeSim.z60.toFixed(3),
          e4: +beforeSim.e4.toFixed(3),
          t4: +beforeSim.t4.toFixed(2),
        },
        after: {
          z60: +afterSim.z60.toFixed(3),
          e4: +afterSim.e4.toFixed(3),
          t4: +afterSim.t4.toFixed(2),
          z60_130: afterSim.z60_130 != null ? +afterSim.z60_130.toFixed(3) : null,
        },
        residual: {
          dz60: +afterRes.dz60.toFixed(3),
          de4: +afterRes.de4.toFixed(3),
          dt4: afterRes.dt4 != null ? +afterRes.dt4.toFixed(2) : null,
          dz60130: afterRes.dz60130 != null ? +afterRes.dz60130.toFixed(3) : null,
        },
      });
      if (apply) {
        v.TireType = nextTire;
        v.DrivetrainLossPercent = nextLoss;
        v.Source = updateSource(v.Source || '', nextTire, nextLoss);
      } else {
        v.WeightLbs = prevW;
        v.Horsepower = prevHp;
      }
    } else {
      unchanged++;
      if (apply && !/Phase 31 Excel target/.test(v.Source || '')) {
        v.Source = updateSource(v.Source || '', nextTire, nextLoss);
      }
    }

    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.error(
        `progress ${i + 1}/${targets.length} changed=${changes.length} hits=${hitCount} misses=${misses.filter((m) => m.residual).length} softSlicks=${softSlicks.length} ${elapsed}s`
      );
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
    if (!/Phase 31:/.test(cleanedHeader)) {
      cleanedHeader = cleanedHeader.replace(
        /\s*\*\/\s*$/,
        ' * Phase 31: Excel-target TireType + loss recalib (Soft/Slicks bake allowed when needed).\n */\n'
      );
    }
    const body = JSON.stringify(garage, null, 2) + '\n';
    fs.writeFileSync(
      GARAGE_PATH,
      cleanedHeader.replace(/\s*$/, '\n') + 'window.GARAGE_DATA = ' + body
    );
  }

  const residualMisses = misses.filter((m) => m.residual);
  const missOther = misses.filter((m) => !m.residual);

  const report = {
    apply,
    targets: targets.length,
    skipped,
    unchanged,
    changeCount: changes.length,
    tireChanges: changes.filter((c) => c.fromTire !== c.toTire).length,
    lossOnly: changes.filter(
      (c) => c.fromTire === c.toTire && Math.abs(c.toLoss - c.fromLoss) >= 0.05
    ).length,
    weightUpdates,
    before,
    after: afterCounts,
    softSlicks,
    misses: residualMisses,
    missOther,
    lossOutliers: outliers,
    hitCount,
    elapsedSec: +((Date.now() - tStart) / 1000).toFixed(1),
    changes,
  };

  fs.writeFileSync(
    path.join(ROOT, 'scripts/phase31_report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        apply,
        targets: report.targets,
        skipped,
        changeCount: report.changeCount,
        tireChanges: report.tireChanges,
        lossOnly: report.lossOnly,
        weightUpdates: weightUpdates.length,
        before,
        after: afterCounts,
        softSlicks: softSlicks.length,
        misses: residualMisses.length,
        missOther: missOther.length,
        hitCount,
        lossOutliers: outliers.length,
        elapsedSec: report.elapsedSec,
      },
      null,
      2
    )
  );
}

main();
