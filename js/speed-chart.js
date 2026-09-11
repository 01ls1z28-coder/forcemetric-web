/**
 * ForceMetricSpeedChart — lightweight Canvas2D speed-vs-time plotter.
 * Classic gauge aesthetic: dark radial face, lime monospace, nice round ticks.
 */
(function (global) {
  'use strict';

  var PAD = { left: 48, right: 18, top: 18, bottom: 36 };
  var GRID_COLOR = 'rgba(215, 196, 160, 0.10)';
  var AXIS_COLOR = '#c9b48a';
  var LINE_COLOR = 'rgb(56, 189, 248)';
  var BG_INNER = '#07090c';
  var PLAYHEAD_COLOR = 'rgba(184, 255, 60, 0.95)';
  var MARK_COLOR = 'rgba(240, 226, 196, 0.45)';
  var SAMPLE_EVERY = 8;
  var DIST_MARKS_FT = [60, 330, 660, 1000, 1320];

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
    for (var v = 0; v <= niceMax + step * 0.001; v += step) {
      ticks.push(v);
    }
    return { ticks: ticks, max: niceMax, step: step };
  }

  function ForceMetricSpeedChart(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = []; // {t, v, d}
    this.xMax = 20;
    this.yMax = 200;
    this.playbackTime = null;
    this.speedScale = 1;
    this.speedUnitLabel = 'mph';
    this.distanceMarks = []; // {t, label}
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
    this.clear();
  }

  ForceMetricSpeedChart.prototype.resize = function () {
    var parent = this.canvas.parentElement;
    var cssW = (parent && parent.clientWidth) || this.canvas.clientWidth || 400;
    var cssH = (parent && parent.clientHeight) || this.canvas.clientHeight || 240;
    if (!cssW) cssW = 400;
    if (!cssH) cssH = 240;

    var dpr = window.devicePixelRatio || 1;
    this._cssW = cssW;
    this._cssH = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  ForceMetricSpeedChart.prototype.clear = function () {
    this.points = [];
    this.xMax = 20;
    this.yMax = 200;
    this.playbackTime = null;
    this.distanceMarks = [];
    /* Preserve speedScale / speedUnitLabel so metric mode survives Test/Replay. */
    this.draw();
  };

  ForceMetricSpeedChart.prototype._formatDistLabel = function (ft) {
    if (this.speedUnitLabel === 'km/h') {
      var m = ft * 0.3048;
      if (Math.abs(m - Math.round(m)) < 0.05) return String(Math.round(m)) + 'm';
      return m.toFixed(1) + 'm';
    }
    return String(Math.round(ft)) + "'";
  };

  ForceMetricSpeedChart.prototype._rebuildDistanceMarks = function (rawSteps) {
    this.distanceMarks = [];
    if (!rawSteps || !rawSteps.length) return;
    var hit = {};
    for (var i = 0; i < rawSteps.length; i++) {
      var s = rawSteps[i];
      var d = s.DistanceFt != null ? s.DistanceFt : s.d;
      var t = s.Time != null ? s.Time : (s.t != null ? s.t : s.x);
      if (!isFinite(d) || !isFinite(t)) continue;
      for (var mi = 0; mi < DIST_MARKS_FT.length; mi++) {
        var mk = DIST_MARKS_FT[mi];
        if (!hit[mk] && d >= mk) {
          hit[mk] = true;
          this.distanceMarks.push({ t: t, label: this._formatDistLabel(mk), ft: mk });
        }
      }
    }
  };

  /**
   * Accept Steps [{Time, SpeedMph, DistanceFt}, ...] or points [{x,y}|{t,v}|{Time,SpeedMph}].
   * Downsamples every SAMPLE_EVERY-th + last.
   */
  ForceMetricSpeedChart.prototype.setSeries = function (stepsOrPoints) {
    this.points = [];
    this.playbackTime = null;
    this.distanceMarks = [];
    if (!stepsOrPoints || !stepsOrPoints.length) {
      this.draw();
      return;
    }

    this._rebuildDistanceMarks(stepsOrPoints);

    var n = stepsOrPoints.length;
    var vmax = 0;
    var tmax = 0;
    var sampled = [];

    for (var i = 0; i < n; i++) {
      if (i % SAMPLE_EVERY !== 0 && i !== n - 1) continue;
      var s = stepsOrPoints[i];
      var t = s.Time != null ? s.Time : (s.t != null ? s.t : s.x);
      var v = s.SpeedMph != null ? s.SpeedMph : (s.v != null ? s.v : s.y);
      var d = s.DistanceFt != null ? s.DistanceFt : s.d;
      if (!isFinite(t) || !isFinite(v)) continue;
      sampled.push({ t: t, v: v, d: isFinite(d) ? d : null });
      if (t > tmax) tmax = t;
      if (v > vmax) vmax = v;
    }

    this.points = sampled;

    var xPlan = buildTicks(Math.max(8, tmax * 1.02), 5);
    this.xMax = xPlan.max;

    var yRaw = Math.max(100, vmax * 1.06);
    /* Keep mph-domain yMax; display ticks use speedScale. */
    var yDispPlan = buildTicks(yRaw * (this.speedScale || 1), 5);
    this.yMax = yDispPlan.max / (this.speedScale || 1);
    this.draw();
  };

  ForceMetricSpeedChart.prototype.setPlaybackTime = function (t) {
    this.playbackTime = (t == null || !isFinite(t)) ? null : t;
    this.draw();
  };

  ForceMetricSpeedChart.prototype._plotRect = function () {
    return {
      x: PAD.left,
      y: PAD.top,
      w: Math.max(1, this._cssW - PAD.left - PAD.right),
      h: Math.max(1, this._cssH - PAD.top - PAD.bottom)
    };
  };

  ForceMetricSpeedChart.prototype._mapX = function (t, rect) {
    return rect.x + (t / this.xMax) * rect.w;
  };

  ForceMetricSpeedChart.prototype._mapY = function (v, rect) {
    return rect.y + rect.h - (v / this.yMax) * rect.h;
  };

  ForceMetricSpeedChart.prototype._speedAtTime = function (t) {
    var pts = this.points;
    if (!pts.length) return null;
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (var i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        var a = pts[i - 1];
        var b = pts[i];
        var u = (t - a.t) / Math.max(1e-9, b.t - a.t);
        return a.v + (b.v - a.v) * u;
      }
    }
    return pts[pts.length - 1].v;
  };

  ForceMetricSpeedChart.prototype.draw = function () {
    var ctx = this.ctx;
    var W = this._cssW;
    var H = this._cssH;
    if (!W || !H) return;

    // Dark radial face
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.15, 8, W * 0.5, H * 0.55, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#12161c');
    bg.addColorStop(0.55, BG_INNER);
    bg.addColorStop(1, '#050607');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var rect = this._plotRect();
    var scale = this.speedScale || 1;
    var yDispMax = this.yMax * scale;

    var xPlan = buildTicks(this.xMax, 5);
    var yPlan = buildTicks(yDispMax, 5);
    /* Keep axis max aligned to nice ticks used for labels */
    var xMaxDraw = this.xMax;
    var yMaxDraw = this.yMax;

    var i, t, x, y, v, label;

    // Grid + tick labels
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (i = 0; i < xPlan.ticks.length; i++) {
      t = xPlan.ticks[i];
      if (t > xMaxDraw + 1e-6) continue;
      x = this._mapX(t, rect);
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
      if (t === 0) label = '0';
      else if (t < 10 && xPlan.step < 1) label = t.toFixed(1);
      else if (Math.abs(t - Math.round(t)) < 1e-6) label = String(Math.round(t));
      else label = t.toFixed(1);
      ctx.fillText(label, x, rect.y + rect.h + 6);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (i = 0; i < yPlan.ticks.length; i++) {
      var disp = yPlan.ticks[i];
      if (disp > yDispMax + 1e-6) continue;
      v = disp / scale;
      y = this._mapY(v, rect);
      ctx.beginPath();
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.w, y);
      ctx.stroke();
      if (Math.abs(disp - Math.round(disp)) < 1e-6) label = String(Math.round(disp));
      else label = String(disp);
      ctx.fillText(label, rect.x - 6, y);
    }

    // Axis titles
    ctx.fillStyle = AXIS_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText('Time (s)', rect.x + rect.w / 2, H - 2);

    ctx.save();
    ctx.translate(12, rect.y + rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Speed [' + (this.speedUnitLabel || 'mph') + ']', 0, 0);
    ctx.restore();

    // Plot border (champagne)
    ctx.strokeStyle = 'rgba(215, 196, 160, 0.35)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    // Distance event marks
    if (this.distanceMarks && this.distanceMarks.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = MARK_COLOR;
      ctx.fillStyle = 'rgba(232, 215, 176, 0.85)';
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (i = 0; i < this.distanceMarks.length; i++) {
        var mk = this.distanceMarks[i];
        if (mk.t < 0 || mk.t > xMaxDraw) continue;
        x = this._mapX(mk.t, rect);
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.h);
        ctx.stroke();
        ctx.fillText(mk.label, x, rect.y + 3);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Speed polyline
    if (this.points.length >= 2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();

      ctx.beginPath();
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(56, 189, 248, 0.35)';
      ctx.shadowBlur = 6;
      for (i = 0; i < this.points.length; i++) {
        x = this._mapX(this.points[i].t, rect);
        y = this._mapY(this.points[i].v, rect);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else if (this.points.length === 1) {
      x = this._mapX(this.points[0].t, rect);
      y = this._mapY(this.points[0].v, rect);
      ctx.fillStyle = LINE_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playback playhead crosshair + readout
    if (this.playbackTime != null && this.playbackTime >= 0) {
      var pt = Math.min(this.playbackTime, xMaxDraw);
      var spdMph = this._speedAtTime(pt);
      x = this._mapX(pt, rect);

      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();

      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();

      if (spdMph != null && isFinite(spdMph)) {
        y = this._mapY(spdMph, rect);
        ctx.beginPath();
        ctx.moveTo(rect.x, y);
        ctx.lineTo(rect.x + rect.w, y);
        ctx.stroke();

        ctx.fillStyle = PLAYHEAD_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        var spdDisp = Math.round(spdMph * scale);
        var readout = pt.toFixed(2) + 's  ' + spdDisp + ' ' + (this.speedUnitLabel || 'mph');
        ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textBaseline = 'bottom';
        var tw = ctx.measureText(readout).width;
        var rx = Math.min(Math.max(x - tw / 2, rect.x + 4), rect.x + rect.w - tw - 4);
        var ry = Math.max(y - 8, rect.y + 14);
        ctx.fillStyle = 'rgba(7, 9, 12, 0.78)';
        ctx.fillRect(rx - 4, ry - 13, tw + 8, 16);
        ctx.fillStyle = PLAYHEAD_COLOR;
        ctx.textAlign = 'left';
        ctx.fillText(readout, rx, ry);
      }
      ctx.restore();
    }
  };

  ForceMetricSpeedChart.prototype.setSpeedUnit = function (unit) {
    var prev = this.speedUnitLabel;
    if (unit === 'km/h') {
      this.speedScale = 1.609344;
      this.speedUnitLabel = 'km/h';
    } else {
      this.speedScale = 1;
      this.speedUnitLabel = 'mph';
    }
    if (prev !== this.speedUnitLabel && this.distanceMarks && this.distanceMarks.length) {
      for (var i = 0; i < this.distanceMarks.length; i++) {
        this.distanceMarks[i].label = this._formatDistLabel(this.distanceMarks[i].ft);
      }
    }
    /* Re-nice yMax for display unit */
    if (this.points && this.points.length) {
      var vmax = 0;
      for (var j = 0; j < this.points.length; j++) {
        if (this.points[j].v > vmax) vmax = this.points[j].v;
      }
      var yRaw = Math.max(100, vmax * 1.06);
      var yDispPlan = buildTicks(yRaw * (this.speedScale || 1), 5);
      this.yMax = yDispPlan.max / (this.speedScale || 1);
    }
    this.draw();
  };

  ForceMetricSpeedChart.prototype.destroy = function () {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
  };

  global.ForceMetricSpeedChart = ForceMetricSpeedChart;
})(typeof window !== 'undefined' ? window : this);
