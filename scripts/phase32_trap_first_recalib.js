#!/usr/bin/env node
/**
 * Phase 32 — Trap-first TireType + DrivetrainLossPercent recalib.
 * HOLD: do not touch physics.js µ ladder (AS 0.80 / Summer 0.97 / UHP 1.12 / Soft 1.30 / Slicks 1.48).
 * Soft/Slicks bake ALLOWED when AS/Summer/UHP cannot hit Jorge's Excel times.
 * Match at Standard Day + Driver Weight 200 (mass = curb − 200 + 200 = curb).
 * Match priority (Jorge): 1) ¼ trap mph >> 2) ¼ ET >> 3) 60–130 >> 4) 0–60 (least).
 * Controls ONLY: TireType 0–4 + DrivetrainLossPercent. No Cd/area/HP/µ/TX/Diff unlock.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GARAGE_PATH = path.join(ROOT, 'js/garage-data.js');
const PHYSICS_PATH = path.join(ROOT, 'js/physics.js');
const TARGETS_PATH =
  process.env.PHASE32_TARGETS ||
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
 * Phase 32 priority: trap >> ET >> 60-130 >> 0-60 (least).
 */
function scoreCost(res, tgt) {
  let c = 0;
  if (tgt.t4 != null) c += (Math.abs(res.dt4) / TOL.t4) * 8.0;
  c += (Math.abs(res.de4) / TOL.e4) * 3.0;
  if (tgt.z60_130 != null && res.dz60130 != null) {
    c += (Math.abs(res.dz60130) / TOL.z60_130) * 1.5;
  }
  c += (Math.abs(res.dz60) / TOL.z60) * 0.4;
  return c;
}

