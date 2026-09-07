/**
 * Canvas speedometer inspired by ForceMetric GaugeControl.cs
 * Range 0–250 MPH, animated needle, color zones.
 */
(function (global) {
  'use strict';

  function ForceMetricGauge(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.value = 0;
    this.maxValue = 250;
    this.unitText = 'MPH';
    this.needleAngle = -120;
    this.targetAngle = -120;
    this._raf = null;
    this._running = false;
    this._resize();
    this.start();
  }

  ForceMetricGauge.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var css = Math.min(this.canvas.clientWidth || 280, this.canvas.clientHeight || 280);
    if (!css) css = 280;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._size = css;
  };

  ForceMetricGauge.prototype.setValue = function (v) {
    this.value = Math.max(0, Math.min(Math.round(v), this.maxValue));
    this.targetAngle = this._map(this.value, 0, this.maxValue, 135, 405);
  };

  ForceMetricGauge.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    var self = this;
    function loop() {
      if (!self._running) return;
      self._animateNeedle();
      self.draw();
      self._raf = requestAnimationFrame(loop);
    }
    this._raf = requestAnimationFrame(loop);
  };

  ForceMetricGauge.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  };

  ForceMetricGauge.prototype._animateNeedle = function () {
    var speed = 0.15;
    this.needleAngle = this.needleAngle + (this.targetAngle - this.needleAngle) * speed;
    if (Math.abs(this.needleAngle - this.targetAngle) < 0.1) {
      this.needleAngle = this.targetAngle;
    }
  };

  ForceMetricGauge.prototype._map = function (value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
  };

  ForceMetricGauge.prototype.draw = function () {
    var ctx = this.ctx;
    var w = this._size;
    var h = this._size;
    var radius = Math.min(w, h) / 2 - 10;
    var cx = w / 2;
    var cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Face radial gradient
    var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgb(36,42,52)');
    grad.addColorStop(0.55, 'rgb(16,18,22)');
    grad.addColorStop(1, 'rgb(8,9,11)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(184,255,60,0.28)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    var startAngle = 135;
    var sweepAngle = 270;
    var arcR = radius - 20;

    function degToRad(d) { return (d * Math.PI) / 180; }

    function drawArc(color, fromDeg, sweepDeg) {
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, degToRad(fromDeg), degToRad(fromDeg + sweepDeg), false);
      ctx.strokeStyle = color;
      ctx.lineWidth = 12;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }

    var low = sweepAngle * 0.5;
    var mid = sweepAngle * 0.3;
    var high = sweepAngle * 0.2;
    drawArc('rgb(34,197,94)', startAngle, low);
    drawArc('rgb(250,204,21)', startAngle + low, mid);
    drawArc('rgb(239,68,68)', startAngle + low + mid, high);

    // Tick marks
    for (var i = 0; i <= this.maxValue; i += 10) {
      var angle = this._map(i, 0, this.maxValue, startAngle, startAngle + sweepAngle);
      var major = i % 50 === 0;
      var length = major ? 14 : 8;
      var rad = degToRad(angle);
      var x1 = cx + Math.cos(rad) * (radius - length);
      var y1 = cy + Math.sin(rad) * (radius - length);
      var x2 = cx + Math.cos(rad) * radius;
      var y2 = cy + Math.sin(rad) * radius;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
    }

    // Needle
    var angleRad = degToRad(this.needleAngle);
    var nx = cx + Math.cos(angleRad) * (radius - 30);
    var ny = cy + Math.sin(angleRad) * (radius - 30);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = 'rgba(239,68,68,0.4)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = 'rgb(248,113,113)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Center cap
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Digital readout
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px ui-monospace, Cascadia Code, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.value), cx, cy + radius / 2);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 12px ui-monospace, Cascadia Code, Consolas, monospace';
    ctx.fillText(this.unitText, cx, cy + radius / 2 + 28);
  };

  global.ForceMetricGauge = ForceMetricGauge;
})(typeof window !== 'undefined' ? window : globalThis);
