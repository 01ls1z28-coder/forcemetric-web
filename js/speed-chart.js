/**
 * ForceMetricSpeedChart — lightweight Canvas2D speed-vs-time plotter.
 * Replaces Chart.js for reliable file:// drawing.
 */
(function (global) {
  'use strict';

  var PAD = { left: 48, right: 16, top: 16, bottom: 36 };
  var GRID_COLOR = 'rgba(255,255,255,0.06)';
  var AXIS_COLOR = '#8b93a1';
  var LINE_COLOR = 'rgb(56, 189, 248)';
  var BG_COLOR = '#0a0c0f';
  var PLAYHEAD_COLOR = 'rgba(184, 255, 60, 0.9)';
  var SAMPLE_EVERY = 8;

  function ForceMetricSpeedChart(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = []; // {t, v}
    this.xMax = 35;
    this.yMax = 200;
    this.playbackTime = null;
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
    this.xMax = 35;
    this.yMax = 200;
    this.playbackTime = null;
    this.draw();
  };

  /**
   * Accept Steps [{Time, SpeedMph}, ...] or points [{x,y}|{t,v}|{Time,SpeedMph}].
   * Downsamples every SAMPLE_EVERY-th + last.
   */
  ForceMetricSpeedChart.prototype.setSeries = function (stepsOrPoints) {
    this.points = [];
    this.playbackTime = null;
    if (!stepsOrPoints || !stepsOrPoints.length) {
      this.draw();
      return;
    }

    var n = stepsOrPoints.length;
    var vmax = 0;
    var tmax = 0;
    var sampled = [];

    for (var i = 0; i < n; i++) {
      if (i % SAMPLE_EVERY !== 0 && i !== n - 1) continue;
      var s = stepsOrPoints[i];
      var t = s.Time != null ? s.Time : (s.t != null ? s.t : s.x);
      var v = s.SpeedMph != null ? s.SpeedMph : (s.v != null ? s.v : s.y);
      if (!isFinite(t) || !isFinite(v)) continue;
      sampled.push({ t: t, v: v });
      if (t > tmax) tmax = t;
      if (v > vmax) vmax = v;
    }

    this.points = sampled;
    this.xMax = Math.max(10, tmax * 1.05);
    this.yMax = Math.max(200, vmax + 20);
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

  ForceMetricSpeedChart.prototype.draw = function () {
    var ctx = this.ctx;
    var W = this._cssW;
    var H = this._cssH;
    if (!W || !H) return;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    var rect = this._plotRect();

    // Grid + tick labels
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = '11px Segoe UI, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    var xTicks = 6;
    var i, t, x, y, v;
    for (i = 0; i <= xTicks; i++) {
      t = (this.xMax * i) / xTicks;
      x = this._mapX(t, rect);
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
      ctx.fillText(t < 10 ? t.toFixed(1) : String(Math.round(t)), x, rect.y + rect.h + 6);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var yTicks = 5;
    for (i = 0; i <= yTicks; i++) {
      v = (this.yMax * i) / yTicks;
      y = this._mapY(v, rect);
      ctx.beginPath();
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.w, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(v)), rect.x - 6, y);
    }

    // Axis titles
    ctx.fillStyle = AXIS_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '11px Segoe UI, system-ui, -apple-system, sans-serif';
    ctx.fillText('Time (s)', rect.x + rect.w / 2, H - 2);

    ctx.save();
    ctx.translate(12, rect.y + rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Speed [mph]', 0, 0);
    ctx.restore();

    // Plot border
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

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
      for (i = 0; i < this.points.length; i++) {
        x = this._mapX(this.points[i].t, rect);
        y = this._mapY(this.points[i].v, rect);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (this.points.length === 1) {
      x = this._mapX(this.points[0].t, rect);
      y = this._mapY(this.points[0].v, rect);
      ctx.fillStyle = LINE_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playback playhead
    if (this.playbackTime != null && this.playbackTime >= 0) {
      var pt = Math.min(this.playbackTime, this.xMax);
      x = this._mapX(pt, rect);
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
    }
  };

  ForceMetricSpeedChart.prototype.destroy = function () {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
  };

  global.ForceMetricSpeedChart = ForceMetricSpeedChart;
})(typeof window !== 'undefined' ? window : this);