/** Lexicographic residual tuple — trap first, then ET, 60-130, 0-60 last */
function scoreTuple(res, tgt) {
  return [
    tgt.t4 != null ? Math.abs(res.dt4) : 0,
    Math.abs(res.de4),
    tgt.z60_130 != null && res.dz60130 != null ? Math.abs(res.dz60130) : 0,
    Math.abs(res.dz60),
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
 * Prefer lowest TireType that meets full tolerance (trap-first cost).
 * Soft/Slicks allowed when AS/Summer/UHP cannot hit.
 * Best-effort: minimize trap-first cost; prefer lower tire within 0.35 cost.
 */
function choose(P, v, tgt) {
  const fits = [];
  for (let tire = 0; tire <= 4; tire++) {
    fits.push({ tire, ...fitForTire(P, v, tire, tgt) });
    if (fits[fits.length - 1].hit) {
      const hits = fits.filter((f) => f.hit);
      hits.sort((a, b) => a.tire - b.tire || a.cost - b.cost || cmpTuple(a.sc, b.sc));
      return hits[0];
    }
  }
  // no full hit — trap-first cost; soft preference for lower tire
  fits.sort((a, b) => {
    const costDiff = a.cost - b.cost;
    if (Math.abs(costDiff) > 0.35) return costDiff;
    if (a.tire !== b.tire) return a.tire - b.tire;
    return cmpTuple(a.sc, b.sc);
  });
  return fits[0];
}

function tireLabelShort(t) {
  return TIRE_LABEL[t] || String(t);
}

function updateSource(src, tire, loss) {
  const note = `Phase 32 trap-first; tire ${tireLabelShort(tire)}; loss ${loss}; driver 200`;
  if (/Phase 32 trap-first/.test(src)) {
    return src.replace(/Phase 32 trap-first[^|]*/, note);
  }
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
  const outliers = [];
  const allResiduals = [];
  let skipped = 0;
  let unchanged = 0;
  let hitCount = 0;
  let hitTrap = 0;
  let hitEt = 0;
  let hitZ60 = 0;
  let hit60130 = 0;
  let nTrap = 0;
  let n60130 = 0;
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

    // Phase 32: TireType + loss ONLY — do not unlock/change HP, Cd, area, weight, TX, Diff, µ
    const best = choose(P, v, tgt);
    const nextTire = best.tire;
    const nextLoss = best.loss;

    if (nextLoss < 5.05 || nextLoss > 32) {
      outliers.push({ name: t.Name, loss: nextLoss, tire: nextTire });
    }

    const changed =
      nextTire !== prevTire || Math.abs(nextLoss - prevLoss) >= 0.05;

    const beforeSim = simulate(P, v, prevTire, prevLoss);
    const afterSim = best.sim;
    const afterRes = best.res;

    if (Math.abs(afterRes.dz60) <= TOL.z60) hitZ60++;
    if (Math.abs(afterRes.de4) <= TOL.e4) hitEt++;
    if (tgt.t4 != null) {
      nTrap++;
      if (Math.abs(afterRes.dt4) <= TOL.t4) hitTrap++;
    }
    if (tgt.z60_130 != null && afterRes.dz60130 != null) {
      n60130++;
      if (Math.abs(afterRes.dz60130) <= TOL.z60_130) hit60130++;
    }

    allResiduals.push({
      name: t.Name,
      tire: nextTire,
      loss: nextLoss,
      residual: {
        dz60: +afterRes.dz60.toFixed(3),
        de4: +afterRes.de4.toFixed(3),
        dt4: afterRes.dt4 != null ? +afterRes.dt4.toFixed(2) : null,
        dz60130: afterRes.dz60130 != null ? +afterRes.dz60130.toFixed(3) : null,
      },
    });

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
      }
    } else {
      unchanged++;
      if (apply && !/Phase 32 trap-first/.test(v.Source || '')) {
        v.Source = updateSource(v.Source || '', nextTire, nextLoss);
      }
    }

    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.error(
        `progress ${i + 1}/${targets.length} changed=${changes.length} hits=${hitCount} trapHits=${hitTrap}/${nTrap} softSlicks=${softSlicks.length} ${elapsed}s`
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
    cleanedHeader = cleanedHeader.replace(/ \* Phase 31:[^\n]*\n/, '');
    if (!/Phase 32:/.test(cleanedHeader)) {
      cleanedHeader = cleanedHeader.replace(
        /\s*\*\/\s*$/,
        ' * Phase 32: trap-first TireType + loss recalib (Soft/Slicks bake allowed when needed).\n */\n'
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
  const worstTrap = allResiduals
    .filter((r) => r.residual.dt4 != null)
    .slice()
    .sort((a, b) => Math.abs(b.residual.dt4) - Math.abs(a.residual.dt4))
    .slice(0, 40);

  const report = {
    apply,
    phase: 32,
    priority: 'trap >> ET >> 60-130 >> 0-60',
    targets: targets.length,
    skipped,
    unchanged,
    changeCount: changes.length,
    tireChanges: changes.filter((c) => c.fromTire !== c.toTire).length,
    lossOnly: changes.filter(
      (c) => c.fromTire === c.toTire && Math.abs(c.toLoss - c.fromLoss) >= 0.05
    ).length,
    before,
    after: afterCounts,
    softSlicks,
    misses: residualMisses,
    missOther,
    lossOutliers: outliers,
    hitCount,
    hitCounts: {
      fullTol: hitCount,
      trap_le_1mph: hitTrap,
      trapDenom: nTrap,
      et_le_0_05: hitEt,
      z60_le_0_05: hitZ60,
      z60_130_le_0_10: hit60130,
      z60_130Denom: n60130,
      processed: targets.length - skipped - missOther.length,
    },
    worstTrapResiduals: worstTrap,
    elapsedSec: +((Date.now() - tStart) / 1000).toFixed(1),
    changes,
  };

  fs.writeFileSync(
    path.join(ROOT, 'scripts/phase32_report.json'),
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
        before,
        after: afterCounts,
        softSlicks: softSlicks.length,
        misses: residualMisses.length,
        missOther: missOther.length,
        hitCount,
        hitCounts: report.hitCounts,
        lossOutliers: outliers.length,
        elapsedSec: report.elapsedSec,
      },
      null,
      2
    )
  );
}

main();
